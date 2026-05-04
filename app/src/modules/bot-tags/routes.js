const express = require('express');

module.exports = function botTagsRoutes(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const items = db.prepare('SELECT id, name, color, created_at FROM bot_tags WHERE tenant_id = ? ORDER BY name COLLATE NOCASE').all(req.tenantId);
    res.json({ items });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#94a3b8').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    // Verificar duplicado dentro del tenant (UNIQUE existente es global —
    // hasta que se haga UNIQUE(tenant_id, name) en migration futura, esto
    // protege a nivel de aplicación).
    const dupe = db.prepare('SELECT id FROM bot_tags WHERE tenant_id = ? AND name = ? COLLATE NOCASE').get(req.tenantId, name);
    if (dupe) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
    try {
      const r = db.prepare('INSERT INTO bot_tags (tenant_id, name, color) VALUES (?, ?, ?)').run(req.tenantId, name, color);
      const tag = db.prepare('SELECT id, name, color, created_at FROM bot_tags WHERE id = ?').get(r.lastInsertRowid);
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
    const existing = db.prepare('SELECT id FROM bot_tags WHERE id = ? AND tenant_id = ?').get(id, req.tenantId);
    if (!existing) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const dupe = db.prepare('SELECT id FROM bot_tags WHERE tenant_id = ? AND name = ? COLLATE NOCASE AND id <> ?').get(req.tenantId, name, id);
    if (dupe) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
    try {
      db.prepare('UPDATE bot_tags SET name = ?, color = ? WHERE id = ? AND tenant_id = ?').run(name, color, id, req.tenantId);
      const tag = db.prepare('SELECT id, name, color, created_at FROM bot_tags WHERE id = ?').get(id);
      res.json(tag);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe una etiqueta con ese nombre' });
      throw err;
    }
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM bot_tags WHERE id = ? AND tenant_id = ?').run(id, req.tenantId);
    res.json({ ok: true });
  });

  return router;
};
