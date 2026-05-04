const express = require('express');
const service = require('./service');

module.exports = function createNotificationsRouter(db) {
  const router = express.Router();

  // Public-ish: el cliente necesita la VAPID pública para suscribirse
  router.get('/vapid-public-key', (_req, res) => {
    res.json({ publicKey: service.getPublicKey() });
  });

  router.post('/subscribe', (req, res, next) => {
    try {
      const sub = req.body?.subscription || req.body;
      if (!sub?.endpoint) return res.status(400).json({ error: 'Falta endpoint' });
      service.addSubscription(db, req.tenantId, sub, {
        userAgent: req.headers['user-agent'] || null,
        advisorId: req.advisor?.id || null,
      });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/unsubscribe', (req, res, next) => {
    try {
      const endpoint = req.body?.endpoint;
      if (!endpoint) return res.status(400).json({ error: 'Falta endpoint' });
      service.removeSubscription(db, endpoint);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/test', async (req, res, next) => {
    try {
      const result = await service.sendToAll(db, req.tenantId, {
        title: 'Reelance CRM',
        body:  'Test de notificación push ✓',
        tag:   'test',
        url:   '/',
      }, { kind: 'manual' });
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get('/log', (req, res, next) => {
    try {
      const items = db.prepare(
        'SELECT id, kind, title, body, sent_count, failed, created_at FROM alert_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 50'
      ).all(req.tenantId);
      res.json({ items });
    } catch (err) { next(err); }
  });

  return router;
};
