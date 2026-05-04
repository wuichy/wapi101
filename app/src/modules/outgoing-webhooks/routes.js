const express = require('express');
const service = require('./service');
const { AVAILABLE_EVENTS } = require('../auth/routes');

module.exports = function createOutgoingWebhooksRouter(db) {
  const router = express.Router();

  router.get('/events', (_req, res) => {
    res.json({ events: AVAILABLE_EVENTS });
  });

  router.get('/', (req, res, next) => {
    try { res.json({ items: service.list(db, req.tenantId) }); }
    catch (e) { next(e); }
  });

  router.post('/', (req, res, next) => {
    try {
      const item = service.create(db, req.tenantId, req.body || {});
      res.status(201).json({ item });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const item = service.update(db, req.tenantId, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const ok = service.remove(db, req.tenantId, Number(req.params.id));
      if (!ok) return res.status(404).json({ error: 'No encontrado' });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
};
