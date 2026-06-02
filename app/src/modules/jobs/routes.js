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

  // Pausar un job en running (queda en 'paused', no se toca processed/failed)
  router.post('/:id/pause', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const job = db.prepare('SELECT id, status FROM bulk_jobs WHERE id = ? AND tenant_id = ?').get(id, req.tenantId);
      if (!job) return res.status(404).json({ error: 'Job no encontrado' });
      if (!['queued', 'running'].includes(job.status)) {
        return res.status(400).json({ error: `No se puede pausar un job en estado '${job.status}'` });
      }
      db.prepare("UPDATE bulk_jobs SET status='paused', updated_at=unixepoch() WHERE id=?").run(id);
      res.json({ ok: true, id, status: 'paused' });
    } catch (e) { next(e); }
  });

  // Reanudar un job pausado — vuelve a 'running' (el runner tick lo agarra)
  router.post('/:id/resume', (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const job = db.prepare('SELECT id, status FROM bulk_jobs WHERE id = ? AND tenant_id = ?').get(id, req.tenantId);
      if (!job) return res.status(404).json({ error: 'Job no encontrado' });
      if (job.status !== 'paused') {
        return res.status(400).json({ error: `Solo se puede reanudar jobs pausados (actual: '${job.status}')` });
      }
      db.prepare("UPDATE bulk_jobs SET status='running', updated_at=unixepoch() WHERE id=?").run(id);
      res.json({ ok: true, id, status: 'running' });
    } catch (e) { next(e); }
  });

  return router;
};
