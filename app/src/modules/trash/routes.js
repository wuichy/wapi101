const express = require('express');
const service  = require('./service');

module.exports = function createTrashRouter(db) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try { res.json({ items: service.list(db, req.tenantId) }); }
    catch (err) { next(err); }
  });

  router.post('/:id/restore', (req, res, next) => {
    try { res.json({ item: service.restore(db, req.tenantId, Number(req.params.id)) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res, next) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden borrar permanentemente' });
    }
    try { service.permanentDelete(db, req.tenantId, Number(req.params.id)); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/', (req, res, next) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo los administradores pueden vaciar la papelera' });
    }
    try {
      db.prepare('DELETE FROM trash WHERE tenant_id = ?').run(req.tenantId);
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
};
