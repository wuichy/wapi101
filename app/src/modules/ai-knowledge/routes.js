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

  // GET /:id/download — exporta la fuente como archivo .md descargable
  router.get('/:id/download', (req, res) => {
    try {
      const item = service.getById(db, req.tenantId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'Fuente no encontrada' });
      const exportedAt = new Date().toISOString();
      const md = `# ${item.title}\n\n` +
        `- **Categoría**: ${item.category || '—'}\n` +
        `- **Estado**: ${item.active ? 'Activa' : 'Desactivada'}\n` +
        `- **Exportado**: ${exportedAt}\n\n` +
        `---\n\n${item.content || ''}\n`;
      // Sanitizar el filename: solo letras, números, espacios, guiones
      const safeTitle = String(item.title || `fuente-${item.id}`)
        .replace(/[^a-zA-Z0-9\s\-_]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 60) || `fuente-${item.id}`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.md"`);
      res.send(md);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res) => {
    try {
      service.remove(db, req.tenantId, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
