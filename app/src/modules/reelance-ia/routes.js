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
