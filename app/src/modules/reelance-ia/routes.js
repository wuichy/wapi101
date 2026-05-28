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

    // Parsear payload y armar shape compatible con woo orders
    const orders = rows.map(r => {
      let payload = {};
      try { payload = JSON.parse(r.payload || '{}'); } catch (_) {}
      const items = Array.isArray(payload.items) ? payload.items : [];
      return {
        id:              r.id,
        source:          'reelance-ia',
        external_id:     r.external_id,
        wc_id:           null,
        order_number:    payload.id ? `#${String(payload.id).slice(-8)}` : `#${r.id}`,
        customer_name:   payload.customerName || '',
        customer_email:  payload.email || '',
        customer_phone:  payload.phone || '',
        shipping_address: payload.shippingAddress || '',
        shipping_city:   payload.shippingCity || '',
        shipping_state:  payload.shippingState || '',
        shipping_zip:    payload.shippingZip || '',
        total:           payload.totalCents ? (payload.totalCents / 100).toFixed(2) : '0.00',
        currency:        payload.currency || 'MXN',
        status:          (r.external_status || payload.status || 'unknown').toLowerCase(),
        payment_provider: payload.paymentProvider || null,
        tracking_carrier: payload.trackingCarrier || null,
        tracking_number:  payload.trackingNumber || null,
        tracking_url:     payload.trackingUrl || null,
        utm_source:      payload.utmSource || null,
        utm_medium:      payload.utmMedium || null,
        utm_campaign:    payload.utmCampaign || null,
        line_items:      items.map(i => ({
          name:     i.productName || '',
          quantity: i.quantity || 0,
          total:    i.totalCents ? (i.totalCents / 100).toFixed(2) : '0.00',
          product_id: i.productId || null,
        })),
        contact_id:      r.contact_id,
        lead_id:         r.lead_id,
        wc_order_date:   r.processed_at,
        processed_at:    r.processed_at,
        error:           r.error,
      };
    });

    res.json({ orders, page, pages, total });
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
