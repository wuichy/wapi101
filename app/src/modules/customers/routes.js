// Rutas HTTP del módulo Clientes. Aislado: si algo aquí falla, los demás módulos siguen.

const express = require('express');
const service = require('./service');

module.exports = function createCustomersRouter(db) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try {
      const result = service.list(db, req.tenantId, {
        search: req.query.q,
        page: req.query.page,
        pageSize: req.query.pageSize,
        sortBy: req.query.sortBy,
        sortDir: req.query.sortDir
      });
      res.json(result);
    } catch (err) { next(err); }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const item = service.getById(db, req.tenantId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.post('/', (req, res, next) => {
    try {
      const item = service.create(db, req.tenantId, req.body || {});
      // Track activity
      try {
        require('../analytics/service').log(db, {
          tenantId: req.tenantId,
          kind: 'contact_created',
          advisorId: req.advisor?.id || null,
          targetType: 'contact',
          targetId: item.id,
        });
      } catch (_) {}
      res.status(201).json({ item });
    } catch (err) {
      if (/obligatorio/i.test(err.message)) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const item = service.update(db, req.tenantId, Number(req.params.id), req.body || {});
      if (!item) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const ok = service.remove(db, req.tenantId, Number(req.params.id), req.advisor);
      if (!ok) return res.status(404).json({ error: 'No encontrado' });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Lista de leads asociados a un contacto. Se usa antes del delete para mostrar
  // al usuario qué información perderá si confirma la eliminación en cascada.
  router.get('/:id/leads-preview', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const items = db.prepare(`
        SELECT e.id, e.name, e.created_at AS createdAt,
               p.name AS pipelineName, p.color AS pipelineColor,
               s.name AS stageName,    s.color AS stageColor
          FROM expedients e
          LEFT JOIN pipelines p ON p.id = e.pipeline_id
          LEFT JOIN stages    s ON s.id = e.stage_id
         WHERE e.contact_id = ? AND e.tenant_id = ?
         ORDER BY e.created_at DESC
      `).all(id, req.tenantId);
      res.json({ items, count: items.length });
    } catch (err) { next(err); }
  });

  // Pausar / reanudar bot para un contacto
  router.patch('/:id/bot-paused', (req, res, next) => {
    try {
      const paused = req.body.paused ? 1 : 0;
      const r = db.prepare('UPDATE contacts SET bot_paused = ? WHERE id = ? AND tenant_id = ?')
        .run(paused, Number(req.params.id), req.tenantId);
      if (!r.changes) return res.status(404).json({ error: 'No encontrado' });
      res.json({ id: Number(req.params.id), bot_paused: paused });
    } catch (err) { next(err); }
  });

  // Detección de duplicado puntual (para el preview de import)
  router.post('/check-duplicate', (req, res, next) => {
    try {
      const dupe = service.findDuplicate(db, req.tenantId, req.body || {});
      res.json({ duplicate: dupe ? { id: dupe.id, firstName: dupe.first_name, lastName: dupe.last_name } : null });
    } catch (err) { next(err); }
  });

  // Importación bulk
  router.post('/import', (req, res, next) => {
    try {
      const { rows = [], dupePolicy = 'skip', bulkTag = null } = req.body || {};
      const result = service.importBulk(db, req.tenantId, rows, { dupePolicy, bulkTag });
      res.json(result);
    } catch (err) { next(err); }
  });

  return router;
};
