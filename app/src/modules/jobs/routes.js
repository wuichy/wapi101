// Routes para bulk jobs — el frontend polea estos endpoints para
// mostrar la barra de progreso global.
const express = require('express');
const runner  = require('./runner');

module.exports = function createJobsRouter(db) {
  const router = express.Router();

  // GET /api/jobs/active — jobs activos del tenant (para mostrar barra al login)
  router.get('/active', (req, res, next) => {
    try {
      const jobs = runner.getActiveJobsForTenant(db, req.tenantId);
      res.json({ items: jobs });
    } catch (e) { next(e); }
  });

  // GET /api/jobs/:id — estado actual de un job
  router.get('/:id', (req, res, next) => {
    try {
      const job = runner.getJob(db, Number(req.params.id));
      if (!job) return res.status(404).json({ error: 'Job no encontrado' });
      res.json({ item: job });
    } catch (e) { next(e); }
  });

  // DELETE /api/jobs/:id — cancela un job en curso
  router.delete('/:id', (req, res, next) => {
    try {
      const job = runner.cancelJob(db, req.tenantId, Number(req.params.id));
      if (!job) return res.status(404).json({ error: 'Job no encontrado' });
      res.json({ item: job });
    } catch (e) { next(e); }
  });

  return router;
};
