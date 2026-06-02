'use strict';
const crypto    = require('crypto');
const botEngine = require('../bot/engine');

// ── Mata todos los bots activos de un contacto ────────────────────────────────
function killAllBotsForContact(db, contactId, tenantId) {
  const runs = db.prepare(
    "SELECT id FROM bot_runs WHERE contact_id = ? AND tenant_id = ? AND status IN ('running','paused')"
  ).all(contactId, tenantId);
  for (const run of runs) botEngine.killRun(db, run.id);
}

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

  // Buscar lead: 1) en el pipeline inicial configurado (más reciente), 2) fallback al lead más reciente del contacto
  let expedient = pipelineId ? db.prepare(
    'SELECT id, pipeline_id, stage_id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).get(contact.id, pipelineId, tenantId) : null;
  if (!expedient) {
    expedient = db.prepare(
      'SELECT id, pipeline_id, stage_id FROM expedients WHERE contact_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
    ).get(contact.id, tenantId) || null;
  }

  let expId;
  if (expedient) {
    const prevStageId = expedient.stage_id;
    // Matar bots activos antes de mover la etapa
    killAllBotsForContact(db, contact.id, tenantId);
    // Actualizar nombre y mover a la etapa inicial
    db.prepare(`
      UPDATE expedients SET name = ?, stage_id = ?, updated_at = unixepoch(), stage_entered_at = unixepoch()
      WHERE id = ?
    `).run(leadName, stageId, expedient.id);
    expId = expedient.id;
    // Disparar bots de salida/entrada si la etapa cambió
    if (prevStageId && prevStageId !== stageId) {
      try {
        botEngine.triggerPipelineStageLeave(db, { expedientId: expId, contactId: contact.id, pipelineId, stageId: prevStageId });
        botEngine.triggerPipelineStage(db, { expedientId: expId, contactId: contact.id, pipelineId, stageId });
      } catch (e) { console.error('[woo] error disparando bot (processing):', e.message); }
    }
  } else if (pipelineId && stageId) {
    // Crear lead nuevo
    const r = db.prepare(`
      INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, tenant_id, created_at, updated_at, stage_entered_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())
    `).run(contact.id, pipelineId, stageId, leadName, tenantId);
    expId = r.lastInsertRowid;
    // Disparar bot de la etapa inicial
    try {
      botEngine.triggerPipelineStage(db, { expedientId: expId, contactId: contact.id, pipelineId, stageId });
    } catch (e) { console.error('[woo] error disparando bot (nuevo lead):', e.message); }
  }

  // Tag del lead: número de pedido únicamente
  if (expId) addExpedientTag(db, tenantId, expId, orderNum);

  // Campos personalizados del lead: Ultima Compra
  if (expId) {
    const purchaseDate = order.date_created
      ? formatDate(new Date(order.date_created))
      : formatDate(new Date());
    fillCustomField(db, tenantId, expId, 'Ultima Compra', purchaseDate);
  }

  // Guardar/actualizar en woo_orders
  const lineItems   = (order.line_items || []).map(i => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, total: i.total || '0' }));
  const wcOrderDate = order.date_created ? Math.floor(new Date(order.date_created).getTime() / 1000) : null;
  const shippingP   = order.shipping || {};
  const shippingAddr = {
    name:     `${shippingP.first_name || ''} ${shippingP.last_name || ''}`.trim() || `${firstName} ${lastName}`.trim(),
    address1: shippingP.address_1 || billing.address_1 || '',
    address2: shippingP.address_2 || '',
    city:     shippingP.city      || billing.city || '',
    state:    shippingP.state     || billing.state || '',
    postcode: shippingP.postcode  || billing.postcode || '',
    country:  shippingP.country   || billing.country || '',
  };
  db.prepare(`
    INSERT INTO woo_orders (tenant_id, wc_order_id, wc_order_number, customer_name, customer_phone, customer_email,
      status, products_json, raw_json, wc_order_date,
      payment_method, order_total, shipping_total, discount_total, tax_total,
      shipping_address_json, customer_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(tenant_id, wc_order_id) DO UPDATE SET
      status                = excluded.status,
      products_json         = excluded.products_json,
      raw_json              = excluded.raw_json,
      wc_order_date         = COALESCE(excluded.wc_order_date, wc_order_date),
      payment_method        = excluded.payment_method,
      order_total           = excluded.order_total,
      shipping_total        = excluded.shipping_total,
      discount_total        = excluded.discount_total,
      tax_total             = excluded.tax_total,
      shipping_address_json = excluded.shipping_address_json,
      customer_note         = excluded.customer_note,
      updated_at            = unixepoch()
  `).run(
    tenantId, order.id, order.number,
    `${firstName} ${lastName}`.trim(),
    billing.phone || '', email, (order.status || 'processing'),
    JSON.stringify(lineItems), JSON.stringify(order), wcOrderDate,
    order.payment_method_title || order.payment_method || '',
    order.total || '0', order.shipping_total || '0',
    order.discount_total || '0', order.total_tax || '0',
    JSON.stringify(shippingAddr), order.customer_note || ''
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

  // Buscar lead: 1) en el pipeline inicial configurado (más reciente), 2) fallback al lead más reciente del contacto
  const initialPipelineId = wooConfig?.initial_pipeline_id || null;
  let expedient = initialPipelineId ? db.prepare(
    'SELECT id, pipeline_id, stage_id FROM expedients WHERE contact_id = ? AND pipeline_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).get(contact.id, initialPipelineId, tenantId) : null;
  if (!expedient) {
    expedient = db.prepare(
      'SELECT id, pipeline_id, stage_id FROM expedients WHERE contact_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
    ).get(contact.id, tenantId) || null;
  }
  if (!expedient) return { skipped: true, reason: 'expedient_not_found' };

  // Campos personalizados: Ultima Compra, Paquetería y Número de Rastreo
  const purchaseDateCompleted = order.date_created
    ? formatDate(new Date(order.date_created))
    : formatDate(new Date());
  fillCustomField(db, tenantId, expedient.id, 'Ultima Compra', purchaseDateCompleted);

  const shipping = order.shipping_tracking || {};
  const carrier  = (shipping.carrier  || '').trim();
  const tracking = (shipping.tracking_number || '').trim();

  if (carrier) fillCustomField(db, tenantId, expedient.id, 'Paqueteria',         carrier);
  if (tracking) fillCustomField(db, tenantId, expedient.id, 'Número de Rastreo:', tracking);

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
    const def  = productDefs.find(p => p.id === item.product_id || p.name.toLowerCase().trim() === name);
    if (def) {
      const effectiveDays = def.duration_days * (item.quantity || 1);
      if (effectiveDays > maxDays) maxDays = effectiveDays;
    }
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
      const prevPipelineId = expedient.pipeline_id;
      const prevStageId    = expedient.stage_id;
      // Matar todos los bots activos del contacto antes de mover
      killAllBotsForContact(db, contact.id, tenantId);
      // Mover el lead
      db.prepare(`
        UPDATE expedients SET pipeline_id = ?, stage_id = ?, updated_at = unixepoch(), stage_entered_at = unixepoch()
        WHERE id = ?
      `).run(rule.pipeline_id, rule.stage_id, expedient.id);
      // Disparar bots de salida del stage anterior y entrada al nuevo
      try {
        if (prevStageId) {
          botEngine.triggerPipelineStageLeave(db, { expedientId: expedient.id, contactId: contact.id, pipelineId: prevPipelineId, stageId: prevStageId });
        }
        botEngine.triggerPipelineStage(db, { expedientId: expedient.id, contactId: contact.id, pipelineId: rule.pipeline_id, stageId: rule.stage_id });
      } catch (e) { console.error('[woo] error disparando bot (completed):', e.message); }
    } else {
      console.warn(`[woo] Regla de ${maxDays}d apunta a pipeline/stage eliminado (tenant ${tenantId})`);
    }
  }

  // Guardar/actualizar en woo_orders
  const custName     = `${(billing.first_name || '').trim()} ${(billing.last_name || '').trim()}`.trim();
  const lineItemsC   = (order.line_items || []).map(i => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, total: i.total || '0' }));
  const wcOrderDateC = order.date_created ? Math.floor(new Date(order.date_created).getTime() / 1000) : null;
  const shippingC    = order.shipping || {};
  const shippingAddrC = {
    name:     `${shippingC.first_name || ''} ${shippingC.last_name || ''}`.trim() || custName,
    address1: shippingC.address_1 || billing.address_1 || '',
    address2: shippingC.address_2 || '',
    city:     shippingC.city      || billing.city || '',
    state:    shippingC.state     || billing.state || '',
    postcode: shippingC.postcode  || billing.postcode || '',
    country:  shippingC.country   || billing.country || '',
  };
  db.prepare(`
    INSERT INTO woo_orders (tenant_id, wc_order_id, wc_order_number, customer_name, customer_phone, customer_email,
      status, products_json, raw_json, wc_order_date,
      payment_method, order_total, shipping_total, discount_total, tax_total,
      shipping_address_json, customer_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(tenant_id, wc_order_id) DO UPDATE SET
      status                = excluded.status,
      products_json         = excluded.products_json,
      raw_json              = excluded.raw_json,
      wc_order_date         = COALESCE(excluded.wc_order_date, wc_order_date),
      payment_method        = excluded.payment_method,
      order_total           = excluded.order_total,
      shipping_total        = excluded.shipping_total,
      discount_total        = excluded.discount_total,
      tax_total             = excluded.tax_total,
      shipping_address_json = excluded.shipping_address_json,
      customer_note         = excluded.customer_note,
      updated_at            = unixepoch()
  `).run(
    tenantId, order.id, order.number, custName,
    billing.phone || '', email, 'completed',
    JSON.stringify(lineItemsC), JSON.stringify(order), wcOrderDateC,
    order.payment_method_title || order.payment_method || '',
    order.total || '0', order.shipping_total || '0',
    order.discount_total || '0', order.total_tax || '0',
    JSON.stringify(shippingAddrC), order.customer_note || ''
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

// ── Procesar carrito abandonado de CartBounty ────────────────────────────────
// Llamado desde el webhook cuando event === 'cart.abandoned'.
// payload.cart: {cb_cart_id, name, phone, email, products[], total, currency, cart_url}
//
// IMPORTANTE: este handler YA NO envía la plantilla. Solo:
//   • crea/encuentra el contacto y el lead
//   • registra el carrito en woo_abandoned_carts con status='pending' y
//     send_at = now + abandoned_cart_min_minutes
//
// El envío real lo hace processAbandonedCartQueue() en un poller (cada 60s).
// Eso permite:
//   • respetar el delay configurado (antes ignorado)
//   • cancelar el envío si el cliente compra antes (lo más importante)
//   • reintentar si Meta tuvo un 503/timeout transitorio
async function processCartAbandoned(db, tenantId, cart, cfg) {
  const convoSvc = require('../conversations/service');

  if (!cfg.abandoned_cart_enabled) return { skipped: true, reason: 'disabled' };
  if (!cart.phone) return { skipped: true, reason: 'no_phone' };

  // 1) Dedup: ¿ya procesamos este cb_cart_id antes?
  const existing = db.prepare(
    'SELECT id FROM woo_abandoned_carts WHERE tenant_id = ? AND cb_cart_id = ? LIMIT 1'
  ).get(tenantId, cart.cb_cart_id);
  if (existing) return { skipped: true, reason: 'already_processed' };

  // 2) Dedup por contacto: si el mismo teléfono recibió un cart abandonment
  //    en las últimas N horas, NO encolar otro.
  const phone = normalizePhoneForWA(cart.phone);
  if (!phone) return { skipped: true, reason: 'invalid_phone' };

  const dedupHours = cfg.abandoned_cart_dedup_hours || 24;
  const recentForContact = db.prepare(`
    SELECT wac.id FROM woo_abandoned_carts wac
    JOIN contacts c ON c.id = wac.contact_id
    WHERE c.phone = ? AND wac.tenant_id = ?
      AND wac.status = 'sent'
      AND wac.created_at > unixepoch() - (? * 3600)
    LIMIT 1
  `).get(phone, tenantId, dedupHours);
  if (recentForContact) return { skipped: true, reason: 'dedup_window' };

  // 3) Encontrar o crear contacto
  const fullName = [cart.name || '', cart.surname || ''].filter(Boolean).join(' ').trim() || 'Cliente';
  const firstName = (cart.name || '').trim() || fullName.split(/\s+/)[0] || 'Cliente';
  const lastName  = (cart.surname || '').trim() || fullName.split(/\s+/).slice(1).join(' ') || null;
  const email     = (cart.email || '').trim().toLowerCase() || null;

  let contact = findContact(db, tenantId, phone, email);
  let isNewContact = false;
  if (!contact) {
    const r = db.prepare(`
      INSERT INTO contacts (first_name, last_name, phone, email, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(firstName, lastName, phone, email, tenantId);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.lastInsertRowid);
    isNewContact = true;
  } else if (firstName || lastName) {
    db.prepare(`
      UPDATE contacts SET
        first_name = COALESCE(NULLIF(?, ''), first_name),
        last_name  = COALESCE(NULLIF(?, ''), last_name),
        email      = COALESCE(NULLIF(?, ''), email),
        updated_at = unixepoch()
      WHERE id = ?
    `).run(firstName, lastName, email, contact.id);
  }

  // 4) Lead: si es contacto nuevo, crear en el pipeline configurado.
  let expId = null;
  const existingExp = db.prepare(
    'SELECT id FROM expedients WHERE contact_id = ? AND tenant_id = ? ORDER BY id DESC LIMIT 1'
  ).get(contact.id, tenantId);

  if (existingExp) {
    expId = existingExp.id;
  } else if (isNewContact && cfg.abandoned_cart_pipeline_id && cfg.abandoned_cart_stage_id) {
    const leadName = `${firstName} ${lastName || ''}`.trim() + ' - Carrito abandonado';
    const r = db.prepare(`
      INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, tenant_id, created_at, updated_at, stage_entered_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch(), unixepoch())
    `).run(contact.id, cfg.abandoned_cart_pipeline_id, cfg.abandoned_cart_stage_id, leadName, tenantId);
    expId = r.lastInsertRowid;
  }

  // 5) Agregar tag al lead
  const tag = cfg.abandoned_cart_tag || 'Carrito abandonado';
  if (expId && tag) {
    try {
      db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag, tenant_id) VALUES (?, ?, ?)')
        .run(expId, tag, tenantId);
    } catch (_) {}
  }

  // 6) ENCOLAR el envío — el poller se encargará después del delay
  const minMinutes = Math.max(0, Number(cfg.abandoned_cart_min_minutes) || 0);
  const sendAt = Math.floor(Date.now() / 1000) + (minMinutes * 60);

  db.prepare(`
    INSERT OR IGNORE INTO woo_abandoned_carts (
      tenant_id, cb_cart_id, contact_id, expedient_id, customer_name, customer_phone,
      customer_email, cart_total, currency, products_json, cart_url, template_id,
      message_sent, send_error, status, send_at, retry_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'pending', ?, 0)
  `).run(
    tenantId, cart.cb_cart_id, contact.id, expId, fullName, phone, email,
    cart.total || 0, cart.currency || 'MXN',
    JSON.stringify(cart.products || []), cart.cart_url || null,
    cfg.abandoned_cart_template_id || null,
    sendAt
  );

  console.log(`[woo abandoned cart] encolado cb_cart_id=${cart.cb_cart_id} contact=${contact.id} send_at=${new Date(sendAt * 1000).toISOString()} (delay=${minMinutes}min)`);

  return { contactId: contact.id, expId, isNewContact, queued: true, sendAt };
}

// ─── Poller de la cola de carritos abandonados ────────────────────────────────
// Corre cada N segundos (configurado en server.js). Para cada carrito 'pending'
// con send_at vencido:
//   • verifica si el cliente YA compró después del carrito → cancelled_purchased
//   • si no, intenta enviar la plantilla
//   • si Meta da error transitorio (5xx / timeout) → retry con backoff
//   • si Meta da error permanente (template no aprobada, número inválido) → failed
//
// Llamarlo idempotente: si dos pollers compiten por el mismo carrito, una
// transacción `UPDATE ... WHERE status='pending'` se asegura de no duplicar.
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MIN = [5, 15, 60]; // 5min, 15min, 1h
const TRANSIENT_RE = /(service unavailable|timeout|ECONN|ETIMEDOUT|fetch failed|HTTP 5\d\d|too many requests|HTTP 429|service is temporar|please try again)/i;

async function processAbandonedCartQueue(db) {
  const convoSvc = require('../conversations/service');
  const sender   = require('../conversations/sender');

  // Tomar hasta 20 carritos pendientes con send_at vencido. Procesar de a uno.
  const now = Math.floor(Date.now() / 1000);
  const pending = db.prepare(`
    SELECT * FROM woo_abandoned_carts
    WHERE status = 'pending' AND send_at <= ?
    ORDER BY send_at ASC
    LIMIT 20
  `).all(now);

  if (!pending.length) return { processed: 0 };

  let sent = 0, cancelled = 0, retried = 0, failed = 0;

  for (const wac of pending) {
    // Cargar config del tenant
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(wac.tenant_id);
    if (!cfg || !cfg.abandoned_cart_enabled || !cfg.abandoned_cart_template_id) {
      // Config deshabilitada o sin plantilla → no podemos enviar, marcar failed
      db.prepare("UPDATE woo_abandoned_carts SET status='failed', send_error='config disabled or no template' WHERE id=?").run(wac.id);
      failed++;
      continue;
    }

    // 1) ¿El cliente ya compró después de abandonar?
    //    Buscamos woo_orders con el mismo phone (last-10-digits) cuya
    //    wc_order_date >= created_at del carrito.
    const last10 = (wac.customer_phone || '').replace(/\D/g, '').slice(-10);
    const purchased = last10 && db.prepare(`
      SELECT id FROM woo_orders
      WHERE tenant_id = ?
        AND replace(replace(customer_phone, '+', ''), ' ', '') LIKE '%' || ? || '%'
        AND wc_order_date >= ?
      LIMIT 1
    `).get(String(wac.tenant_id), last10, wac.created_at);

    if (purchased) {
      db.prepare("UPDATE woo_abandoned_carts SET status='cancelled_purchased', last_attempt_at=unixepoch() WHERE id=?").run(wac.id);
      console.log(`[woo abandoned cart poller] cancelado #${wac.id} (${wac.customer_name}): ya compró (orden ${purchased.id})`);
      cancelled++;
      continue;
    }

    // 2) Intentar enviar
    try {
      // Resolver número con código país COMPLETO. wac.customer_phone de WC
      // puede venir sin código país (10 díg) → Meta no entrega plantillas
      // (mismo bug que reelance-ia). Prioridad: phone del contacto (>=12 díg)
      // > customer_phone normalizado a +521 (formato MX que WhatsApp entrega).
      let externalId = null;
      if (wac.contact_id) {
        const c = db.prepare('SELECT phone FROM contacts WHERE id = ? AND tenant_id = ?').get(wac.contact_id, wac.tenant_id);
        if (c && c.phone) {
          const d = String(c.phone).replace(/\D/g, '');
          if (d.length >= 12) externalId = d;
        }
      }
      if (!externalId) {
        const norm = normalizePhoneForWA(wac.customer_phone);
        externalId = (norm || String(wac.customer_phone || '')).replace(/\D/g, '');
      }
      const waIntegration = db.prepare(
        "SELECT id FROM integrations WHERE provider = 'whatsapp' AND tenant_id = ? ORDER BY CASE status WHEN 'connected' THEN 0 ELSE 1 END, id DESC LIMIT 1"
      ).get(wac.tenant_id);

      const convo = convoSvc.findOrCreate(db, wac.tenant_id, {
        provider:      'whatsapp',
        externalId,
        contactPhone:  '+' + externalId,
        contactName:   wac.customer_name,
        contactId:     wac.contact_id,
        integrationId: waIntegration?.id || null,
      });

      const firstName = (wac.customer_name || '').split(/\s+/)[0] || 'Cliente';
      const manualValues = [
        firstName,
        wac.cart_url || '',
        wac.cart_total ? String(wac.cart_total) : '',
      ];

      const result = await sender.sendWhatsAppTemplate(db, convo, wac.template_id, manualValues, { autoFallback: true });
      convoSvc.addMessage(db, wac.tenant_id, convo.id, {
        externalId: result.externalId,
        direction:  'outgoing',
        provider:   'whatsapp',
        body:       result.renderedBody,
        status:     'sent',
      });

      db.prepare("UPDATE woo_abandoned_carts SET status='sent', message_sent=1, send_error=NULL, last_attempt_at=unixepoch() WHERE id=?").run(wac.id);
      console.log(`[woo abandoned cart poller] enviado #${wac.id} a ${wac.customer_name}`);
      sent++;
    } catch (err) {
      const msg = (err.message || String(err)).slice(0, 500);
      const isTransient = TRANSIENT_RE.test(msg);
      const newRetryCount = (wac.retry_count || 0) + 1;

      if (isTransient && newRetryCount <= MAX_RETRIES) {
        // Reprogramar con backoff
        const delayMin = RETRY_BACKOFF_MIN[newRetryCount - 1] || 60;
        const newSendAt = Math.floor(Date.now() / 1000) + (delayMin * 60);
        db.prepare(`
          UPDATE woo_abandoned_carts
          SET retry_count = ?, send_at = ?, last_attempt_at = unixepoch(), send_error = ?
          WHERE id = ?
        `).run(newRetryCount, newSendAt, msg, wac.id);
        console.warn(`[woo abandoned cart poller] retry ${newRetryCount}/${MAX_RETRIES} para #${wac.id} en ${delayMin}min: ${msg}`);
        retried++;
      } else {
        // Error permanente o agotados los reintentos
        db.prepare(`
          UPDATE woo_abandoned_carts
          SET status='failed', send_error=?, last_attempt_at=unixepoch(), retry_count=?
          WHERE id=?
        `).run(msg, newRetryCount, wac.id);
        console.error(`[woo abandoned cart poller] FAIL #${wac.id} (${wac.customer_name}): ${msg}`);
        failed++;
      }
    }
  }

  return { processed: pending.length, sent, cancelled, retried, failed };
}

// Arranca el poller; el caller debe llamarlo una sola vez al boot del servidor.
function startAbandonedCartPoller(db, intervalMs = 60_000) {
  const tick = async () => {
    try {
      const r = await processAbandonedCartQueue(db);
      if (r.processed > 0) {
        console.log(`[woo abandoned cart poller] tick: enviados=${r.sent} cancelados=${r.cancelled} reintentos=${r.retried} fallos=${r.failed}`);
      }
    } catch (e) {
      console.error('[woo abandoned cart poller] error general:', e.message);
    } finally {
      setTimeout(tick, intervalMs);
    }
  };
  setTimeout(tick, intervalMs);
  console.log(`[woo abandoned cart poller] iniciado (cada ${intervalMs/1000}s)`);
}

module.exports = {
  generateToken,
  processOrderProcessing,
  processOrderCompleted,
  processCartAbandoned,
  processAbandonedCartQueue,
  startAbandonedCartPoller,
  normalizePhoneForWA,
  fillCustomField,
};
