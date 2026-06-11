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
    'order_tag', 'order_tag_target', 'order_template_id', 'order_stop_active_bots',
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

// ¿El nombre actual del contacto parece "test/garbage data"? Permite
// sobrescribir info vieja cuando llegan datos reales de una orden/carrito.
// Heurísticas: muy corto, repeticiones de la misma letra, "asdf"/"qwer",
// o nombres que empiezan con "Contacto " (fallback de creación).
function _looksLikeTestData(name) {
  if (!name) return true;
  const s = String(name).trim().toLowerCase();
  if (s.length < 2) return true;
  if (s.startsWith('contacto')) return true;
  if (/^(asd|qwe|test|prueba|xxx|aaa)/i.test(s)) return true;
  // Solo una letra repetida (ej "aaaaa")
  if (/^(.)\1+$/.test(s)) return true;
  return false;
}

// ¿El teléfono parece test data? (muy corto, todos iguales, etc.)
function _looksLikeTestPhone(phone) {
  if (!phone) return true;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 8) return true;
  if (/^(\d)\1+$/.test(digits)) return true; // todos iguales
  if (/^123/.test(digits) && digits.length < 12) return true; // 1231231, etc.
  return false;
}

// Crea o encuentra un contacto. Estrategia de matching:
//   1) Por phone normalizado (E.164) — el más confiable
//   2) Por últimos 10 dígitos del phone (fuzzy)
//   3) Por email (solo si phone no matcheó NADA)
// Razón: el email puede compartirse entre contactos o quedar viejo. El
// phone es único por contacto en WhatsApp.
function _findOrCreateContact(db, tenantId, { email, phone, firstName, lastName }) {
  let contact = null;
  const normPhone = _normalizePhone(phone);

  // ── 1) MATCH POR PHONE (más confiable) ──────────────────────────────
  if (normPhone) {
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ? AND tenant_id = ? LIMIT 1').get(normPhone, tenantId);
    if (!contact) {
      const last10 = normPhone.replace(/\D/g, '').slice(-10);
      if (last10.length === 10) {
        contact = db.prepare(
          "SELECT * FROM contacts WHERE SUBSTR(REPLACE(REPLACE(REPLACE(phone,'+',''),'-',''),' ',''), -10) = ? AND tenant_id = ? LIMIT 1"
        ).get(last10, tenantId);
      }
    }
  }

  // ── 2) Fallback: match por email — pero SOLO si ese contacto NO tiene
  //      un phone distinto al del payload. Si el contacto matcheado por
  //      email tiene phone diferente, es otra persona compartiendo email
  //      (o un test viejo) — no lo usemos.
  if (!contact && email) {
    const byEmail = db.prepare('SELECT * FROM contacts WHERE email = ? AND tenant_id = ? LIMIT 1').get(email, tenantId);
    if (byEmail) {
      // REGLA wuichy: matchear por mail O teléfono. Si el email coincide es
      // el mismo cliente aunque haya puesto otro teléfono (caso real: dejó
      // carrito con un celular y compró con otro — mismo email = misma
      // persona). El nombre/phone se actualiza abajo si llega info mejor.
      contact = byEmail;
    }
  }

  // ── 3) CREAR si no encontramos nada ─────────────────────────────────
  if (!contact) {
    const first = firstName || (email ? email.split('@')[0] : null) || 'Contacto Reelance';
    const last  = lastName || null;
    const result = db.prepare(
      'INSERT INTO contacts (tenant_id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)'
    ).run(tenantId, first, last, email || null, normPhone);
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
  }

  // ── 4) ACTUALIZAR contacto existente con info "mejor" ───────────────
  // Sobrescribir si el campo actual está vacío O parece test data.
  const updates = [];
  const args = [];
  if (email && (!contact.email || _looksLikeTestData(contact.email))) {
    updates.push('email = ?'); args.push(email);
  }
  if (firstName && (!contact.first_name || _looksLikeTestData(contact.first_name))) {
    updates.push('first_name = ?'); args.push(firstName);
  }
  if (lastName && (!contact.last_name || _looksLikeTestData(contact.last_name))) {
    updates.push('last_name = ?'); args.push(lastName);
  }
  if (normPhone && (!contact.phone || _looksLikeTestPhone(contact.phone))) {
    updates.push('phone = ?'); args.push(normPhone);
  }
  if (updates.length) {
    args.push(contact.id);
    db.prepare(`UPDATE contacts SET ${updates.join(', ')}, updated_at = unixepoch() WHERE id = ?`).run(...args);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  }
  return contact;
}

// Crea o encuentra lead para el contacto en el pipeline/stage configurado.
// Si ya hay lead en ese pipeline, lo reusa y mueve al stage configurado
// (comportamiento "cliente ya existe → mover a etapa correcta").

// Setea un valor de custom_field_values por label del field (busca el field def).
function _setCustomField(db, tenantId, leadId, labelRegex, value) {
  if (!leadId || value == null || value === '') return;
  try {
    // SQLite no tiene REGEXP nativo. Cargamos todos los defs y matcheamos en JS.
    const rows = db.prepare(
      "SELECT id, label FROM custom_field_defs WHERE tenant_id = ? AND entity = 'expedient'"
    ).all(tenantId);
    const re = new RegExp(labelRegex, 'i');
    const fd = rows.find(r => re.test(r.label));
    if (!fd) {
      console.warn(`[_setCustomField] no field def matched /${labelRegex}/i — fields:`, rows.map(r => r.label).join(', '));
      return;
    }
    db.prepare(`
      INSERT INTO custom_field_values (tenant_id, entity, record_id, field_id, value)
      VALUES (?, 'expedient', ?, ?, ?)
      ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
    `).run(tenantId, leadId, fd.id, String(value));
    console.log(`[_setCustomField] lead ${leadId} field "${fd.label}" = "${String(value).slice(0,40)}"`);
  } catch (e) { console.warn('[_setCustomField]', e.message); }
}

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
  } else if (Number(lead.stage_id) !== Number(stageId)) {
    // Lead existe en este pipeline pero en otro stage → mover al stage configurado.
    db.prepare(`
      UPDATE expedients SET stage_id = ?, stage_entered_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(stageId, lead.id);
    lead = db.prepare('SELECT * FROM expedients WHERE id = ?').get(lead.id);
  }
  return lead;
}

// REGLA wuichy: una sola base de datos. El lead "existe" si el contacto ya
// tiene CUALQUIER expediente (en cualquier pipeline — incluido el histórico
// de Kommo). Devuelve el más reciente. Nunca se crea un lead nuevo si ya hay.
function _findExistingLead(db, tenantId, contactId) {
  if (!contactId) return null;
  return db.prepare(`
    SELECT * FROM expedients
    WHERE contact_id = ? AND tenant_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(contactId, tenantId);
}

// Mueve un lead existente a pipeline/stage destino (reusa, NO crea otro).
// Actualiza nombre y valor si se pasan. Resetea stage_entered_at para que
// las alarmas y bots de la nueva etapa cuenten desde ahora.
function _moveLead(db, tenantId, leadId, { pipelineId, stageId, name, value }) {
  const sets = ['pipeline_id = ?', 'stage_id = ?', 'stage_entered_at = unixepoch()', 'updated_at = unixepoch()'];
  const args = [pipelineId, stageId];
  if (name)            { sets.push('name = ?');  args.push(name); }
  if (value != null)   { sets.push('value = ?'); args.push(value); }
  args.push(leadId);
  db.prepare(`UPDATE expedients SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return db.prepare('SELECT * FROM expedients WHERE id = ?').get(leadId);
}

// Crea un lead nuevo (solo cuando NO existe ninguno para el contacto).
function _createLead(db, tenantId, { contactId, pipelineId, stageId, name, value }) {
  if (!pipelineId || !stageId) return null;
  const result = db.prepare(`
    INSERT INTO expedients (tenant_id, contact_id, pipeline_id, stage_id, name, value)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, contactId, pipelineId, stageId, name || null, value || 0);
  return db.prepare('SELECT * FROM expedients WHERE id = ?').get(result.lastInsertRowid);
}

// Formato dd/MM/yyyy en TZ America/Mexico_City. Usado para nombres de
// lead ("Luis Melchor 28/05/2026") — consistente con leads importados
// históricamente desde Kommo.
function _formatDateMx(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (isNaN(d.getTime())) return '';
  const fmt = new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    timeZone: 'America/Mexico_City',
  });
  return fmt.format(d);
}

// Resuelve placeholders en el nombre de la etiqueta.
// Soporta: {order_id}, {order_short}, {customer_name}, {phone}, {email}
// Ejemplos:
//   cfg.order_tag = "{order_id}"           → "ms7bqsu9"  (8 chars cortos)
//   cfg.order_tag = "Orden {order_short}"  → "Orden ms7bqsu9"
//   cfg.order_tag = "Comprador"            → "Comprador" (literal, sin {})
function _resolveTagTemplate(tag, payload) {
  if (!tag) return null;
  const id = String(payload?.id || '');
  const shortId = id ? id.slice(-8) : '';
  return String(tag)
    .replace(/\{order_id\}/gi, shortId)
    .replace(/\{order_short\}/gi, shortId)
    .replace(/\{cart_id\}/gi, shortId)
    .replace(/\{customer_name\}/gi, payload?.customerName || payload?.name || '')
    .replace(/\{phone\}/gi, payload?.phone || '')
    .replace(/\{email\}/gi, payload?.email || '')
    .trim() || null;
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
async function _sendTemplateMessage(db, { tenantId, contactId, contactName, phone, templateId, payload, kind, leadId = null }) {
  if (!templateId || !phone) return;
  const convoSvc = require('../conversations/service');
  const sender   = require('../conversations/sender');

  // ── Resolver el número CORRECTO para Meta ──────────────────────────────
  // BUG histórico: payload.phone de reelance.mx a veces viene SIN código de
  // país (ej "6444628803") → Meta acepta el send pero NO entrega plantillas
  // (error 131026 "número sin WhatsApp"), aunque los mensajes libres SÍ
  // llegan (esos usan el external_id de la convo que WhatsApp ya validó).
  // Prioridad para máxima entregabilidad:
  //   1) external_id de una convo whatsapp existente del contacto (el número
  //      EXACTO que WhatsApp validó — mismo que usan los mensajes que llegan)
  //   2) phone del contacto en DB (normalizado)
  //   3) payload.phone normalizado a E.164 MX (último recurso)
  let externalId = null;
  // 1) Phone del CONTACTO (canónico, normalizado a E.164 MX). Es la fuente más
  //    confiable: el matching de contactos lo guarda con código país completo.
  if (contactId) {
    const c = db.prepare('SELECT phone FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, tenantId);
    if (c && c.phone) {
      const norm = _normalizePhone(c.phone);
      const d = (norm || String(c.phone)).replace(/\D/g, '');
      if (d.length >= 12) externalId = d;  // solo si tiene código país completo
    }
  }
  // 2) external_id de convo whatsapp BIEN FORMADA del contacto (>=12 díg, 52*)
  if (!externalId && contactId) {
    const convoRow = db.prepare(
      "SELECT external_id FROM conversations WHERE tenant_id = ? AND contact_id = ? AND provider = 'whatsapp' AND external_id IS NOT NULL AND length(replace(external_id,'+','')) >= 12 ORDER BY last_message_at DESC LIMIT 1"
    ).get(tenantId, contactId);
    if (convoRow && convoRow.external_id) externalId = String(convoRow.external_id).replace(/\D/g, '');
  }
  // 3) Último recurso: payload.phone normalizado (puede venir sin código país)
  if (!externalId) {
    const norm = _normalizePhone(phone);
    externalId = (norm || String(phone)).replace(/\D/g, '');
  }
  // Throw (no return silencioso): el caller debe registrar el fallo — si no,
  // la cola de carritos marcaría 'sent' sin haber enviado nada.
  if (!externalId) throw new Error(`no se pudo resolver número del cliente (contacto ${contactId || 's/n'})`);
  if (externalId !== String(phone).replace(/\D/g, '')) {
    console.log('[reelance-ia] template phone normalizado: payload=' + String(phone).replace(/\D/g,'') + ' → enviado=' + externalId);
  }

  const waIntegration = db.prepare(
    "SELECT id FROM integrations WHERE provider = 'whatsapp' AND tenant_id = ? ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, id DESC LIMIT 1"
  ).get(tenantId);
  if (!waIntegration) throw new Error('sin integración whatsapp connected');

  const convo = convoSvc.findOrCreate(db, tenantId, {
    provider:      'whatsapp',
    externalId,
    contactPhone:  '+' + externalId,
    contactName:   contactName || null,
    contactId:     contactId || null,
    integrationId: waIntegration.id,
  });

  const firstName = (contactName || '').split(/\s+/)[0] || 'Cliente';
  // Placeholders comunes:
  //   {{1}} = nombre del cliente
  //   {{2}} = URL (recovery para abandoned_cart, tracking_url para order)
  //   {{3}} = total
  // Placeholders del template:
  //   {{1}} = nombre cliente
  //   {{2}} = (order)   shortOrderId si no hay trackingUrl, sino trackingUrl
  //           (abandoned_cart) recoveryUrl/cartUrl
  //   {{3}} = total en MXN (entero)
  const shortOrderId = payload?.id ? String(payload.id).slice(-8) : '';
  const placeholder2 = kind === 'abandoned_cart'
    ? (payload.recoveryUrl || payload.cartUrl || '')
    : (payload.trackingUrl || shortOrderId || '');
  const manualValues = [
    firstName,
    placeholder2,
    payload.totalCents ? String(Math.round(payload.totalCents / 100)) : '',
  ];

  let result;
  try {
    result = await sender.sendWhatsAppTemplate(db, convo, templateId, manualValues, { autoFallback: true, leadId });
  } catch (err) {
    // Persistir el fallo en el chat (burbuja roja + badge deliveryFailure).
    // Además la convo recién creada deja de ser "fantasma": muestra qué pasó.
    try {
      convoSvc.addMessage(db, tenantId, convo.id, {
        direction:  'outgoing',
        provider:   'whatsapp',
        body:       `📋 Plantilla #${templateId} (no enviada — ${kind === 'abandoned_cart' ? 'carrito abandonado' : 'orden'})`,
        status:     'failed',
        errorReason: err.message,
      });
    } catch (_) { /* no enmascarar el error original */ }
    throw err;
  }
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
    WHERE tenant_id = ? AND event_type = ? AND external_id = ? AND external_status IS ?
    LIMIT 1
  `).get(tenantId, eventType, externalId, externalStatus || null);
  // ("IS ?" en vez de "= ?": con status NULL, "= NULL" nunca matchea en SQL y
  // la idempotencia quedaba rota para eventos sin status)
  // Solo consideramos "ya procesado" si no falló — si tuvo error, vale reintentar
  return !!(row && !row.error);
}

// Conserva el rastreo ya capturado. Cuando la tienda reenvía una orden (sync de
// estatus PROCESSING→COMPLETED, etc.) el payload entrante NO trae el
// trackingCarrier/Number que el usuario guardó a mano en wapi. Como el endpoint
// /orders muestra siempre la fila con MAX(processed_at), esa fila nueva sin
// rastreo "borraría" visualmente el tracking. Aquí lo arrastramos del último
// evento previo del mismo external_id para que NUNCA se pierda. Solo rellena
// huecos: si el payload entrante ya trae rastreo, ese gana.
function _mergeForwardTracking(db, tenantId, externalId, payload) {
  const p = payload || {};
  if (!externalId) return p;
  if (p.trackingCarrier && p.trackingNumber) return p; // el entrante ya trae rastreo
  try {
    const prev = db.prepare(`
      SELECT payload FROM reelance_ia_events
      WHERE tenant_id = ? AND event_type = 'order' AND external_id = ?
      ORDER BY processed_at DESC LIMIT 1
    `).get(tenantId, String(externalId));
    if (!prev) return p;
    let pp = {};
    try { pp = JSON.parse(prev.payload || '{}'); } catch { return p; }
    if (!pp.trackingCarrier && !pp.trackingNumber) return p; // nada que conservar
    return {
      ...p,
      trackingCarrier: p.trackingCarrier || pp.trackingCarrier || null,
      trackingNumber:  p.trackingNumber  || pp.trackingNumber  || null,
      trackingUrl:     p.trackingUrl     || pp.trackingUrl     || null,
      trackingStatus:  p.trackingStatus  || pp.trackingStatus  || null,
    };
  } catch (_) { return p; }
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

  // Guard: sin phone NI email no podemos identificar al cliente.
  // Loguear y skip (evita crear "Contacto Reelance" basura).
  if (!payload.phone && !payload.email) {
    _logEvent(db, { tenantId, eventType: 'order', externalId, externalStatus: payload.status, payload, error: 'no-contact-info' });
    return { skipped: 'no-contact-info' };
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

    // Status de pago NO exitoso: un pedido FAILED/CANCELLED no debe convertir
    // al lead en "Cliente Final" ni asignarle valor (bug: pagos fallidos
    // contaban como clientes). Se calcula aquí porque también gatea el
    // movimiento de pipeline, no solo la notificación.
    const NO_NOTIFY_STATUSES = ['FAILED', 'CANCELLED', 'REFUNDED', 'VOIDED'];
    const orderStatusUpper = String(payload.status || '').toUpperCase();
    const isFailedPayment = NO_NOTIFY_STATUSES.includes(orderStatusUpper);

    // ─── REGLA wuichy (orden): UNA sola base de datos ──────────────────
    // 1) Buscar si el contacto YA tiene un lead (cualquier pipeline, incl.
    //    histórico de Kommo). 2) Si existe → MOVERLO a CLIENTES/Cliente Final
    //    (nunca crear otro). 3) Si no existe → crear ahí.
    let lead = null;
    if (cfg.order_pipeline_id && cfg.order_stage_id && !isFailedPayment) {
      // Nombre del lead = "Nombre Apellido dd/MM/yyyy" (consistente con Kommo).
      const leadName = customerName
        ? `${customerName} ${_formatDateMx(payload.createdAt)}`
        : `Orden #${externalId.slice(-8)}`;
      const totalMxn = payload.totalCents ? Math.round(payload.totalCents / 100) : 0;

      const existing = _findExistingLead(db, tenantId, contact.id);
      if (existing) {
        // Lead existe → reusar: mover a CLIENTES/Cliente Final + actualizar nombre/valor.
        lead = _moveLead(db, tenantId, existing.id, {
          pipelineId: cfg.order_pipeline_id,
          stageId:    cfg.order_stage_id,
          name:       leadName,
          value:      totalMxn,
        });
        console.log(`[reelance-ia] orden: lead existente #${existing.id} → CLIENTES/Cliente Final (reusado, no se crea otro)`);
      } else {
        // No existe → crear en CLIENTES/Cliente Final.
        lead = _createLead(db, tenantId, {
          contactId: contact.id,
          pipelineId: cfg.order_pipeline_id,
          stageId:    cfg.order_stage_id,
          name:       leadName,
          value:      totalMxn,
        });
        console.log(`[reelance-ia] orden: lead nuevo #${lead?.id} en CLIENTES/Cliente Final`);
      }

      if (lead) {
        // Custom field "Ultima Compra" → fecha ISO de la compra
        const purchaseDate = payload.createdAt || new Date().toISOString();
        _setCustomField(db, tenantId, lead.id, 'ultima.?compra', purchaseDate);
        // Custom field "# Pedido" → últimos 8 chars del order id (sin "#")
        const shortOrderId = externalId ? String(externalId).slice(-8) : '';
        if (shortOrderId) {
          _setCustomField(db, tenantId, lead.id, '(#\\s?)?pedido|order.?(num|id|number)', shortOrderId);
        }
      }
    }

    db.prepare('UPDATE reelance_ia_config SET last_order_at = unixepoch() WHERE tenant_id = ?').run(tenantId);

    _logEvent(db, {
      tenantId, eventType: 'order',
      externalId, externalStatus: payload.status,
      // Conservar el rastreo previo si este evento (p.ej. sync de estatus) no lo trae,
      // para que el tracking guardado a mano no se pierda en re-syncs de la tienda.
      payload: _mergeForwardTracking(db, tenantId, externalId, payload),
      contactId: contact.id, leadId: lead?.id,
    });

    // Aplicar etiqueta configurada (a contact, lead, o both según target).
    // El nombre soporta placeholders — ej "{order_id}" → "ms7bqsu9".
    const resolvedOrderTag = _resolveTagTemplate(cfg.order_tag, payload);
    if (resolvedOrderTag) {
      _applyTag(db, {
        tenantId, contactId: contact.id, leadId: lead?.id,
        tagName: resolvedOrderTag,
        target: cfg.order_tag_target || 'contact',
      });
    }

    // Prioridad: plantilla WA API > bot.
    // Las órdenes pueden estar fuera de ventana 24h (cliente compró pero no
    // nos escribió), por eso template es más confiable.
    // NO notificar "compra confirmada" en órdenes con pago fallido/cancelado/
    // reembolsado — sería un mensaje erróneo al cliente (bug: pedidos FAILED
    // de Rebeca Carrillo recibieron plantilla de compra exitosa).
    // payload.statusSync === true → este POST es un SYNC de estatus desde
    // reelance.mx (el admin cambió/canceló/reembolsó allá), NO una orden nueva.
    // Actualizamos external_status + movemos pipeline arriba, pero NO re-enviamos
    // la plantilla "compra confirmada" (el cliente ya la recibió al comprar).
    // Guard extra anti-doble-plantilla: si OTRO status de esta MISMA orden ya
    // se procesó exitosamente (ej. llegó PENDING y ahora PAID sin statusSync),
    // el cliente ya recibió su confirmación — no se reenvía. Si aquel envío
    // FALLÓ (error en el evento), sí se reintenta aquí.
    const alreadyNotified = !!db.prepare(`
      SELECT 1 FROM reelance_ia_events
      WHERE tenant_id = ? AND event_type = 'order' AND external_id = ?
        AND external_status IS NOT ? AND error IS NULL
        AND UPPER(COALESCE(external_status,'')) NOT IN ('FAILED','CANCELLED','REFUNDED','VOIDED')
      LIMIT 1
    `).get(tenantId, externalId, payload.status || null);
    const skipNotify = isFailedPayment || payload.statusSync === true || alreadyNotified;

    if (skipNotify) {
      const skipReason = payload.statusSync ? 'sync de estatus desde reelance (no es orden nueva)'
        : (alreadyNotified ? 'ya se notificó esta orden con otro status' : 'pago no exitoso');
      console.log(`[reelance-ia] orden ${externalId} status=${orderStatusUpper} → NO se envía notificación de compra (${skipReason})`);
    } else if (cfg.order_template_id) {
      _sendTemplateMessage(db, {
        tenantId,
        contactId:   contact.id,
        contactName: customerName || null,
        phone:       payload.phone || null,
        templateId:  cfg.order_template_id,
        payload,
        kind: 'order',
        leadId: lead?.id || null,
      }).catch(err => {
        console.error('[reelance-ia] order template send failed:', err.message);
        // Re-loggear el evento CON error para que _alreadyProcessed permita
        // reintento en el próximo re-sync de la tienda. Sin esto, el evento ya
        // quedó marcado exitoso y la plantilla se perdía PARA SIEMPRE (pasó
        // con las órdenes del 9-10 jun durante el token caducado).
        _logEvent(db, {
          tenantId, eventType: 'order',
          externalId, externalStatus: payload.status,
          payload: _mergeForwardTracking(db, tenantId, externalId, payload),
          contactId: contact.id, leadId: lead?.id,
          error: ('template-send-failed: ' + err.message).slice(0, 300),
        });
      });
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

  // ⚠️ ORDEN CRÍTICO: parar bots viejos ANTES de disparar el bot del nuevo
  // stage. Si esto corriera DESPUÉS de triggerPipelineStage, mataría el bot
  // de nurturing recién disparado (bug histórico: leads estancados en 2:1
  // porque el bot de la etapa moría en 0s justo tras nacer — la orden los
  // movía al stage, disparaba el bot, y order_stop_active_bots lo mataba).
  if (cfg.order_stop_active_bots) {
    try {
      const engine = require('../bot/engine');
      const runs = db.prepare(
        "SELECT id FROM bot_runs WHERE tenant_id = ? AND (expedient_id = ? OR contact_id = ?) AND status IN ('running','paused')"
      ).all(tenantId, lead.id, lead.contact_id);
      let killed = 0;
      for (const r of runs) {
        try { engine.killRun(db, r.id); killed++; } catch (_) {}
      }
      if (killed > 0) console.log(`[reelance-ia] stop_active_bots: ${killed} bot_runs killed para lead ${lead.id}`);
    } catch (e) { console.warn('[ria route-pipeline] stop bots failed:', e.message); }
  }

  // Disparar bots de salida + entrada (DESPUÉS de matar los viejos, para que
  // el bot del nuevo stage sobreviva).
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

  // Guard: sin phone NI email no podemos identificar al cliente.
  // Carritos de visitantes anónimos (sin login) no deben crear "Contacto
  // Reelance" basura.
  if (!payload.phone && !payload.email) {
    _logEvent(db, { tenantId, eventType: 'abandoned_cart', externalId, externalStatus: payload.status, payload, error: 'no-contact-info' });
    return { skipped: 'no-contact-info' };
  }

  try {
    const contact = _findOrCreateContact(db, tenantId, {
      email: payload.email,
      phone: payload.phone,
      firstName: payload.name || null,
      lastName: payload.lastName || null,
    });

    // ─── REGLA wuichy (carrito): UNA sola base de datos ───────────────
    // Si el contacto YA tiene un lead (cualquier pipeline, incl. Kommo) →
    // NO se crea ni se mueve: el lead se queda donde está y SOLO se manda el
    // mensaje de recuperación. Si NO existe → crear contacto+lead en
    // WHATSAPP/Cartbounty (abandoned_pipeline/stage) y mandar mensaje.
    let lead = _findExistingLead(db, tenantId, contact.id);
    if (lead) {
      console.log(`[reelance-ia] carrito: lead existente #${lead.id} → solo mensaje (no se crea ni mueve)`);
    } else if (cfg.abandoned_pipeline_id && cfg.abandoned_stage_id) {
      const leadName = `Carrito abandonado #${externalId.slice(-8)}`;
      const totalMxn = payload.totalCents ? Math.round(payload.totalCents / 100) : 0;
      lead = _createLead(db, tenantId, {
        contactId: contact.id,
        pipelineId: cfg.abandoned_pipeline_id,
        stageId: cfg.abandoned_stage_id,
        name: leadName,
        value: totalMxn,
      });
      console.log(`[reelance-ia] carrito: lead nuevo #${lead?.id} en WHATSAPP/Cartbounty`);
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

    // Aplicar etiqueta configurada (a contact, lead, o both según target).
    // Soporta placeholders — ej "{cart_id}" → "e5pc057v".
    const resolvedAbandonedTag = _resolveTagTemplate(cfg.abandoned_tag, payload);
    if (resolvedAbandonedTag) {
      _applyTag(db, {
        tenantId, contactId: contact.id, leadId: lead?.id,
        tagName: resolvedAbandonedTag,
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
             customer_phone, customer_name, payload_json, attempts
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
      // Retry con backoff: hasta 3 intentos (15/30 min entre cada uno) antes
      // de marcar failed definitivo. Un fallo transitorio (token renovándose,
      // Meta caído) ya no pierde el carrito para siempre.
      const errMsg = (err.message || String(err)).slice(0, 500);
      const attempts = (row.attempts ?? 0) + 1;
      const MAX_ATTEMPTS = 3;
      try {
        if (attempts < MAX_ATTEMPTS) {
          db.prepare(`
            UPDATE reelance_ia_abandoned_queue
            SET attempts = ?, error = ?, scheduled_at = unixepoch() + ?
            WHERE id = ?
          `).run(attempts, errMsg, attempts * 15 * 60, row.id);
          console.error(`[reelance-ia] dispatch failed (intento ${attempts}/${MAX_ATTEMPTS}, reintenta en ${attempts * 15} min):`, errMsg);
        } else {
          db.prepare(`
            UPDATE reelance_ia_abandoned_queue
            SET status = 'failed', attempts = ?, error = ? WHERE id = ?
          `).run(attempts, errMsg, row.id);
          console.error(`[reelance-ia] dispatch failed DEFINITIVO tras ${attempts} intentos:`, errMsg);
        }
      } catch (_) {
        // DB vieja sin columna attempts → comportamiento anterior
        db.prepare(`UPDATE reelance_ia_abandoned_queue SET status = 'failed', error = ? WHERE id = ?`).run(errMsg, row.id);
        console.error('[reelance-ia] dispatch failed:', errMsg);
      }
    }
  }
}

// Wrapper que adapta el row del queue al _sendTemplateMessage compartido
async function _sendAbandonedTemplate(db, row, payload, templateId) {
  const phone = row.customer_phone || payload.phone || '';
  // OJO: no lanzar "sin teléfono" aquí si hay contactId — _sendTemplateMessage
  // resuelve el número desde contacts.phone como PRIMERA prioridad (carritos
  // capturados solo con email cuyo contacto SÍ tiene teléfono fallaban gratis).
  if (!phone && !row.contact_id) throw new Error('sin teléfono ni contacto');
  return _sendTemplateMessage(db, {
    tenantId:    row.tenant_id,
    contactId:   row.contact_id,
    contactName: row.customer_name,
    phone,
    templateId,
    payload,
    kind: 'abandoned_cart',
    leadId: row.lead_id || null,
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


// Borrar todos los eventos de tipo order del mismo external_id, y limpiar
// queue de abandoned si existe. NO toca el lead asociado.
function deleteOrderEvents(db, tenantId, externalId) {
  const events = db.prepare(
    "SELECT id, lead_id FROM reelance_ia_events WHERE tenant_id = ? AND event_type = 'order' AND external_id = ?"
  ).all(tenantId, externalId);
  const deletedEvents = db.prepare(
    "DELETE FROM reelance_ia_events WHERE tenant_id = ? AND event_type = 'order' AND external_id = ?"
  ).run(tenantId, externalId).changes;
  // También limpiar el queue de abandoned si quedó pending vinculado
  let deletedQueue = 0;
  try {
    deletedQueue = db.prepare(
      "DELETE FROM reelance_ia_abandoned_queue WHERE tenant_id = ? AND external_id = ?"
    ).run(tenantId, externalId).changes;
  } catch (_) {}
  console.log(`[reelance-ia] delete ${externalId}: ${deletedEvents} events, ${deletedQueue} queue items`);
  return { ok: true, externalId, deletedEvents, deletedQueue, leadIds: events.map(e => e.lead_id).filter(Boolean) };
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
  startAbandonedCartPoller, _routeOrderToPipeline, deleteOrderEvents };
