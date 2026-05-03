// CRUD de etiquetas de plantillas + asignación a templates.
// Mismo patrón que bot-tags pero para message_templates.

const express = require('express');

module.exports = function templateTagsRoutes(db) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const items = db.prepare(`
      SELECT id, name, color, created_at
        FROM template_tags
       ORDER BY name COLLATE NOCASE
    `).all();
    res.json({ items });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#94a3b8').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    try {
      const r = db.prepare('INSERT INTO template_tags (name, color) VALUES (?, ?)').run(name, color);
      const tag = db.prepare('SELECT id, name, color, created_at FROM template_tags WHERE id = ?').get(r.lastInsertRowid);
      res.json(tag);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
      throw err;
    }
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#94a3b8').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const existing = db.prepare('SELECT id FROM template_tags WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    try {
      db.prepare('UPDATE template_tags SET name = ?, color = ? WHERE id = ?').run(name, color, id);
      const tag = db.prepare('SELECT id, name, color, created_at FROM template_tags WHERE id = ?').get(id);
      res.json(tag);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
      throw err;
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM template_tags WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  return router;
};
