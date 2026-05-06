// Endpoints del módulo de Recordatorios:
//   GET    /api/tasks               lista con filtros (?filter=overdue&advisorId=&expedientId=)
//   GET    /api/tasks/:id           detalle
//   POST   /api/tasks               crear
//   PATCH  /api/tasks/:id           actualizar (incluye marcar completed)
//   DELETE /api/tasks/:id           eliminar
//   GET    /api/tasks/by-expedients?ids=1,2,3   conteo pending/overdue por lead
//                                                (para iconos en cards de pipeline)

const express = require('express');
const service = require('./service');

module.exports = function createTasksRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const { filter, advisorId, expedientId, contactId, limit } = req.query;
    try {
      const items = service.list(db, req.tenantId, {
        filter: filter || 'pending',
        advisorId: advisorId ? Number(advisorId) : null,
        expedientId: expedientId ? Number(expedientId) : null,
        contactId: contactId ? Number(contactId) : null,
        limit: limit ? Math.min(500, Number(limit)) : 200,
      });
      res.json({ items });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/by-expedients', (req, res) => {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(n => Number.isFinite(n) && n > 0);
    if (!ids.length) return res.json({ counts: {} });
    try {
      const map = service.countByExpedients(db, req.tenantId, ids);
      const counts = {};
      for (const [expId, v] of map.entries()) counts[expId] = v;
      res.json({ counts });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/:id', (req, res) => {
    try {
      const task = service.getById(db, req.tenantId, Number(req.params.id));
      if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
      res.json(task);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/', (req, res) => {
    try {
      const task = service.create(db, req.tenantId, {
        title:              req.body?.title,
        description:        req.body?.description,
        dueAt:              req.body?.dueAt,
        assignedAdvisorId:  req.body?.assignedAdvisorId || req.advisor?.id,
        expedientId:        req.body?.expedientId,
        contactId:          req.body?.contactId,
        createdByAdvisorId: req.advisor?.id,
      });
      res.json(task);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/:id', (req, res) => {
    try {
      const task = service.update(db, req.tenantId, Number(req.params.id), req.body || {});
      res.json(task);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res) => {
    try {
      service.remove(db, req.tenantId, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
