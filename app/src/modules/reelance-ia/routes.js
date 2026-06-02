'use strict';

// Rutas de la app "Reelance IA". Se exportan DOS routers:
//
// 1. webhookRouter(db)   — endpoints PÚBLICOS (autenticados por bearer token)
//    Se monta ANTES del authMiddleware general en `/api/apps/reelance-ia`:
//      POST /order            — webhook desde la tienda Next.js
//      POST /abandoned-cart   — webhook desde la tienda Next.js
//      GET  /ping             — health check
//
// 2. authRouter(db)      — endpoints PRIVADOS (usan req.tenantId)
//    Se monta en `/api/apps/reelance-ia` DESPUÉS del authMiddleware general:
//      GET  /config
//      PUT  /config
//      POST /regenerate-token
//      GET  /events

const express = require('express');
const svc = require('./service');

function webhookRouter(db) {
  const router = express.Router();

  router.post('/order', express.json({ limit: '1mb' }), (req, res) => {
    const token = _extractBearer(req);
    const cfg = svc.getConfigByToken(db, token);
    if (!cfg) return res.status(401).json({ error: 'invalid_token' });
    if (!cfg.enabled) return res.status(403).json({ error: 'app_disabled' });
    try {
      const out = svc.processOrderEvent(db, cfg.tenant_id, req.body || {});
      res.json(out);
    } catch (err) {
      console.error('[reelance-ia] order webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/abandoned-cart', express.json({ limit: '1mb' }), (req, res) => {
    const token = _extractBearer(req);
    const cfg = svc.getConfigByToken(db, token);
    if (!cfg) return res.status(401).json({ error: 'invalid_token' });
    if (!cfg.enabled) return res.status(403).json({ error: 'app_disabled' });
    try {
      const out = svc.processAbandonedCartEvent(db, cfg.tenant_id, req.body || {});
      res.json(out);
    } catch (err) {
      console.error('[reelance-ia] abandoned-cart webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Webhook DELETE — lucho101 avisa cuando se borra una Order.
  // Borra el evento de reelance_ia_events + cualquier item de queue.
  // El lead NO se borra (puede tener historial valioso).
  router.delete('/order/:externalId', (req, res) => {
    const token = _extractBearer(req);
    const cfg = svc.getConfigByToken(db, token);
    if (!cfg) return res.status(401).json({ error: 'invalid_token' });
    if (!cfg.enabled) return res.status(403).json({ error: 'app_disabled' });
    try {
      const out = svc.deleteOrderEvents(db, cfg.tenant_id, req.params.externalId);
      res.json(out);
    } catch (err) {
      console.error('[reelance-ia] order delete webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/order/:externalId', (req, res) => {
    const token = _extractBearer(req);
    const cfg = svc.getConfigByToken(db, token);
    if (!cfg) return res.status(401).json({ error: 'invalid_token' });
    if (!cfg.enabled) return res.status(403).json({ error: 'app_disabled' });
    try {
      const out = svc.deleteOrderEvents(db, cfg.tenant_id, req.params.externalId);
      console.log(`[reelance-ia] DELETE webhook ${req.params.externalId} → events=${out.deletedEvents}`);
      res.json(out);
    } catch (err) {
      console.error('[reelance-ia] order delete webhook error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Health check (sin auth — para que la tienda Next.js verifique conectividad)
  router.get('/ping', (_req, res) => res.json({ ok: true, app: 'reelance-ia', version: '1.0.0' }));

  return router;
}

function authRouter(db) {
  const router = express.Router();

  router.get('/config', (req, res) => {
    const cfg = svc.ensureConfig(db, req.tenantId);
    res.json(_sanitize(cfg));
  });

  router.put('/config', express.json(), (req, res) => {
    const cfg = svc.updateConfig(db, req.tenantId, req.body || {});
    res.json(_sanitize(cfg));
  });

  router.post('/regenerate-token', (req, res) => {
    svc.ensureConfig(db, req.tenantId);
    const newToken = svc.regenerateToken(db, req.tenantId);
    res.json({ token: newToken });
  });

  // Lista etiquetas existentes en el tenant — contact_tags + expedient_tags
  // unificadas. Frontend las usa para autocompletar en el selector de etiquetas.
  router.get('/tags-suggestions', (req, res) => {
    try {
      const contactTags = db.prepare(`
        SELECT DISTINCT t.tag AS name, 'contact' AS source
        FROM contact_tags t JOIN contacts c ON c.id = t.contact_id
        WHERE c.tenant_id = ? AND t.tag != ''
      `).all(req.tenantId);
      const leadTags = db.prepare(`
        SELECT DISTINCT t.tag AS name, 'lead' AS source
        FROM expedient_tags t JOIN expedients e ON e.id = t.expedient_id
        WHERE e.tenant_id = ? AND t.tag != ''
      `).all(req.tenantId);
      // Mergear y deduplicar — si una etiqueta existe en ambos, indicar 'both'
      const map = new Map();
      for (const t of [...contactTags, ...leadTags]) {
        const existing = map.get(t.name);
        if (existing && existing.source !== t.source) {
          map.set(t.name, { name: t.name, source: 'both' });
        } else if (!existing) {
          map.set(t.name, t);
        }
      }
      const items = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      res.json({ items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/events', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = db.prepare(`
      SELECT id, event_type, external_id, external_status, contact_id, lead_id, processed_at, error
      FROM reelance_ia_events
      WHERE tenant_id = ?
      ORDER BY processed_at DESC LIMIT ?
    `).all(req.tenantId, limit);
    res.json({ items: rows });
  });

  // GET /orders — lista órdenes de Reelance IA (parsea el payload de eventos
  // tipo 'order' y aplica dedup por external_id manteniendo el último status).
  // Misma shape que /api/apps/woo/orders para compat con el tab Orders.
  router.get('/orders', (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;

    // Traemos eventos de tipo 'order' del tenant. Como pueden haber varios
    // eventos del mismo external_id (por updates), tomamos solo el más
    // reciente de cada uno.
    const rows = db.prepare(`
      SELECT e.* FROM reelance_ia_events e
      WHERE e.tenant_id = ? AND e.event_type = 'order'
        AND e.processed_at = (
          SELECT MAX(processed_at) FROM reelance_ia_events
          WHERE tenant_id = e.tenant_id AND event_type = 'order'
            AND external_id = e.external_id
        )
      ORDER BY e.processed_at DESC LIMIT ? OFFSET ?
    `).all(req.tenantId, limit, offset);

    const totalRow = db.prepare(`
      SELECT COUNT(DISTINCT external_id) AS n FROM reelance_ia_events
      WHERE tenant_id = ? AND event_type = 'order'
    `).get(req.tenantId);
    const total = totalRow?.n || 0;
    const pages = Math.max(1, Math.ceil(total / limit));

    // Parsear payload y armar shape compatible con woo orders (nombres alineados).
    const orders = rows.map(r => {
      let payload = {};
      try { payload = JSON.parse(r.payload || '{}'); } catch (_) {}
      const items = Array.isArray(payload.items) ? payload.items : [];
      const subtotalCents = (payload.subtotalCents != null) ? payload.subtotalCents : items.reduce((s, i) => s + (i.totalCents || 0), 0);
      const totalCents    = payload.totalCents != null ? payload.totalCents : subtotalCents;
      const shippingCents = payload.shippingCents || 0;
      const discountCents = Math.max(0, (subtotalCents + shippingCents) - totalCents);
      const shippingAddrJson = JSON.stringify({
        address1: payload.shippingAddress || '',
        address2: '',
        city:     payload.shippingCity || '',
        state:    payload.shippingState || '',
        postcode: payload.shippingZip || '',
        country:  'MX',
      });
      return {
        id:                 r.id,
        source:             'reelance-ia',
        external_id:        r.external_id,
        wc_id:              null,
        wc_order_id:        r.external_id,
        wc_order_number:    payload.id ? String(payload.id).slice(-8) : String(r.id),
        order_number:       payload.id ? `#${String(payload.id).slice(-8)}` : `#${r.id}`,
        customer_name:      payload.customerName || '',
        customer_email:     payload.email || '',
        customer_phone:     payload.phone || '',
        shipping_address:   payload.shippingAddress || '',
        shipping_city:      payload.shippingCity || '',
        shipping_state:     payload.shippingState || '',
        shipping_zip:       payload.shippingZip || '',
        shipping_address_json: shippingAddrJson,
        order_total:        (totalCents / 100).toFixed(2),
        total:              (totalCents / 100).toFixed(2),
        shipping_total:     (shippingCents / 100).toFixed(2),
        discount_total:     (discountCents / 100).toFixed(2),
        currency:           payload.currency || 'MXN',
        status:             (r.external_status || payload.status || 'unknown').toLowerCase(),
        payment_method:     payload.paymentProvider || null,
        payment_provider:   payload.paymentProvider || null,
        tracking_carrier:   payload.trackingCarrier || null,
        tracking_number:    payload.trackingNumber || null,
        tracking_url:       payload.trackingUrl || null,
        utm_source:         payload.utmSource || null,
        utm_medium:         payload.utmMedium || null,
        utm_campaign:       payload.utmCampaign || null,
        products: items.map(i => ({
          name:       i.productName || '',
          quantity:   i.quantity || 0,
          total:      i.totalCents ? (i.totalCents / 100).toFixed(2) : '0.00',
          product_id: i.productId || null,
        })),
        products_json: JSON.stringify(items.map(i => ({
          name:       i.productName || '',
          quantity:   i.quantity || 0,
          total:      i.totalCents ? (i.totalCents / 100).toFixed(2) : '0.00',
          product_id: i.productId || null,
        }))),
        line_items: items.map(i => ({
          name:       i.productName || '',
          quantity:   i.quantity || 0,
          total:      i.totalCents ? (i.totalCents / 100).toFixed(2) : '0.00',
          product_id: i.productId || null,
        })),
        contact_id:    r.contact_id,
        lead_id:       r.lead_id,
        wc_order_date: r.processed_at,
        created_at:    r.processed_at,
        processed_at:  r.processed_at,
        error:         r.error,
      };
    });

    res.json({ orders, page, pages, total });
  });

  // PATCH /api/apps/reelance-ia/orders/:id/tracking
  // El frontend de wapi llama esto cuando el user pone carrier + tracking
  // en un pedido de Reelance IA. Hace:
  //   1. Actualiza el payload del último evento con tracking + status
  //   2. Inserta NEW event row con external_status nuevo (idempotente)
  //   3. Llena custom fields del lead (Paqueteria + Número de Rastreo)
  //   4. Si status implica pago/envío → mueve lead al stage Won del pipeline
  //   5. Push a lucho101 vía PATCH /api/ai/admin/orders/<externalId>
  router.patch('/orders/:id/tracking', async (req, res) => {
    const eventId = Number(req.params.id);
    const { carrier, tracking_number, tracking_status, wc_status } = req.body || {};
    const tenantId = req.tenantId;

    // Buscar el evento (que es la fila de la "orden" en /orders endpoint)
    const event = db.prepare(
      "SELECT * FROM reelance_ia_events WHERE id = ? AND tenant_id = ? AND event_type = 'order'"
    ).get(eventId, tenantId);
    if (!event) return res.status(404).json({ error: 'Pedido no encontrado en Reelance IA' });

    let payload = {};
    try { payload = JSON.parse(event.payload || '{}'); } catch (_) {}

    // 1. Actualizar payload local
    const updatedPayload = {
      ...payload,
      trackingCarrier: carrier || payload.trackingCarrier,
      trackingNumber:  tracking_number || payload.trackingNumber,
      trackingStatus:  tracking_status || payload.trackingStatus,
      status:          wc_status ? wc_status.toUpperCase() : payload.status,
    };
    const newStatus = updatedPayload.status || event.external_status;

    // Guardar update sobre el mismo row (no insertar nuevo — el endpoint /orders
    // toma siempre el MAX(processed_at) por external_id)
    db.prepare(
      "UPDATE reelance_ia_events SET payload = ?, external_status = ?, processed_at = unixepoch() WHERE id = ?"
    ).run(JSON.stringify(updatedPayload), newStatus, eventId);

    // 2. Llenar custom fields del lead (Paqueteria + Número de Rastreo)
    try {
      if (event.lead_id) {
        const fields = db.prepare(
          "SELECT id, label FROM custom_field_defs WHERE tenant_id = ? AND entity = 'expedient'"
        ).all(tenantId);
        const findField = (re) => fields.find(f => re.test(f.label));
        const paqDef  = findField(/paqueter/i);
        const trkDef  = findField(/rastreo|tracking/i);
        const upsert = (fieldId, value) => {
          db.prepare(`
            INSERT INTO custom_field_values (tenant_id, entity, record_id, field_id, value)
            VALUES (?, 'expedient', ?, ?, ?)
            ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
          `).run(tenantId, event.lead_id, fieldId, String(value || ''));
        };
        if (paqDef && carrier)         upsert(paqDef.id, carrier);
        if (trkDef && tracking_number) upsert(trkDef.id, tracking_number);
      }
    } catch (e) { console.warn('[ria tracking] custom fields:', e.message); }

    // 3.0 Pre-check pipeline_rules: si vamos a aplicar reglas de duración,
    // skipamos el move-to-Won intermedio (evita doble movimiento).
    const svc = require('./service');
    const cfg = svc.getConfigByTenant(db, tenantId);
    const COMPLETED_LIKE = ['COMPLETED', 'FULFILLED', 'SHIPPED'];
    const willRoutePipeline = !!(
      event.lead_id && cfg && carrier && tracking_number &&
      COMPLETED_LIKE.includes(String(newStatus).toUpperCase()) &&
      cfg.pipeline_rules && cfg.products_json
    );

    // 3. Mover a Won SOLO si NO vamos a rutear por pipeline rules
    if (!willRoutePipeline) {
      try {
        const PAID = ['PAID', 'PROCESSING', 'COMPLETED', 'FULFILLED', 'SHIPPED'];
        if (event.lead_id && PAID.includes(String(newStatus).toUpperCase())) {
          const lead = db.prepare('SELECT pipeline_id, stage_id FROM expedients WHERE id = ? AND tenant_id = ?').get(event.lead_id, tenantId);
          if (lead) {
            const wonStage = db.prepare(
              "SELECT id FROM stages WHERE pipeline_id = ? AND tenant_id = ? AND kind = 'won' ORDER BY id LIMIT 1"
            ).get(lead.pipeline_id, tenantId);
            if (wonStage && wonStage.id !== lead.stage_id) {
              db.prepare(
                "UPDATE expedients SET stage_id = ?, stage_entered_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
              ).run(wonStage.id, event.lead_id);
            }
          }
        }
      } catch (e) { console.warn('[ria tracking] move-to-won:', e.message); }
    }

    // 3.5 Pipeline rules: mueve directo al pipeline destino (1 MES, 2 MESES, etc).
    // Al entrar al stage destino, el bot configurado disparará automáticamente.
    if (willRoutePipeline) {
      try {
        const lead = db.prepare('SELECT * FROM expedients WHERE id = ? AND tenant_id = ?').get(event.lead_id, tenantId);
        if (lead && typeof svc._routeOrderToPipeline === 'function') {
          const enriched = { ...updatedPayload, status: String(newStatus).toUpperCase() };
          svc._routeOrderToPipeline(db, tenantId, lead, enriched, cfg);
          console.log('[ria tracking] lead', event.lead_id, '→ ruteado por pipeline_rules');
        }
      } catch (e) { console.warn('[ria tracking] route-pipeline:', e.message); }
    }

    // 4. Push a lucho101 (best-effort, no bloquea respuesta)
    let luchoPush = false, luchoError = null;
    const luchoBase  = process.env.REELANCE_IA_LUCHO_BASE_URL || 'http://localhost:3000';
    const luchoToken = process.env.REELANCE_IA_LUCHO_TOKEN || '';
    if (luchoToken) {
      try {
        const body = {};
        if (carrier)         body.shippingCarrier = carrier;
        if (tracking_number) body.trackingNumber  = tracking_number;
        if (wc_status) {
          // Mapeo status wapi → lucho
          const map = {
            'completed':  'COMPLETED',
            'processing': 'PROCESSING',
            'on-hold':    'ON_HOLD',
            'pending':    'PENDING',
            'cancelled':  'CANCELLED',
            'fulfilled':  'FULFILLED',
            'refunded':   'REFUNDED',
          };
          body.status = map[wc_status.toLowerCase()] || wc_status.toUpperCase();
        }
        const url = `${luchoBase.replace(/\/$/, '')}/api/ai/admin/orders/${encodeURIComponent(event.external_id)}`;
        const resp = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${luchoToken}` },
          body: JSON.stringify(body),
        });
        if (resp.ok) luchoPush = true;
        else luchoError = `HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
      } catch (e) { luchoError = e.message; }
    } else {
      luchoError = 'no-token (REELANCE_IA_LUCHO_TOKEN no configurado en .env)';
    }

    res.json({ ok: true, luchoPush, luchoError, hasCredentials: !!luchoToken });
  });

  // DELETE admin — borra evento por id local (usado por la UI de Pedidos)
  router.delete('/orders/:id', (req, res) => {
    const eventId = Number(req.params.id);
    const ev = db.prepare("SELECT external_id FROM reelance_ia_events WHERE id = ? AND tenant_id = ?")
      .get(eventId, req.tenantId);
    if (!ev) return res.status(404).json({ error: 'no encontrado' });
    try {
      const out = svc.deleteOrderEvents(db, req.tenantId, ev.external_id);
      res.json(out);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // GET /api/apps/reelance-ia/order-statuses
  // Proxy a lucho101 — retorna los OrderStatusConfig activos. Cache muy corto
  // (memoria, 30s) para evitar pegarle a lucho101 en cada render del modal.
  router.get('/order-statuses', async (req, res) => {
    // ROBUSTO: lee la tabla OrderStatusConfig DIRECTO de la DB SQLite de la
    // tienda Next.js (reelance.mx) — está en el MISMO VPS. NO depende del
    // build de Next.js (que se reconstruía sin la ruta /api/ai/admin/order-
    // statuses → 404 recurrente) ni de HTTP ni de tokens. A prueba de rebuilds.
    const FALLBACK = [
      { key: 'PENDING',    label: 'Pendiente de pago' },
      { key: 'ON_HOLD',    label: 'A la espera' },
      { key: 'PROCESSING', label: 'Procesando' },
      { key: 'COMPLETED',  label: 'Completado' },
      { key: 'INVOICED',   label: 'Completado / Facturado' },
      { key: 'CANCELLED',  label: 'Cancelado' },
      { key: 'FAILED',     label: 'Fallido' },
      { key: 'REFUNDED',   label: 'Reembolsado' },
    ];
    const dbPath = process.env.REELANCE_IA_LUCHO_DB || '/var/www/reelance/prisma/dev.db';
    let luchoDb = null;
    try {
      const BetterSqlite3 = require('better-sqlite3');
      luchoDb = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
      const rows = luchoDb.prepare(
        'SELECT key, label, colorClass, position FROM OrderStatusConfig WHERE isActive = 1 ORDER BY position ASC'
      ).all();
      luchoDb.close(); luchoDb = null;
      if (rows && rows.length) {
        return res.json({ statuses: rows, source: 'reelance-db' });
      }
      return res.json({ statuses: FALLBACK, source: 'fallback-empty' });
    } catch (err) {
      if (luchoDb) { try { luchoDb.close(); } catch (_) {} }
      console.warn('[reelance-ia] order-statuses DB read failed:', err.message);
      // Último recurso: lista hardcoded (siempre devuelve algo, nunca vacío)
      return res.json({ statuses: FALLBACK, source: 'fallback-error', error: err.message });
    }
  });

  return router;
}

function _extractBearer(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// El token se devuelve solo en /config (lo necesita la UI para copiarlo
// al .env de la tienda). Si quisiéramos esconderlo, lo separaríamos.
function _sanitize(cfg) {
  if (!cfg) return null;
  return { ...cfg };
}

module.exports = { webhookRouter, authRouter };
