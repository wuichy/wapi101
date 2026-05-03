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
  // Subir media para el HEADER de una plantilla (IMAGE/VIDEO/DOCUMENT).
  // Recibe { data: "<base64 con o sin prefijo data:>", mimetype: "image/jpeg" }.
  // Sube a Meta vía Resumable Upload y guarda el handle en la plantilla.
  r.post('/:id/header-media', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const tmpl = svc.getById(db, id);
      if (!tmpl) return res.status(404).json({ error: 'Plantilla no encontrada' });

      const { data, mimetype } = req.body || {};
      if (!data || !mimetype) return res.status(400).json({ error: 'data y mimetype requeridos' });

      const cleanB64 = String(data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'archivo vacío' });
      if (buffer.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'archivo demasiado grande (máx 5MB)' });

      const formatFromMime = mimetype.startsWith('image/') ? 'IMAGE'
                           : mimetype.startsWith('video/') ? 'VIDEO'
                           : 'DOCUMENT';

      const handle = await svc.uploadHeaderToMeta(db, buffer, mimetype);
      svc.update(db, id, { headerType: formatFromMime, headerMediaHandle: handle });

      res.json({ ok: true, handle, headerType: formatFromMime });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

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
