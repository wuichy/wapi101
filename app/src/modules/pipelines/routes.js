const express = require('express');
const service = require('./service');

module.exports = function createPipelinesRouter(db) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try { res.json({ items: service.listWithStages(db, req.tenantId) }); }
    catch (err) { next(err); }
  });

  router.post('/', (req, res, next) => {
    try { res.status(201).json({ item: service.create(db, req.tenantId, req.body) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/:id', (req, res, next) => {
    try { res.json({ item: service.update(db, req.tenantId, Number(req.params.id), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res, next) => {
    try { service.remove(db, req.tenantId, Number(req.params.id), req.advisor); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Pipeline reorder ──
  router.post('/reorder', (req, res, next) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un array' });
      service.reorderPipelines(db, req.tenantId, order.map(Number));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ── Stages ──
  router.post('/:id/stages/reorder', (req, res, next) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un array' });
      service.reorderStages(db, req.tenantId, Number(req.params.id), order.map(Number));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/:id/stages', (req, res, next) => {
    try { res.status(201).json({ item: service.createStage(db, req.tenantId, Number(req.params.id), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/stages/:stageId', (req, res, next) => {
    try { res.json({ item: service.updateStage(db, req.tenantId, Number(req.params.stageId), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/stages/:stageId', (req, res, next) => {
    try { service.removeStage(db, req.tenantId, Number(req.params.stageId), req.advisor); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
