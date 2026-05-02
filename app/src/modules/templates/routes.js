const { Router } = require('express');
const svc = require('./service');

module.exports = function templatesRoutes(db) {
  const r = Router();

  r.get('/', (req, res) => {
    try {
      const { type } = req.query;
      res.json(svc.list(db, { type }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/:id', (req, res) => {
    const tmpl = svc.getById(db, Number(req.params.id));
    if (!tmpl) return res.status(404).json({ error: 'No encontrada' });
    res.json(tmpl);
  });

  r.post('/', (req, res) => {
    try {
      const tmpl = svc.create(db, req.body);
      res.status(201).json(tmpl);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.put('/:id', (req, res) => {
    try {
      const tmpl = svc.update(db, Number(req.params.id), req.body);
      if (!tmpl) return res.status(404).json({ error: 'No encontrada' });
      res.json(tmpl);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/:id', (req, res) => {
    const ok = svc.remove(db, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  });

  // Submit WA API template to Meta for approval
  r.post('/:id/submit', async (req, res) => {
    try {
      const result = await svc.submitToMeta(db, Number(req.params.id));
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Sync approval status from Meta
  r.post('/:id/sync', async (req, res) => {
    try {
      const result = await svc.syncFromMeta(db, Number(req.params.id));
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // Sync all pending templates
  r.post('/sync-all', async (req, res) => {
    try {
      const results = await svc.syncAll(db);
      res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
};
