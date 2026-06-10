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
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'PIPELINE_VALIDATION_FAILED' }); }
  });

  router.patch('/:id', (req, res, next) => {
    try { res.json({ item: service.update(db, req.tenantId, Number(req.params.id), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'PIPELINE_VALIDATION_FAILED' }); }
  });

  router.delete('/:id', (req, res, next) => {
    try { service.remove(db, req.tenantId, Number(req.params.id), req.advisor); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'PIPELINE_DELETE_FAILED' }); }
  });

  // ── Pipeline reorder ──
  // Asegurar etapas Ganados/Perdidos en todos los pipelines del tenant.
  // Llamado por la UI cuando el user prende el toggle "Valor de lead".
  // Contar leads en stages won/lost (antes de desactivar el toggle)
  router.get('/outcome-stages-count', (req, res, next) => {
    try {
      const counts = service.countLeadsInOutcomeStages(db, req.tenantId);
      res.json({ ok: true, ...counts });
    } catch (err) { next(err); }
  });

  // Eliminar stages won/lost (mueve leads a in_progress o a destino dado)
  router.post('/remove-outcome-stages', (req, res, next) => {
    try {
      const { moveToStageId } = req.body || {};
      const result = service.removeOutcomeStages(db, req.tenantId, {
        moveToStageId: moveToStageId ? Number(moveToStageId) : null,
      });
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  router.post('/ensure-outcome-stages', (req, res, next) => {
    try {
      const result = service.ensureOutcomeStages(db, req.tenantId);
      res.json({ ok: true, ...result });
    } catch (err) { next(err); }
  });

  router.post('/reorder', (req, res, next) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un array', errorCode: 'ORDER_INVALID' });
      service.reorderPipelines(db, req.tenantId, order.map(Number));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message, errorCode: 'PIPELINE_REORDER_FAILED' }); }
  });

  // ── Stages ──
  router.post('/:id/stages/reorder', (req, res, next) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) return res.status(400).json({ error: 'order debe ser un array', errorCode: 'ORDER_INVALID' });
      service.reorderStages(db, req.tenantId, Number(req.params.id), order.map(Number));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message, errorCode: 'STAGE_REORDER_FAILED' }); }
  });

  router.post('/:id/stages', (req, res, next) => {
    try { res.status(201).json({ item: service.createStage(db, req.tenantId, Number(req.params.id), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'STAGE_VALIDATION_FAILED' }); }
  });

  router.patch('/stages/:stageId', (req, res, next) => {
    try { res.json({ item: service.updateStage(db, req.tenantId, Number(req.params.stageId), req.body) }); }
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'STAGE_VALIDATION_FAILED' }); }
  });

  // IA por etapa — prende/apaga que la IA responda a los leads de esta etapa.
  router.patch('/stages/:stageId/ai', (req, res, next) => {
    try {
      const ok = service.setStageAi(db, req.tenantId, Number(req.params.stageId), !!req.body?.enabled);
      res.json({ ok, enabled: !!req.body?.enabled });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/stages/:stageId', (req, res, next) => {
    try { service.removeStage(db, req.tenantId, Number(req.params.stageId), req.advisor); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message, errorCode: 'STAGE_DELETE_FAILED' }); }
  });

  return router;
};
