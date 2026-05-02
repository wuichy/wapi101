// Rutas HTTP del módulo Clientes. Aislado: si algo aquí falla, los demás módulos siguen.

const express = require('express');
const service = require('./service');

module.exports = function createCustomersRouter(db) {
  const router = express.Router();

  router.get('/', (req, res, next) => {
    try {
      const result = service.list(db, {
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
      const item = service.getById(db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.post('/', (req, res, next) => {
    try {
      const item = service.create(db, req.body || {});
      res.status(201).json({ item });
    } catch (err) {
      if (/obligatorio/i.test(err.message)) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  router.patch('/:id', (req, res, next) => {
    try {
      const item = service.update(db, Number(req.params.id), req.body || {});
      if (!item) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const ok = service.remove(db, Number(req.params.id), req.advisor);
      if (!ok) return res.status(404).json({ error: 'No encontrado' });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Pausar / reanudar bot para un contacto
  router.patch('/:id/bot-paused', (req, res, next) => {
    try {
      const paused = req.body.paused ? 1 : 0;
      const r = db.prepare('UPDATE contacts SET bot_paused = ? WHERE id = ?').run(paused, Number(req.params.id));
      if (!r.changes) return res.status(404).json({ error: 'No encontrado' });
      res.json({ id: Number(req.params.id), bot_paused: paused });
    } catch (err) { next(err); }
  });

  // Detección de duplicado puntual (para el preview de import)
  router.post('/check-duplicate', (req, res, next) => {
    try {
      const dupe = service.findDuplicate(db, req.body || {});
      res.json({ duplicate: dupe ? { id: dupe.id, firstName: dupe.first_name, lastName: dupe.last_name } : null });
    } catch (err) { next(err); }
  });

  // Importación bulk
  router.post('/import', (req, res, next) => {
    try {
      const { rows = [], dupePolicy = 'skip', bulkTag = null } = req.body || {};
      const result = service.importBulk(db, rows, { dupePolicy, bulkTag });
      res.json(result);
    } catch (err) { next(err); }
  });

  return router;
};
