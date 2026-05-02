const express = require('express');
const service  = require('./service');

module.exports = function createTrashRouter(db) {
  const router = express.Router();

  router.get('/', (_req, res, next) => {
    try { res.json({ items: service.list(db) }); }
    catch (err) { next(err); }
  });

  router.post('/:id/restore', (req, res, next) => {
    try { res.json({ item: service.restore(db, Number(req.params.id)) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res, next) => {
    try { service.permanentDelete(db, Number(req.params.id)); res.json({ ok: true }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/', (_req, res, next) => {
    try {
      db.prepare('DELETE FROM trash').run();
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  return router;
};
