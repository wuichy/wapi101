'use strict';
const crypto = require('crypto');

// ── Normalización de teléfono para WhatsApp ──────────────────────────────────
// Devuelve formato E.164: +521XXXXXXXXXX (México), +1XXXXXXXXXX (USA), etc.
function normalizePhoneForWA(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits || digits.length < 7) return null;

  // 10 dígitos → México móvil
  if (digits.length === 10) return '+521' + digits;
  // 12 dígitos: 52 + 10 → México con country code sin 1 móvil
  if (digits.length === 12 && digits.startsWith('52') && !digits.startsWith('521'))
    return '+521' + digits.slice(2);
  // Ya tiene formato correcto (11+ dígitos con código de país)
  return '+' + digits;
}

// ── Generar token único para el webhook ──────────────────────────────────────
function generateToken() {
  return 'woo_' + crypto.randomBytes(24).toString('hex');
}

// ── Procesar pedido: status → processing ─────────────────────────────────────
function processOrderProcessing(db, tenantId, order) {
  const billing   = order.billing || {};
  const rawPhone  = billing.phone || '';
  const email     = (billing.email || '').trim().toLowerCase();
  const firstName = (billing.first_name || '').trim();
  const lastName  = (billing.last_name  || '').trim();
  const orderNum  = String(order.number || order.id);
  const orderDate = order.date_created
    ? formatDate(new Date(order.date_created))
    : formatDate(new Date());

  const phone = normalizePhoneForWA(rawPhone);

  // Encontrar o crear contacto
  let contact = findContact(db, tenantId, phone, email);

  if (contact) {
    // Ya existe → actualizar datos si Kommo/nuevo tiene más info
    db.prepare(`
      UPDATE contacts SET
        first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name  = COALESCE(NULLIF(?, ''), last_name),
        email      = COALESCE(NULLIF(?, ''), email),
        updated_at = unixepoch()
      WHERE id = ?
    `).run(firstName, lastName, email || null, contact.id);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contact.id);
  } else {
    // Crear contacto nuevo
    const r = db.prepare(`
      INSERT INTO contacts (first_name, last_name, phone, email, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(firstName, lastName, phone, email || null, tenantId);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.lastInsertRowid);
  }

  // Tags del contacto: "Cliente" + número de pedido
  addContactTag(db, tenantId, contact.id, 'Cliente');
  addContactTag(db, tenantId, contact.id, orderNum);

  // Nombre del lead: "Nombre Apellido DD/MM/AAAA"
  const leadName = `${firstName} ${lastName} ${orderDate}`.trim();

  // Pipeline/etapa inicial — usar config guardada, con fallback a búsqueda por nombre
  const wooConfig   = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(tenantId);
  let pipelineId = wooConfig?.initial_pipeline_id || null;
  let stageId    = wooConfig?.initial_stage_id    || null;

  if (!pipelineId || !stageId) {
    // Fallback: buscar por nombre (compatibilidad hacia atrás)
    const clientesPipeline = db.prepare(
      "SELECT id FROM pipelines WHERE LOWER(name) LIKE '%cliente%' AND tenant_id = ? LIMIT 1"
    ).get(tenantId);
    const recientesStage = clientesPipeline ? db.prepare(
      "SELECT id FROM stages WHERE pipeline_id = ? AND LOWER(name) LIKE '%reciente%' LIMIT 1"
    ).get(clientesPipeline.id) : null;
    pipelineId = clientesPipeline?.id || null;
    stageId    = recientesStage?.id   || null;
  }

  if (!pipelineId || !stageId) {
    console.warn('[woo] No hay pipeline/etapa configurada para pedidos nuevos (tenant', tenantId, '). Configúrala en Apps → WooCommerce → Pipelines.');
  }

  // Buscar lead existente de este contacto en el mismo pipeline
  let expedient = pipelineId ? db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
  ).get(contact.id, pipelineId, tenantId) : null;

  let expId;
  if (expedient) {
    // Actualizar nombre y mover a la etapa inicial
    db.prepare(`
      UPDATE expedients SET name = ?, stage_id = ?, updated_at = unixepoch(), stage_entered_at = unixepoch()
      WHERE id = ?
    `).run(leadName, stageId, expedient.id);
    expId = expedient.id;
  } else if (pipelineId && stageId) {
    // Crear lead nuevo
    const r = db.prepare(`
      INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, tenant_id, created_at, updated_at, stage_entered_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())
    `).run(contact.id, pipelineId, stageId, leadName, tenantId);
    expId = r.lastInsertRowid;
  }

  // Tag del lead: número de pedido únicamente
  if (expId) addExpedientTag(db, tenantId, expId, orderNum);

  // Guardar/actualizar en woo_orders
  const lineItems = order.line_items || [];
  db.prepare(`
    INSERT INTO woo_orders (tenant_id, wc_order_id, wc_order_number, customer_name, customer_phone, customer_email, status, products_json, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(tenant_id, wc_order_id) DO UPDATE SET
      status = excluded.status,
      products_json = excluded.products_json,
      raw_json = excluded.raw_json,
      updated_at = unixepoch()
  `).run(
    tenantId,
    order.id,
    order.number,
    `${firstName} ${lastName}`.trim(),
    billing.phone || '',
    email,
    'processing',
    JSON.stringify(lineItems),
    JSON.stringify(order)
  );

  return { contactId: contact.id, expId, action: 'processing' };
}

// ── Procesar pedido: status → completed ──────────────────────────────────────
function processOrderCompleted(db, tenantId, order, wooConfig) {
  const billing  = order.billing || {};
  const rawPhone = billing.phone || '';
  const email    = (billing.email || '').trim().toLowerCase();
  const phone    = normalizePhoneForWA(rawPhone);
  const orderNum = String(order.number || order.id);

  const contact = findContact(db, tenantId, phone, email);
  if (!contact) return { skipped: true, reason: 'contact_not_found' };

  // Buscar el lead en pipeline CLIENTES
  const clientesPipeline = db.prepare(
    "SELECT id FROM pipelines WHERE LOWER(name) LIKE '%cliente%' AND tenant_id = ? LIMIT 1"
  ).get(tenantId);
  if (!clientesPipeline) return { skipped: true, reason: 'pipeline_not_found' };

  const expedient = db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? LIMIT 1'
  ).get(contact.id, clientesPipeline.id, tenantId);
  if (!expedient) return { skipped: true, reason: 'expedient_not_found' };

  // Llenar Paquetería y Código de Rastreo
  const shipping = order.shipping_tracking || {};
  const carrier  = (shipping.carrier  || '').trim();
  const tracking = (shipping.tracking_number || '').trim();

  if (carrier || tracking) {
    fillCustomField(db, tenantId, expedient.id, 'Paqueteria',        carrier);
    fillCustomField(db, tenantId, expedient.id, 'Código de Rastreo:', tracking);
  }

  // Determinar pipeline destino según duración máxima de productos
  const products = db.prepare(
    "SELECT products_json FROM woo_config WHERE tenant_id = ?"
  ).get(tenantId);
  const productDefs = JSON.parse(products?.products_json || '[]');
  const rules       = JSON.parse(wooConfig.pipeline_rules || '[]');

  const lineItems = order.line_items || [];
  let maxDays = 0;
  for (const item of lineItems) {
    const name = (item.name || '').toLowerCase().trim();
    const def  = productDefs.find(p => p.name.toLowerCase().trim() === name);
    if (def && def.duration_days > maxDays) maxDays = def.duration_days;
  }

  if (maxDays > 0 && rules.length > 0) {
    // Buscar la regla que más se acerque (exacta o la más cercana por debajo)
    const sorted  = [...rules].sort((a, b) => b.duration_days - a.duration_days);
    const rule    = sorted.find(r => r.duration_days <= maxDays) || sorted[sorted.length - 1];
    const pipeline = rule ? db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?')
      .get(rule.pipeline_id, tenantId) : null;
    const stage    = rule ? db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?')
      .get(rule.stage_id, rule.pipeline_id) : null;

    if (pipeline && stage) {
      db.prepare(`
        UPDATE expedients SET pipeline_id = ?, stage_id = ?, updated_at = unixepoch(), stage_entered_at = unixepoch()
        WHERE id = ?
      `).run(rule.pipeline_id, rule.stage_id, expedient.id);
    } else {
      console.warn(`[woo] Regla de ${maxDays}d apunta a pipeline/stage eliminado (tenant ${tenantId})`);
    }
  }

  // Guardar/actualizar en woo_orders
  const lineItemsCompleted = order.line_items || [];
  db.prepare(`
    INSERT INTO woo_orders (tenant_id, wc_order_id, wc_order_number, customer_name, customer_phone, customer_email, status, products_json, raw_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(tenant_id, wc_order_id) DO UPDATE SET
      status = excluded.status,
      products_json = excluded.products_json,
      raw_json = excluded.raw_json,
      updated_at = unixepoch()
  `).run(
    tenantId,
    order.id,
    order.number,
    `${(billing.first_name || '').trim()} ${(billing.last_name || '').trim()}`.trim(),
    billing.phone || '',
    email,
    'completed',
    JSON.stringify(lineItemsCompleted),
    JSON.stringify(order)
  );

  return { contactId: contact.id, expId: expedient.id, maxDays, action: 'completed' };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function findContact(db, tenantId, phone, email) {
  if (phone) {
    const tail = phone.replace(/\D/g, '').slice(-10);
    const all  = db.prepare('SELECT * FROM contacts WHERE tenant_id = ?').all(tenantId);
    for (const c of all) {
      if (c.phone && c.phone.replace(/\D/g, '').slice(-10) === tail) return c;
    }
  }
  if (email) {
    return db.prepare(
      'SELECT * FROM contacts WHERE LOWER(TRIM(email)) = ? AND tenant_id = ?'
    ).get(email, tenantId) || null;
  }
  return null;
}

function addContactTag(db, tenantId, contactId, tag) {
  try {
    db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag, tenant_id) VALUES (?, ?, ?)')
      .run(contactId, tag, tenantId);
  } catch {}
}

function addExpedientTag(db, tenantId, expId, tag) {
  try {
    db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag, tenant_id) VALUES (?, ?, ?)')
      .run(expId, tag, tenantId);
  } catch {}
}

function fillCustomField(db, tenantId, expId, label, value) {
  if (!value) return;
  let field = db.prepare(
    "SELECT id FROM custom_field_defs WHERE label = ? AND entity = 'expedient' AND tenant_id = ?"
  ).get(label, tenantId);
  if (!field) {
    const r = db.prepare(
      "INSERT INTO custom_field_defs (entity, label, field_type, tenant_id) VALUES ('expedient', ?, 'text', ?)"
    ).run(label, tenantId);
    field = { id: r.lastInsertRowid };
  }
  db.prepare(`
    INSERT INTO custom_field_values (entity, record_id, field_id, value, tenant_id)
    VALUES ('expedient', ?, ?, ?, ?)
    ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
  `).run(expId, field.id, value, tenantId);
}

function formatDate(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

module.exports = { generateToken, processOrderProcessing, processOrderCompleted, normalizePhoneForWA };
