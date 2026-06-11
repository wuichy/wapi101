// WhatsApp Catalog service
//
// Responsabilidades:
//   1) Detectar si el WABA del tenant tiene catálogo linkeado (smart-detect)
//   2) Sincronizar productos desde Meta Graph API → DB local
//   3) Enviar productos en chats (single, list, full catalog)
//   4) Feature flag por tenant (whatsapp_catalog_enabled en tabla tenants)
//
// Meta API endpoints usados:
//   - GET /{PHONE_NUMBER_ID}?fields=name,whatsapp_business_account
//   - GET /{WABA_ID}/product_catalogs
//   - GET /{CATALOG_ID}/products?limit=50  (paginado)
//   - POST /{PHONE_NUMBER_ID}/messages  (interactive product / product_list)

const { decryptJson } = require('../../security/crypto');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

// ─── Helpers ──────────────────────────────────────────────────────────

function _waCreds(db, tenantId) {
  // Devuelve creds de la integración WhatsApp del tenant.
  // Si no hay integración connected, devuelve null.
  const row = db.prepare(`
    SELECT id, credentials_enc FROM integrations
    WHERE tenant_id = ? AND provider = 'whatsapp' AND status = 'connected'
    ORDER BY id DESC LIMIT 1
  `).get(tenantId);
  if (!row?.credentials_enc) return null;
  const c = decryptJson(row.credentials_enc) || {};
  if (!c.phoneNumberId || !c.accessToken) return null;
  return { integrationId: row.id, ...c };
}

async function _metaGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Meta GET ${url.replace(GRAPH, '')} → ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function _metaPost(url, token, body, integrationId = null) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Mismo manejo que el sender: error amigable + exponer el error crudo de
    // Meta para que el caller (que sí tiene db) marque la integración si es
    // un error de token (antes el error crudo se tragaba sin contexto).
    let metaErr = null;
    try { metaErr = JSON.parse(text)?.error || null; } catch (_) {}
    const { friendlyMetaError } = require('../integrations/meta-errors');
    const err = new Error(friendlyMetaError(metaErr) || `Meta POST ${url.replace(GRAPH, '')} → ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.metaError = metaErr;
    throw err;
  }
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ─── Detección + smart-default ────────────────────────────────────────

// Devuelve el catalog_id de Meta linkeado al phone_number_id, o null si no hay.
// Usado por el smart-default cuando el tenant abre Settings por primera vez.
async function detectCatalogForTenant(db, tenantId) {
  const creds = _waCreds(db, tenantId);
  if (!creds) return null;

  // 1) Get phone info → product_catalogs
  // GET /{phone_number_id}?fields=name,whatsapp_business_account{owned_whatsapp_business_accounts{product_catalogs}}
  // Más simple: si tenemos wabaId, GET /{waba_id}/product_catalogs directo.
  if (!creds.wabaId) {
    try {
      const info = await _metaGet(`${GRAPH}/${creds.phoneNumberId}?fields=whatsapp_business_account`, creds.accessToken);
      creds.wabaId = info?.whatsapp_business_account?.id;
    } catch (e) {
      console.log('[wa-catalog] detect: no se pudo obtener waba_id:', e.message);
      return null;
    }
  }
  if (!creds.wabaId) return null;

  try {
    const catalogs = await _metaGet(`${GRAPH}/${creds.wabaId}/product_catalogs?limit=10`, creds.accessToken);
    const first = catalogs?.data?.[0];
    if (!first?.id) return null;
    return {
      catalogId: first.id,
      catalogName: first.name || 'Catálogo',
      integrationId: creds.integrationId,
    };
  } catch (e) {
    console.log('[wa-catalog] detect: no se pudo listar catalogs:', e.message);
    return null;
  }
}

function getTenantFlag(db, tenantId) {
  const row = db.prepare('SELECT whatsapp_catalog_enabled FROM tenants WHERE id = ?').get(tenantId);
  return row?.whatsapp_catalog_enabled; // null = sin configurar, 0 = off, 1 = on
}

function setTenantFlag(db, tenantId, enabled) {
  db.prepare('UPDATE tenants SET whatsapp_catalog_enabled = ?, updated_at = unixepoch() WHERE id = ?')
    .run(enabled ? 1 : 0, tenantId);
}

// Resuelve el catálogo guardado localmente (si existe) para el tenant.
function getLocalCatalog(db, tenantId) {
  return db.prepare(`
    SELECT id, integration_id, catalog_id, name, product_count,
           last_synced_at, last_sync_error
    FROM whatsapp_catalogs WHERE tenant_id = ? LIMIT 1
  `).get(tenantId);
}

// ─── Sync de productos desde Meta ─────────────────────────────────────

async function syncCatalog(db, tenantId, { force = false } = {}) {
  const flag = getTenantFlag(db, tenantId);
  if (!force && flag !== 1) {
    return { skipped: true, reason: 'feature_disabled' };
  }

  const creds = _waCreds(db, tenantId);
  if (!creds) return { skipped: true, reason: 'no_whatsapp_integration' };

  // Auto-detect catalog si todavía no lo tenemos local.
  let local = getLocalCatalog(db, tenantId);
  if (!local) {
    const detected = await detectCatalogForTenant(db, tenantId);
    if (!detected) return { skipped: true, reason: 'no_catalog_in_meta' };
    const r = db.prepare(`
      INSERT INTO whatsapp_catalogs (tenant_id, integration_id, catalog_id, name)
      VALUES (?, ?, ?, ?)
    `).run(tenantId, detected.integrationId, detected.catalogId, detected.catalogName);
    local = getLocalCatalog(db, tenantId);
  }

  // Bajar todos los productos del catálogo (paginado).
  const FIELDS = 'id,retailer_id,name,description,price,currency,availability,category,url,image_url';
  let url = `${GRAPH}/${local.catalog_id}/products?limit=50&fields=${FIELDS}`;
  let totalFetched = 0;
  let pageCount = 0;
  const seenRetailerIds = new Set();

  try {
    while (url) {
      const data = await _metaGet(url, creds.accessToken);
      const items = data?.data || [];
      pageCount++;

      const upsert = db.prepare(`
        INSERT INTO whatsapp_products (
          tenant_id, catalog_id, retailer_id, product_id, name, description,
          price_amount, price_currency, image_url, availability, category, url,
          raw_json, is_active, last_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch(), unixepoch())
        ON CONFLICT(catalog_id, retailer_id) DO UPDATE SET
          product_id = excluded.product_id,
          name = excluded.name,
          description = excluded.description,
          price_amount = excluded.price_amount,
          price_currency = excluded.price_currency,
          image_url = excluded.image_url,
          availability = excluded.availability,
          category = excluded.category,
          url = excluded.url,
          raw_json = excluded.raw_json,
          is_active = 1,
          last_seen_at = unixepoch(),
          updated_at = unixepoch()
      `);

      const txn = db.transaction((batch) => {
        for (const p of batch) {
          // Parsear price "590.00 MXN" → { amount: 590, currency: 'MXN' }
          let priceAmount = null, priceCurrency = null;
          if (p.price) {
            const m = String(p.price).match(/^([0-9.,]+)\s*([A-Z]{3})?$/);
            if (m) {
              priceAmount = parseFloat(m[1].replace(/,/g, ''));
              priceCurrency = m[2] || p.currency || null;
            }
          }
          upsert.run(
            tenantId, local.id, p.retailer_id || p.id, p.id,
            p.name || '(Sin nombre)', p.description || null,
            priceAmount, priceCurrency, p.image_url || null,
            p.availability || null, p.category || null, p.url || null,
            JSON.stringify(p)
          );
          if (p.retailer_id) seenRetailerIds.add(p.retailer_id);
        }
      });
      txn(items);
      totalFetched += items.length;

      url = data?.paging?.next || null;
      // Safety: max 100 pages (5000 productos). Si llegamos a esto algo está mal.
      if (pageCount > 100) {
        console.warn('[wa-catalog] sync: max pages reached, stopping');
        break;
      }
    }

    // Marcar como inactivos los productos que ya no aparecieron en Meta.
    if (seenRetailerIds.size > 0) {
      const placeholders = [...seenRetailerIds].map(() => '?').join(',');
      db.prepare(`
        UPDATE whatsapp_products SET is_active = 0, updated_at = unixepoch()
        WHERE catalog_id = ? AND retailer_id NOT IN (${placeholders}) AND is_active = 1
      `).run(local.id, ...seenRetailerIds);
    }

    // Actualizar catálogo
    db.prepare(`
      UPDATE whatsapp_catalogs
      SET product_count = (SELECT COUNT(*) FROM whatsapp_products WHERE catalog_id = ? AND is_active = 1),
          last_synced_at = unixepoch(), last_sync_error = NULL, updated_at = unixepoch()
      WHERE id = ?
    `).run(local.id, local.id);

    return { ok: true, fetched: totalFetched, catalog_id: local.catalog_id };
  } catch (e) {
    db.prepare(`UPDATE whatsapp_catalogs SET last_sync_error = ?, updated_at = unixepoch() WHERE id = ?`)
      .run(String(e.message).slice(0, 500), local.id);
    return { ok: false, error: e.message };
  }
}

// ─── Listing / detail ─────────────────────────────────────────────────

function listProducts(db, tenantId, { search = '', page = 1, pageSize = 24, onlyActive = true } = {}) {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const filters = ['tenant_id = ?'];
  const params = [tenantId];
  if (onlyActive) filters.push('is_active = 1');
  if (search) {
    filters.push('(name LIKE ? OR description LIKE ? OR retailer_id LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = filters.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM whatsapp_products WHERE ${where}`).get(...params).n;
  const items = db.prepare(`
    SELECT id, retailer_id, product_id, name, description,
           price_amount, price_currency, image_url, availability, category, url,
           is_active, last_seen_at
    FROM whatsapp_products
    WHERE ${where}
    ORDER BY is_active DESC, updated_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return { total, page, pageSize, items };
}

function getProduct(db, tenantId, id) {
  return db.prepare(`
    SELECT * FROM whatsapp_products WHERE id = ? AND tenant_id = ?
  `).get(id, tenantId);
}

// ─── Envío de producto al chat ────────────────────────────────────────

async function sendProductToConversation(db, tenantId, { conversationId, productId, contactId, via = 'manual' }) {
  const product = getProduct(db, tenantId, productId);
  if (!product) throw new Error('Producto no encontrado en el catálogo del tenant');

  const cat = db.prepare('SELECT catalog_id FROM whatsapp_catalogs WHERE id = ?').get(product.catalog_id);
  if (!cat?.catalog_id) throw new Error('Catálogo no configurado');

  const convo = db.prepare(`
    SELECT c.id, c.external_id, c.integration_id, c.contact_id
    FROM conversations c WHERE c.id = ? AND c.tenant_id = ?
  `).get(conversationId, tenantId);
  if (!convo?.external_id) throw new Error('Conversación inválida');

  const creds = _waCreds(db, tenantId);
  if (!creds) throw new Error('Sin integración de WhatsApp conectada');

  // POST interactive product message
  const { waCloudRecipient } = require('../conversations/sender');
  const productLabel = product.name + (product.price_amount ? ` — $${product.price_amount} ${product.price_currency || ''}`.trim() : '');
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waCloudRecipient(convo.external_id), // normaliza +521 viejo MX (igual que el sender)
    type: 'interactive',
    interactive: {
      type: 'product',
      body: { text: productLabel },
      action: {
        catalog_id: cat.catalog_id,
        product_retailer_id: product.retailer_id,
      },
    },
  };

  const convoSvc = require('../conversations/service');
  let r;
  try {
    r = await _metaPost(`${GRAPH}/${creds.phoneNumberId}/messages`, creds.accessToken, body);
  } catch (err) {
    if (err.metaError) {
      const { isMetaAuthError } = require('../integrations/meta-errors');
      if (isMetaAuthError(err.metaError)) {
        try { require('../integrations/service').markAuthFailed(db, creds.integrationId, err.message); } catch (_) {}
      }
    }
    try {
      convoSvc.addMessage(db, tenantId, conversationId, {
        direction: 'outgoing', provider: 'whatsapp', body: `🛍️ ${productLabel} (no enviado)`,
        status: 'failed', byAdvisor: via === 'manual', byBot: via !== 'manual', errorReason: err.message,
      });
    } catch (_) { /* no enmascarar */ }
    throw err;
  }

  // Persistir en el chat (antes el producto enviado NO aparecía como burbuja)
  try {
    convoSvc.addMessage(db, tenantId, conversationId, {
      externalId: r?.messages?.[0]?.id || null,
      direction: 'outgoing', provider: 'whatsapp', body: `🛍️ ${productLabel}`,
      status: 'sent', byAdvisor: via === 'manual', byBot: via !== 'manual',
    });
  } catch (_) { /* el send ya salió; no romper por la burbuja */ }

  // Registrar el envío para analytics y "productos enviados al lead"
  db.prepare(`
    INSERT INTO whatsapp_product_sends
      (tenant_id, contact_id, conversation_id, product_id, sent_via, message_type)
    VALUES (?, ?, ?, ?, ?, 'product')
  `).run(tenantId, contactId || convo.contact_id || null, conversationId, productId, via);

  return { ok: true, message_id: r?.messages?.[0]?.id || null };
}

async function sendProductListToConversation(db, tenantId, { conversationId, sections, headerText, bodyText, footerText, via = 'manual' }) {
  // sections = [{ title: 'Más vendidos', product_ids: [internal_product_id1, id2] }]
  const convo = db.prepare(`
    SELECT id, external_id, integration_id, contact_id FROM conversations
    WHERE id = ? AND tenant_id = ?
  `).get(conversationId, tenantId);
  if (!convo?.external_id) throw new Error('Conversación inválida');

  const creds = _waCreds(db, tenantId);
  if (!creds) throw new Error('Sin integración de WhatsApp conectada');

  // Resolver internal product_ids → retailer_ids, agrupados por catalog_id
  // (asumimos 1 catálogo por tenant para simplicidad)
  const allProductIds = sections.flatMap(s => s.product_ids);
  const placeholders = allProductIds.map(() => '?').join(',');
  const products = db.prepare(`
    SELECT id, retailer_id, catalog_id FROM whatsapp_products
    WHERE tenant_id = ? AND id IN (${placeholders})
  `).all(tenantId, ...allProductIds);
  if (products.length === 0) throw new Error('Ningún producto válido');

  const localCat = db.prepare('SELECT catalog_id FROM whatsapp_catalogs WHERE id = ?').get(products[0].catalog_id);
  const byInternalId = new Map(products.map(p => [p.id, p.retailer_id]));

  const sectionsMapped = sections.map(s => ({
    title: s.title || 'Productos',
    product_items: s.product_ids
      .map(pid => byInternalId.get(pid))
      .filter(Boolean)
      .map(rid => ({ product_retailer_id: rid })),
  })).filter(s => s.product_items.length > 0);

  if (sectionsMapped.length === 0) throw new Error('Sin productos válidos en las secciones');

  const interactive = {
    type: 'product_list',
    header: { type: 'text', text: headerText || 'Productos' },
    body: { text: bodyText || 'Mira estos productos disponibles' },
    action: {
      catalog_id: localCat.catalog_id,
      sections: sectionsMapped,
    },
  };
  if (footerText) interactive.footer = { text: footerText };

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: require('../conversations/sender').waCloudRecipient(convo.external_id),
    type: 'interactive',
    interactive,
  };

  const convoSvc = require('../conversations/service');
  let r;
  try {
    r = await _metaPost(`${GRAPH}/${creds.phoneNumberId}/messages`, creds.accessToken, body);
  } catch (err) {
    if (err.metaError) {
      const { isMetaAuthError } = require('../integrations/meta-errors');
      if (isMetaAuthError(err.metaError)) {
        try { require('../integrations/service').markAuthFailed(db, creds.integrationId, err.message); } catch (_) {}
      }
    }
    try {
      convoSvc.addMessage(db, tenantId, conversationId, {
        direction: 'outgoing', provider: 'whatsapp', body: `🛍️ ${headerText || 'Lista de productos'} (no enviada)`,
        status: 'failed', byAdvisor: via === 'manual', byBot: via !== 'manual', errorReason: err.message,
      });
    } catch (_) { /* no enmascarar */ }
    throw err;
  }

  try {
    convoSvc.addMessage(db, tenantId, conversationId, {
      externalId: r?.messages?.[0]?.id || null,
      direction: 'outgoing', provider: 'whatsapp', body: `🛍️ ${headerText || 'Lista de productos'} (${sectionsMapped.reduce((n, s) => n + s.product_items.length, 0)} productos)`,
      status: 'sent', byAdvisor: via === 'manual', byBot: via !== 'manual',
    });
  } catch (_) { /* el send ya salió */ }

  // Auditar cada producto enviado
  const ins = db.prepare(`
    INSERT INTO whatsapp_product_sends
      (tenant_id, contact_id, conversation_id, product_id, sent_via, message_type)
    VALUES (?, ?, ?, ?, ?, 'product_list')
  `);
  const txn = db.transaction((ids) => {
    for (const pid of ids) ins.run(tenantId, convo.contact_id || null, conversationId, pid, via);
  });
  txn(allProductIds.filter(pid => byInternalId.has(pid)));

  return { ok: true, message_id: r?.messages?.[0]?.id || null };
}

// ─── Audit log helpers (para UI del lead) ─────────────────────────────

function getProductSendsForContact(db, tenantId, contactId, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT s.id, s.sent_at, s.sent_via, s.message_type,
           p.id AS product_id, p.name, p.retailer_id, p.image_url,
           p.price_amount, p.price_currency
    FROM whatsapp_product_sends s
    JOIN whatsapp_products p ON p.id = s.product_id
    WHERE s.tenant_id = ? AND s.contact_id = ?
    ORDER BY s.sent_at DESC LIMIT ?
  `).all(tenantId, contactId, limit);
}

// ─── Cron poller ──────────────────────────────────────────────────────

function startCatalogSyncPoller(db, intervalMs = 60 * 60 * 1000) {
  console.log(`[wa-catalog] sync poller iniciado (cada ${Math.round(intervalMs/60000)} min)`);

  const tick = async () => {
    // Sólo tenants con la feature ON.
    const tenants = db.prepare(`
      SELECT id FROM tenants WHERE whatsapp_catalog_enabled = 1 AND status = 'active'
    `).all();
    for (const t of tenants) {
      try {
        const r = await syncCatalog(db, t.id);
        if (r.ok) console.log(`[wa-catalog] tenant ${t.id}: synced ${r.fetched} productos`);
        else if (!r.skipped) console.log(`[wa-catalog] tenant ${t.id}: ${r.error}`);
      } catch (e) {
        console.error(`[wa-catalog] tenant ${t.id}: sync crashed:`, e.message);
      }
    }
  };

  // Primer tick después de 30s del boot (no bloquear startup).
  setTimeout(tick, 30_000);
  setInterval(tick, intervalMs);
}

// ─── Middleware: bloquear endpoints si feature está OFF ────────────────

function requireCatalogEnabled(db) {
  return (req, res, next) => {
    if (getTenantFlag(db, req.tenantId) !== 1) {
      return res.status(403).json({ error: 'feature_disabled', feature: 'whatsapp_catalog' });
    }
    next();
  };
}

module.exports = {
  detectCatalogForTenant,
  getTenantFlag,
  setTenantFlag,
  getLocalCatalog,
  syncCatalog,
  listProducts,
  getProduct,
  sendProductToConversation,
  sendProductListToConversation,
  getProductSendsForContact,
  startCatalogSyncPoller,
  requireCatalogEnabled,
};
