'use strict';

// Servicio para la app "Reelance IA" — recibe webhooks desde la tienda
// Next.js custom (reelance.mx) y crea/actualiza contactos, leads y dispara
// bots según la configuración del tenant.
//
// Diferencias con módulo woo/:
//   - No usa polling a WooCommerce REST API. La tienda Next.js empuja
//     webhooks directos a este servicio.
//   - Idempotencia por (event_type, external_id, external_status) — si la
//     tienda manda el mismo evento 2 veces, no duplicamos.
//   - Auth por bearer token único por tenant (generado al instalar la app).

const crypto = require('crypto');
const convoSvc = require('../conversations/service');

// ─── Token helpers ────────────────────────────────────────────────────

function generateToken() {
  return 'rIA_' + crypto.randomBytes(24).toString('base64url');
}

function getConfigByToken(db, token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM reelance_ia_config WHERE token = ?').get(token);
}

function getConfigByTenant(db, tenantId) {
  return db.prepare('SELECT * FROM reelance_ia_config WHERE tenant_id = ?').get(tenantId);
}

function ensureConfig(db, tenantId) {
  let cfg = getConfigByTenant(db, tenantId);
  if (!cfg) {
    const token = generateToken();
    db.prepare(`
      INSERT INTO reelance_ia_config (tenant_id, token, enabled, connected_at)
      VALUES (?, ?, 1, unixepoch())
    `).run(tenantId, token);
    cfg = getConfigByTenant(db, tenantId);
  }
  return cfg;
}

function updateConfig(db, tenantId, patch) {
  const cfg = ensureConfig(db, tenantId);
  const fields = [
    'site_url', 'enabled',
    'order_pipeline_id', 'order_stage_id',
    'abandoned_pipeline_id', 'abandoned_stage_id',
    'order_bot_id', 'abandoned_bot_id',
    'abandoned_tag', 'abandoned_tag_target', 'abandoned_wait_minutes', 'abandoned_dedupe_hours',
    'abandoned_template_id',
    'order_tag', 'order_tag_target', 'order_template_id',
    'products_json', 'pipeline_rules',
  ];
  const sets = [];
  const args = [];
  for (const f of fields) {
    if (patch[f] !== undefined) {
      sets.push(`${f} = ?`);
      args.push(patch[f]);
    }
  }
  if (!sets.length) return cfg;
  args.push(tenantId);
  db.prepare(`UPDATE reelance_ia_config SET ${sets.join(', ')}, updated_at = unixepoch() WHERE tenant_id = ?`).run(...args);
  return getConfigByTenant(db, tenantId);
}

function regenerateToken(db, tenantId) {
  const newToken = generateToken();
  db.prepare('UPDATE reelance_ia_config SET token = ?, updated_at = unixepoch() WHERE tenant_id = ?').run(newToken, tenantId);
  return newToken;
}

// ─── Helpers compartidos ──────────────────────────────────────────────

// Normaliza teléfono a E.164. Si no tiene prefijo de país, asume MX (+52).
function _normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('52') && digits.length >= 12) return '+' + digits;
  if (digits.length === 10) return '+52' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits; // ya tiene prefijo
  return '+' + digits;
}

// Crea o encuentra un contacto por email (primero) o teléfono (fallback)
function _findOrCreateContact(db, tenantId, { email, phone, firstName, lastName }) {
  let contact = null;
  if (email) {
    contact = db.prepare('SELECT * FROM contacts WHERE email = ? AND tenant_id = ? LIMIT 1').get(email, tenantId);
  }
  if (!contact && phone) {
    const normPhone = _normalizePhone(phone);
    if (normPhone) {
      contact = db.prepare('SELECT * FROM contacts WHERE phone = ? AND tenant_id = ? LIMIT 1').get(normPhone, tenantId);
      if (!contact) {
        // Fuzzy match: últimos 10 dígitos
        const last10 = normPhone.replace(/\D/g, '').slice(-10);
        if (last10.length === 10) {
          contact = db.prepare(
            "SELECT * FROM contacts WHERE SUBSTR(REPLACE(REPLACE(REPLACE(phone,'+',''),'-',''),' ',''), -10) = ? AND tenant_id = ? LIMIT 1"
          ).get(last10, tenantId);
        }
      }
    }
  }
  if (!contact) {
    const normPhone = _normalizePhone(phone);
    const first = firstName || (email ? email.split('@')[0] : null) || 'Contacto Reelance';
    const last  = lastName || null;
    const result = db.prepare(
      'INSERT INTO contacts (tenant_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(tenantId, first, last, email || null, normPhone);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
  } else {
    // Actualizar nombre/email/teléfono si vienen mejores datos
    const updates = [];
    const args = [];
    if (email && !contact.email) { updates.push('email = ?'); args.push(email); }
    if (firstName && (!contact.first_name || contact.first_name.startsWith('Contacto'))) {
      updates.push('first_name = ?');
      args.push(firstName);
    }
    if (lastName && !contact.last_name) { updates.push('last_name = ?'); args.push(lastName); }
    if (phone && !contact.phone) {
      const normPhone = _normalizePhone(phone);
      if (normPhone) { updates.push('phone = ?'); args.push(normPhone); }
    }
    if (updates.length) {
      args.push(contact.id);
      db.prepare(`UPDATE contacts SET ${updates.join(', ')}, updated_at = unixepoch() WHERE id = ?`).run(...args);
      contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
    }
  }
  return contact;
}

// Crea o encuentra lead para el contacto en el pipeline/stage configurado.
// Si ya hay lead activo en ese pipeline, lo reusa.
function _findOrCreateLead(db, tenantId, { contactId, pipelineId, stageId, name, value }) {
  if (!pipelineId || !stageId) return null;
  // En Wapi101 la tabla se llama 'expedients' (no 'leads'). Nombre legacy
  // por compatibilidad con la rama de Wapi pre-2024.
  let lead = db.prepare(`
    SELECT * FROM expedients
    WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(contactId, pipelineId, tenantId);
  if (!lead) {
    const result = db.prepare(`
      INSERT INTO expedients (tenant_id, contact_id, pipeline_id, stage_id, name, value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tenantId, contactId, pipelineId, stageId, name || null, value || 0);
    lead = db.prepare('SELECT * FROM expedients WHERE id = ?').get(result.lastInsertRowid);
  }
  return lead;
}

// Aplica una etiqueta al contacto y/o al lead según target.
// target: 'contact' (default) | 'lead' | 'both'
function _applyTag(db, { tenantId, contactId, leadId, tagName, target }) {
  if (!tagName) return;
  const t = (target || 'contact').toLowerCase();
  if ((t === 'contact' || t === 'both') && contactId) {
    try {
      // contact_tags no tiene tenant_id en su schema (legacy) — solo (contact_id, tag)
      db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)')
        .run(contactId, tagName);
    } catch (_) {}
  }
  if ((t === 'lead' || t === 'both') && leadId) {
    try {
      db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag) VALUES (?, ?)')
        .run(leadId, tagName);
    } catch (_) {}
  }
}

// Envía una plantilla WhatsApp API. Compartido por órdenes y carritos.
// kind: 'order' | 'abandoned_cart' — solo para logging y placeholders.
async function _sendTemplateMessage(db, { tenantId, contactId, contactName, phone, templateId, payload, kind }) {
  if (!templateId || !phone) return;
  const convoSvc = require('../conversations/service');
  const sender   = require('../conversations/sender');

  const externalId = String(phone).replace(/\D/g, '');
  const waIntegration = db.prepare(
    "SELECT id FROM integrations WHERE provider = 'whatsapp' AND tenant_id = ? ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, id DESC LIMIT 1"
  ).get(tenantId);
  if (!waIntegration) throw new Error('sin integración whatsapp connected');

  const convo = convoSvc.findOrCreate(db, tenantId, {
    provider:      'whatsapp',
    externalId,
    contactPhone:  phone,
    contactName:   contactName || null,
    contactId:     contactId || null,
    integrationId: waIntegration.id,
  });

  const firstName = (contactName || '').split(/\s+/)[0] || 'Cliente';
  // Placeholders comunes:
  //   {{1}} = nombre del cliente
  //   {{2}} = URL (recovery para abandoned_cart, tracking_url para order)
  //   {{3}} = total
  const manualValues = [
    firstName,
    kind === 'abandoned_cart' ? (payload.recoveryUrl || payload.cartUrl || '') : (payload.trackingUrl || ''),
    payload.totalCents ? String(Math.round(payload.totalCents / 100)) : '',
  ];

  const result = await sender.sendWhatsAppTemplate(db, convo, templateId, manualValues, { autoFallback: true });
  convoSvc.addMessage(db, tenantId, convo.id, {
    externalId: result.externalId,
    direction:  'outgoing',
    provider:   'whatsapp',
    body:       result.renderedBody,
    status:     'sent',
  });
  return result;
}

function _logEvent(db, { tenantId, eventType, externalId, externalStatus, payload, contactId, leadId, error }) {
  try {
    db.prepare(`
      INSERT OR REPLACE INTO reelance_ia_events
        (tenant_id, event_type, external_id, external_status, payload, contact_id, lead_id, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tenantId, eventType, externalId, externalStatus || null,
           JSON.stringify(payload || {}).slice(0, 8000),
           contactId || null, leadId || null, error || null);
  } catch (e) { /* silenciar — el log no debe romper el flow */ }
}

// ¿Este (eventType, externalId, status) ya se procesó exitosamente antes?
// Sirve para idempotencia: si la tienda reenvía el mismo evento, no
// re-disparamos el bot (evita mensajes duplicados al cliente).
function _alreadyProcessed(db, tenantId, eventType, externalId, externalStatus) {
  if (!externalId) return false;
  const row = db.prepare(`
    SELECT id, error FROM reelance_ia_events
    WHERE tenant_id = ? AND event_type = ? AND external_id = ? AND external_status = ?
    LIMIT 1
  `).get(tenantId, eventType, externalId, externalStatus || null);
  // Solo consideramos "ya procesado" si no falló — si tuvo error, vale reintentar
  return !!(row && !row.error);
}

// ─── Handler: webhook de Order ────────────────────────────────────────
//
// Payload esperado desde la tienda Next.js (Prisma Order model):
// {
//   id: "cuid",
//   email: "cliente@x.com",
//   phone: "+5215512345678",
//   customerName: "Juan Pérez",
//   shippingAddress, shippingCity, shippingState, shippingZip,
//   subtotalCents, shippingCents, totalCents, currency,
//   status: "PENDING" | "PAID" | "PROCESSING" | "FULFILLED" | "COMPLETED" | "CANCELLED",
//   paymentProvider: "stripe" | "paypal" | "mercadopago",
//   trackingCarrier, trackingNumber, trackingUrl,
//   items: [{ productId, productName, quantity, unitPriceCents, totalCents }],
//   utmSource, utmMedium, utmCampaign, utmContent, referrer,
//   createdAt, updatedAt
// }
function processOrderEvent(db, tenantId, payload) {
  const cfg = getConfigByTenant(db, tenantId);
  if (!cfg || !cfg.enabled) return { skipped: 'app-disabled' };

  const externalId = String(payload.id || '');
  if (!externalId) {
    _logEvent(db, { tenantId, eventType: 'order', externalId: '_', externalStatus: payload.status, payload, error: 'missing-id' });
    return { error: 'missing-id' };
  }

  // Idempotencia: si ya procesamos este (order, externalId, status) exitosamente,
  // no re-disparamos bots (evita mensajes duplicados al cliente).
  if (_alreadyProcessed(db, tenantId, 'order', externalId, payload.status)) {
    return { skipped: 'already-processed' };
  }

  // Extraer datos de customer
  const customerName = (payload.customerName || '').trim();
  const [firstName, ...rest] = customerName.split(/\s+/);
  const lastName = rest.join(' ') || null;

  try {
    const contact = _findOrCreateContact(db, tenantId, {
      email: payload.email,
      phone: payload.phone,
      firstName: firstName || null,
      lastName,
    });

    // Crear lead solo si tenemos pipeline configurado para órdenes
    let lead = null;
    if (cfg.order_pipeline_id && cfg.order_stage_id) {
      const leadName = `Orden #${externalId.slice(-8)}`;
      const totalMxn = payload.totalCents ? Math.round(payload.totalCents / 100) : 0;
      lead = _findOrCreateLead(db, tenantId, {
        contactId: contact.id,
        pipelineId: cfg.order_pipeline_id,
        stageId: cfg.order_stage_id,
        name: leadName,
        value: totalMxn,
      });
    }

    db.prepare('UPDATE reelance_ia_config SET last_order_at = unixepoch() WHERE tenant_id = ?').run(tenantId);

    _logEvent(db, {
      tenantId, eventType: 'order',
      externalId, externalStatus: payload.status,
      payload, contactId: contact.id, leadId: lead?.id,
    });

    // Aplicar etiqueta configurada (a contact, lead, o both según target)
    if (cfg.order_tag) {
      _applyTag(db, {
        tenantId, contactId: contact.id, leadId: lead?.id,
        tagName: cfg.order_tag,
        target: cfg.order_tag_target || 'contact',
      });
    }

    // Prioridad: plantilla WA API > bot.
    // Las órdenes pueden estar fuera de ventana 24h (cliente compró pero no
    // nos escribió), por eso template es más confiable.
    if (cfg.order_template_id) {
      _sendTemplateMessage(db, {
        tenantId,
        contactId:   contact.id,
        contactName: customerName || null,
        phone:       payload.phone || null,
        templateId:  cfg.order_template_id,
        payload,
        kind: 'order',
      }).catch(err => console.error('[reelance-ia] order template send failed:', err.message));
    } else if (cfg.order_bot_id) {
      _fireBot(db, tenantId, cfg.order_bot_id, contact.id, lead?.id, { source: 'reelance-ia.order', order: payload });
    }

    // Ruteo a pipeline por duración del producto.
    // Solo se aplica si:
    //   - La orden viene con tracking (carrier + number) → cliente la marcó completada
    //   - status es 'COMPLETED' o 'FULFILLED' (paquete confirmado en camino)
    //   - Hay productos configurados con duration_days
    //   - Hay reglas de pipeline_rules configuradas
    const hasTracking = (payload.trackingCarrier && payload.trackingNumber);
    const statusReady = ['COMPLETED', 'FULFILLED'].includes(payload.status);
    if (lead && hasTracking && statusReady) {
      try {
        _routeOrderToPipeline(db, tenantId, lead, payload, cfg);
      } catch (err) {
        console.error('[reelance-ia] route order failed:', err.message);
      }
    }

    return { ok: true, contactId: contact.id, leadId: lead?.id || null };
  } catch (err) {
    _logEvent(db, { tenantId, eventType: 'order', externalId, externalStatus: payload.status, payload, error: err.message });
    throw err;
  }
}

// ─── Ruteo a pipeline por duración (mismo mecanismo que Woo) ─────────
// Calcula maxDays a partir de los productos comprados y busca la regla
// de pipeline_rules que más se acerque (la mayor que no exceda maxDays).
// Mueve el lead al pipeline destino, mata bots anteriores y dispara los
// del nuevo stage (triggerPipelineStage activa los bots MES 1:1, etc.).
function _routeOrderToPipeline(db, tenantId, lead, payload, cfg) {
  const productDefs = _safeJsonParse(cfg.products_json, []);
  const rules       = _safeJsonParse(cfg.pipeline_rules, []);
  if (!productDefs.length || !rules.length) return;

  const items = payload.items || [];
  if (!items.length) return;

  // Calcular maxDays — duración del producto más larga × cantidad
  let maxDays = 0;
  for (const item of items) {
    const name = String(item.productName || '').toLowerCase().trim();
    const def  = productDefs.find(p => String(p.name || '').toLowerCase().trim() === name);
    if (def && def.duration_days) {
      const effective = Number(def.duration_days) * (Number(item.quantity) || 1);
      if (effective > maxDays) maxDays = effective;
    }
  }
  if (maxDays <= 0) {
    console.log(`[reelance-ia] order ${payload.id} sin productos configurados — no se rutea`);
    return;
  }

  // Buscar regla con duration_days más alta que no exceda maxDays.
  // Si todas las reglas exceden, usar la menor (fallback).
  const sorted = [...rules].sort((a, b) => Number(b.duration_days) - Number(a.duration_days));
  const rule = sorted.find(r => Number(r.duration_days) <= maxDays) || sorted[sorted.length - 1];
  if (!rule || !rule.pipeline_id || !rule.stage_id) return;

  // Verificar que pipeline y stage existen
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(rule.pipeline_id, tenantId);
  const stage    = db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').get(rule.stage_id, rule.pipeline_id);
  if (!pipeline || !stage) {
    console.warn(`[reelance-ia] Regla de ${maxDays}d apunta a pipeline/stage inexistente (tenant ${tenantId})`);
    return;
  }

  const prevPipelineId = lead.pipeline_id;
  const prevStageId    = lead.stage_id;

  // Si ya está en el pipeline destino, no mover (evita re-disparar bots)
  if (Number(prevPipelineId) === Number(rule.pipeline_id) && Number(prevStageId) === Number(rule.stage_id)) {
    return;
  }

  // Matar bots activos del contacto antes de mover (evita choque)
  try {
    const botEngine = require('../bot/engine');
    if (typeof botEngine.killAllForContact === 'function') {
      botEngine.killAllForContact(db, lead.contact_id, tenantId);
    }
  } catch (_) {}

  // Mover el lead
  db.prepare(`
    UPDATE expedients SET pipeline_id = ?, stage_id = ?, updated_at = unixepoch(), stage_entered_at = unixepoch()
    WHERE id = ?
  `).run(rule.pipeline_id, rule.stage_id, lead.id);

  // Guardar tracking en custom fields (paqueteria + número de rastreo)
  try {
    const utilsSvc = require('../expedients/customFields');
    if (typeof utilsSvc?.fill === 'function') {
      if (payload.trackingCarrier) utilsSvc.fill(db, tenantId, lead.id, 'Paqueteria', payload.trackingCarrier);
      if (payload.trackingNumber)  utilsSvc.fill(db, tenantId, lead.id, 'Número de Rastreo:', payload.trackingNumber);
    }
  } catch (_) { /* opcional */ }

  // Disparar bots de salida + entrada
  try {
    const botEngine = require('../bot/engine');
    if (prevStageId && typeof botEngine.triggerPipelineStageLeave === 'function') {
      botEngine.triggerPipelineStageLeave(db, {
        expedientId: lead.id, contactId: lead.contact_id,
        pipelineId: prevPipelineId, stageId: prevStageId,
      });
    }
    if (typeof botEngine.triggerPipelineStage === 'function') {
      botEngine.triggerPipelineStage(db, {
        expedientId: lead.id, contactId: lead.contact_id,
        pipelineId: rule.pipeline_id, stageId: rule.stage_id,
        eventType: 'moved',
      });
    }
    console.log(`[reelance-ia] lead #${lead.id} (${maxDays}d) → pipeline ${rule.pipeline_id} stage ${rule.stage_id}`);
  } catch (e) {
    console.error('[reelance-ia] error disparando bots de pipeline:', e.message);
  }
}

function _safeJsonParse(s, fallback) {
  try { return JSON.parse(s || JSON.stringify(fallback)); }
  catch { return fallback; }
}

// ─── Handler: webhook de AbandonedCart ────────────────────────────────
//
// Payload esperado (Prisma AbandonedCart model):
// {
//   id: "cuid",
//   sessionId, email, name, lastName, phone,
//   cp, estado, ciudad, colonia, calle, notas,
//   totalCents, currency: "MXN",
//   status: "active" | "abandoned" | "recovered" | "converted",
//   items: [{ productId, productName, quantity, unitPriceCents }],
//   recoveryStep, recoveryCouponCode,
//   utmSource, utmMedium, utmCampaign,
//   createdAt, updatedAt
// }
function processAbandonedCartEvent(db, tenantId, payload) {
  const cfg = getConfigByTenant(db, tenantId);
  if (!cfg || !cfg.enabled) return { skipped: 'app-disabled' };

  const externalId = String(payload.id || '');
  if (!externalId) {
    _logEvent(db, { tenantId, eventType: 'abandoned_cart', externalId: '_', externalStatus: payload.status, payload, error: 'missing-id' });
    return { error: 'missing-id' };
  }

  // Idempotencia: si ya procesamos este (cart, externalId, status) exitosamente,
  // no re-disparamos bots (evita doble mensaje WhatsApp al cliente).
  if (_alreadyProcessed(db, tenantId, 'abandoned_cart', externalId, payload.status)) {
    return { skipped: 'already-processed' };
  }

  try {
    const contact = _findOrCreateContact(db, tenantId, {
      email: payload.email,
      phone: payload.phone,
      firstName: payload.name || null,
      lastName: payload.lastName || null,
    });

    let lead = null;
    if (cfg.abandoned_pipeline_id && cfg.abandoned_stage_id) {
      const leadName = `Carrito abandonado #${externalId.slice(-8)}`;
      const totalMxn = payload.totalCents ? Math.round(payload.totalCents / 100) : 0;
      lead = _findOrCreateLead(db, tenantId, {
        contactId: contact.id,
        pipelineId: cfg.abandoned_pipeline_id,
        stageId: cfg.abandoned_stage_id,
        name: leadName,
        value: totalMxn,
      });
    }

    db.prepare('UPDATE reelance_ia_config SET last_abandoned_cart_at = unixepoch() WHERE tenant_id = ?').run(tenantId);

    _logEvent(db, {
      tenantId, eventType: 'abandoned_cart',
      externalId, externalStatus: payload.status,
      payload, contactId: contact.id, leadId: lead?.id,
    });

    // Si el carrito pasa a 'recovered' o 'converted', cancela cualquier
    // envío pendiente en la queue (el cliente ya compró → no spam).
    if (payload.status === 'recovered' || payload.status === 'converted') {
      try {
        db.prepare(`
          UPDATE reelance_ia_abandoned_queue
          SET status = 'cancelled', cancelled_reason = 'order_completed'
          WHERE tenant_id = ? AND external_id = ? AND status = 'pending'
        `).run(tenantId, externalId);
      } catch (_) { /* tabla puede no existir en DBs viejas */ }
      return { ok: true, contactId: contact.id, leadId: lead?.id || null, recovered: true };
    }

    // Solo procesamos status='abandoned' para envío de mensaje
    if (payload.status !== 'abandoned') {
      return { ok: true, contactId: contact.id, leadId: lead?.id || null, status: payload.status };
    }

    // Aplicar etiqueta configurada (a contact, lead, o both según target)
    if (cfg.abandoned_tag) {
      _applyTag(db, {
        tenantId, contactId: contact.id, leadId: lead?.id,
        tagName: cfg.abandoned_tag,
        target: cfg.abandoned_tag_target || 'contact',
      });
    }

    // Anti-spam: si al mismo contacto ya se le envió un msg de carrito
    // abandonado en las últimas X horas, no mandar otro (configurable).
    const dedupeHours = Number(cfg.abandoned_dedupe_hours ?? 24);
    if (dedupeHours > 0) {
      try {
        const recent = db.prepare(`
          SELECT id FROM reelance_ia_abandoned_queue
          WHERE tenant_id = ? AND contact_id = ?
            AND status = 'sent' AND sent_at > unixepoch() - (? * 3600)
          LIMIT 1
        `).get(tenantId, contact.id, dedupeHours);
        if (recent) {
          // Marca registro nuevo como cancelado por dedupe para que quede traza
          db.prepare(`
            INSERT INTO reelance_ia_abandoned_queue
              (tenant_id, external_id, contact_id, lead_id, customer_phone, customer_name,
               cart_total, payload_json, bot_id, status, scheduled_at, cancelled_reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'cancelled', unixepoch(), 'dedupe')
          `).run(tenantId, externalId, contact.id, lead?.id || null,
                 payload.phone || null, payload.name || null,
                 payload.totalCents ? payload.totalCents / 100 : null,
                 JSON.stringify(payload).slice(0, 8000),
                 cfg.abandoned_bot_id || null);
          return { ok: true, contactId: contact.id, leadId: lead?.id || null, dedupe: true };
        }
      } catch (_) { /* silenciar */ }
    }

    // Tiempo de espera antes de mandar el mensaje
    const waitMinutes = Number(cfg.abandoned_wait_minutes ?? 60);
    const scheduledAt = Math.floor(Date.now() / 1000) + (waitMinutes * 60);

    if (waitMinutes <= 0) {
      // Envío inmediato (comportamiento legacy si user pone 0)
      if (cfg.abandoned_bot_id) {
        _fireBot(db, tenantId, cfg.abandoned_bot_id, contact.id, lead?.id, { source: 'reelance-ia.abandoned_cart', cart: payload });
      }
      // Igual lo registramos en la queue como sent
      try {
        db.prepare(`
          INSERT INTO reelance_ia_abandoned_queue
            (tenant_id, external_id, contact_id, lead_id, customer_phone, customer_name,
             cart_total, payload_json, bot_id, status, scheduled_at, sent_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', unixepoch(), unixepoch())
        `).run(tenantId, externalId, contact.id, lead?.id || null,
               payload.phone || null, payload.name || null,
               payload.totalCents ? payload.totalCents / 100 : null,
               JSON.stringify(payload).slice(0, 8000),
               cfg.abandoned_bot_id || null);
      } catch (_) {}
    } else {
      // Encolar para envío diferido. El poller lo dispara cuando llegue el tiempo.
      try {
        db.prepare(`
          INSERT INTO reelance_ia_abandoned_queue
            (tenant_id, external_id, contact_id, lead_id, customer_phone, customer_name,
             cart_total, payload_json, bot_id, status, scheduled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(tenantId, externalId, contact.id, lead?.id || null,
               payload.phone || null, payload.name || null,
               payload.totalCents ? payload.totalCents / 100 : null,
               JSON.stringify(payload).slice(0, 8000),
               cfg.abandoned_bot_id || null,
               scheduledAt);
      } catch (err) {
        console.error('[reelance-ia] queue insert failed:', err.message);
      }
    }

    return {
      ok: true, contactId: contact.id, leadId: lead?.id || null,
      scheduledAt, waitMinutes,
    };
  } catch (err) {
    _logEvent(db, { tenantId, eventType: 'abandoned_cart', externalId, externalStatus: payload.status, payload, error: err.message });
    throw err;
  }
}

// Lazy require de bot engine para evitar circular deps
function _fireBot(db, tenantId, botId, contactId, leadId, ctx) {
  try {
    const botEngine = require('../bot/engine');
    if (typeof botEngine.triggerById === 'function') {
      botEngine.triggerById(db, { botId, tenantId, contactId, leadId, ctx }).catch(() => {});
    } else if (typeof botEngine.runBot === 'function') {
      botEngine.runBot(db, { botId, tenantId, contactId, leadId, ctx }).catch(() => {});
    }
  } catch (_) { /* silenciar — bot opcional */ }
}

// ─── Poller de carritos abandonados pendientes ──────────────────────
// Cada minuto revisa la queue y dispara los carritos cuyo wait_minutes
// ya se cumplió. Si el cliente recuperó el carrito antes (status pasó
// a 'recovered' o 'converted'), processAbandonedCartEvent ya marcó el
// registro como cancelled y no se dispara.
async function _dispatchPendingAbandonedCarts(db) {
  let rows;
  try {
    rows = db.prepare(`
      SELECT id, tenant_id, external_id, contact_id, lead_id, bot_id,
             customer_phone, customer_name, payload_json
      FROM reelance_ia_abandoned_queue
      WHERE status = 'pending' AND scheduled_at <= unixepoch()
      ORDER BY scheduled_at ASC LIMIT 20
    `).all();
  } catch (_) { return; /* tabla no existe (DB vieja) */ }

  for (const row of rows) {
    let payload = {};
    try { payload = JSON.parse(row.payload_json || '{}'); } catch (_) {}

    try {
      const cfg = getConfigByTenant(db, row.tenant_id);
      let dispatchedAs = 'none';

      // Prioridad: template_id sobre bot_id (templates funcionan fuera de
      // ventana 24h de WA — los bots con msgs libres no).
      if (cfg && cfg.abandoned_template_id) {
        await _sendAbandonedTemplate(db, row, payload, cfg.abandoned_template_id);
        dispatchedAs = `template ${cfg.abandoned_template_id}`;
      } else if (row.bot_id) {
        _fireBot(db, row.tenant_id, row.bot_id, row.contact_id, row.lead_id, {
          source: 'reelance-ia.abandoned_cart.delayed',
          cart: payload,
        });
        dispatchedAs = `bot ${row.bot_id}`;
      } else {
        // Ni bot ni template configurado → no se manda nada, queda en log
        dispatchedAs = 'skipped (sin bot ni template)';
      }

      db.prepare(`
        UPDATE reelance_ia_abandoned_queue
        SET status = 'sent', sent_at = unixepoch() WHERE id = ?
      `).run(row.id);
      console.log(`[reelance-ia] abandoned cart ${row.external_id} → ${dispatchedAs} (contact ${row.contact_id})`);
    } catch (err) {
      db.prepare(`
        UPDATE reelance_ia_abandoned_queue
        SET status = 'failed', error = ? WHERE id = ?
      `).run((err.message || String(err)).slice(0, 500), row.id);
      console.error('[reelance-ia] dispatch failed:', err.message);
    }
  }
}

// Wrapper que adapta el row del queue al _sendTemplateMessage compartido
async function _sendAbandonedTemplate(db, row, payload, templateId) {
  const phone = row.customer_phone || payload.phone || '';
  if (!phone) throw new Error('sin teléfono');
  return _sendTemplateMessage(db, {
    tenantId:    row.tenant_id,
    contactId:   row.contact_id,
    contactName: row.customer_name,
    phone,
    templateId,
    payload,
    kind: 'abandoned_cart',
  });
}

function startAbandonedCartPoller(db) {
  // Tick cada 60s (mismo intervalo que el woo abandoned cart poller).
  setInterval(() => {
    _dispatchPendingAbandonedCarts(db).catch(e =>
      console.error('[reelance-ia poller] tick error:', e.message)
    );
  }, 60_000);
  console.log('[reelance-ia] abandoned cart poller iniciado (cada 60s)');
}

module.exports = {
  generateToken,
  getConfigByToken,
  getConfigByTenant,
  ensureConfig,
  updateConfig,
  regenerateToken,
  processOrderEvent,
  processAbandonedCartEvent,
  startAbandonedCartPoller,
};
