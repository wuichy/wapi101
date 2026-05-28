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

    // Disparar bot opcional (sin esperar)
    if (cfg.order_bot_id) {
      _fireBot(db, tenantId, cfg.order_bot_id, contact.id, lead?.id, { source: 'reelance-ia.order', order: payload });
    }

    return { ok: true, contactId: contact.id, leadId: lead?.id || null };
  } catch (err) {
    _logEvent(db, { tenantId, eventType: 'order', externalId, externalStatus: payload.status, payload, error: err.message });
    throw err;
  }
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

    // Disparar bot solo cuando entra a status='abandoned' (no en 'active' ni en 'recovered')
    if (payload.status === 'abandoned' && cfg.abandoned_bot_id) {
      _fireBot(db, tenantId, cfg.abandoned_bot_id, contact.id, lead?.id, { source: 'reelance-ia.abandoned_cart', cart: payload });
    }

    return { ok: true, contactId: contact.id, leadId: lead?.id || null };
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

module.exports = {
  generateToken,
  getConfigByToken,
  getConfigByTenant,
  ensureConfig,
  updateConfig,
  regenerateToken,
  processOrderEvent,
  processAbandonedCartEvent,
};
