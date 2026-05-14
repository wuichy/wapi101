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
async function processCartAbandoned(db, tenantId, cart, cfg) {
  const convoSvc = require('../conversations/service');
  const tplSvc   = require('../templates/service');
  const sender   = require('../conversations/sender');

  if (!cfg.abandoned_cart_enabled) return { skipped: true, reason: 'disabled' };
  if (!cart.phone) return { skipped: true, reason: 'no_phone' };

  // 1) Dedup: ¿ya procesamos este cb_cart_id antes?
  const existing = db.prepare(
    'SELECT id FROM woo_abandoned_carts WHERE tenant_id = ? AND cb_cart_id = ? LIMIT 1'
  ).get(tenantId, cart.cb_cart_id);
  if (existing) return { skipped: true, reason: 'already_processed' };

  // 2) Dedup por contacto: si el mismo teléfono recibió un cart abandonment
  //    en las últimas N horas, NO mandar otro.
  const phone = normalizePhoneForWA(cart.phone);
  if (!phone) return { skipped: true, reason: 'invalid_phone' };

  const dedupHours = cfg.abandoned_cart_dedup_hours || 24;
  const recentForContact = db.prepare(`
    SELECT wac.id FROM woo_abandoned_carts wac
    JOIN contacts c ON c.id = wac.contact_id
    WHERE c.phone = ? AND wac.tenant_id = ?
      AND wac.message_sent = 1
      AND wac.created_at > unixepoch() - (? * 3600)
    LIMIT 1
  `).get(phone, tenantId, dedupHours);
  if (recentForContact) return { skipped: true, reason: 'dedup_window' };

  // 3) Encontrar o crear contacto
  const fullName = [cart.name || '', cart.surname || ''].filter(Boolean).join(' ').trim() || 'Cliente';
  const firstName = (cart.name || '').trim() || fullName.split(/\s+/)[0] || 'Cliente';
  const lastName  = (cart.surname || '').trim() || fullName.split(/\s+/).slice(1).join(' ') || null;
  const email     = (cart.email || '').trim().toLowerCase() || null;

  let contact = db.prepare('SELECT * FROM contacts WHERE phone = ? AND tenant_id = ?').get(phone, tenantId);
  let isNewContact = false;
  if (!contact) {
    const r = db.prepare(`
      INSERT INTO contacts (first_name, last_name, phone, email, tenant_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(firstName, lastName, phone, email, tenantId);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.lastInsertRowid);
    isNewContact = true;
  } else if (firstName || lastName) {
    // Actualizar nombre si lo nuevo tiene más info
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
  //    Si ya existía, NO mover su lead — solo respetamos donde esté.
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

  // 5) Agregar tag al lead si está configurado
  const tag = cfg.abandoned_cart_tag || 'Carrito abandonado';
  if (expId && tag) {
    try {
      db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag, tenant_id) VALUES (?, ?, ?)')
        .run(expId, tag, tenantId);
    } catch (_) {}
  }

  // 6) Encontrar/crear conversación WA Business API
  let convo = null;
  let sendError = null;
  let messageSent = 0;
  const externalId = phone.replace(/\D/g, ''); // sin "+" para WA

  // Detectar si la conversación ya existía: si no, y el envío falla, la borramos
  // para no dejar chats fantasma en el inbox.
  const preExistedConvo = db.prepare(
    'SELECT id FROM conversations WHERE provider = ? AND external_id = ? AND tenant_id = ?'
  ).get('whatsapp', externalId, tenantId);

  try {
    convo = convoSvc.findOrCreate(db, tenantId, {
      provider:     'whatsapp',
      externalId,
      contactPhone: phone,
      contactName:  fullName,
      contactId:    contact.id,
    });

    // 7) Enviar plantilla — los placeholders se rellenan desde cart_url + nombre
    if (cfg.abandoned_cart_template_id && convo) {
      const manualValues = [
        firstName,
        cart.cart_url || '',
        cart.total ? String(cart.total) : '',
      ];
      const result = await sender.sendWhatsAppTemplate(db, convo, cfg.abandoned_cart_template_id, manualValues, { autoFallback: true });
      convoSvc.addMessage(db, tenantId, convo.id, {
        externalId: result.externalId,
        direction:  'outgoing',
        provider:   'whatsapp',
        body:       result.renderedBody,
        status:     'sent',
      });
      messageSent = 1;
    }
  } catch (err) {
    sendError = err.message || String(err);
    console.error('[woo abandoned cart] error enviando plantilla:', sendError);

    if (convo && !preExistedConvo && messageSent === 0) {
      try {
        db.prepare('DELETE FROM conversations WHERE id = ?').run(convo.id);
        convo = null;
      } catch (delErr) {
        console.error('[woo abandoned cart] no se pudo borrar convo huérfana:', delErr.message);
      }
    }
  }

  // 8) Guardar histórico
  db.prepare(`
    INSERT OR IGNORE INTO woo_abandoned_carts (
      tenant_id, cb_cart_id, contact_id, expedient_id, customer_name, customer_phone,
      customer_email, cart_total, currency, products_json, cart_url, template_id, message_sent, send_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId, cart.cb_cart_id, contact.id, expId, fullName, phone, email,
    cart.total || 0, cart.currency || 'MXN',
    JSON.stringify(cart.products || []), cart.cart_url || null,
    cfg.abandoned_cart_template_id || null, messageSent, sendError
  );

  return { contactId: contact.id, expId, isNewContact, messageSent: !!messageSent, sendError };
}

module.exports = { generateToken, processOrderProcessing, processOrderCompleted, processCartAbandoned, normalizePhoneForWA, fillCustomField };
