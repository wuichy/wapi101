// Endpoints de fuentes de conocimiento para la IA.
//   GET    /api/ai-knowledge          lista
//   GET    /api/ai-knowledge/:id      detalle
//   POST   /api/ai-knowledge          crear
//   PATCH  /api/ai-knowledge/:id      actualizar
//   DELETE /api/ai-knowledge/:id      eliminar

const express = require('express');
const service = require('./service');

module.exports = function createAiKnowledgeRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    try { res.json({ items: service.list(db, req.tenantId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/:id', (req, res) => {
    try {
      const item = service.getById(db, req.tenantId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Fuente no encontrada' });
      res.json(item);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/', (req, res) => {
    try {
      const item = service.create(db, req.tenantId, req.body || {});
      res.json(item);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/:id', (req, res) => {
    try {
      const item = service.update(db, req.tenantId, Number(req.params.id), req.body || {});
      res.json(item);
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
