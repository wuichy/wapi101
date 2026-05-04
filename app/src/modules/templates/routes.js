const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const svc = require('./service');

module.exports = function templatesRoutes(db) {
  const r = Router();
  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
  const tplMediaDir = path.join(uploadsDir, 'template-media');
  if (!fs.existsSync(tplMediaDir)) fs.mkdirSync(tplMediaDir, { recursive: true });
  const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/$/, '');

  r.get('/', (req, res) => {
    try {
      const { type } = req.query;
      res.json(svc.list(db, req.tenantId, { type }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/:id', (req, res) => {
    const tmpl = svc.getById(db, req.tenantId, Number(req.params.id));
    if (!tmpl) return res.status(404).json({ error: 'No encontrada' });
    res.json(tmpl);
  });

  r.post('/reorder', (req, res) => {
    try {
      const orderedIds = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds : null;
      if (!orderedIds) return res.status(400).json({ error: 'orderedIds requerido (array)' });
      svc.reorder(db, req.tenantId, orderedIds);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.post('/', (req, res) => {
    try {
      const tmpl = svc.create(db, req.tenantId, req.body);
      res.status(201).json(tmpl);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.put('/:id', (req, res) => {
    try {
      const tmpl = svc.update(db, req.tenantId, Number(req.params.id), req.body);
      if (!tmpl) return res.status(404).json({ error: 'No encontrada' });
      res.json(tmpl);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.delete('/:id', (req, res) => {
    const ok = svc.remove(db, req.tenantId, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'No encontrada' });
    res.json({ ok: true });
  });

  const TPL_MEDIA_RULES = {
    'image/jpeg':        { format: 'IMAGE',    maxBytes: 5  * 1024 * 1024 },
    'image/png':         { format: 'IMAGE',    maxBytes: 5  * 1024 * 1024 },
    'video/mp4':         { format: 'VIDEO',    maxBytes: 16 * 1024 * 1024 },
    'video/3gpp':        { format: 'VIDEO',    maxBytes: 16 * 1024 * 1024 },
    'application/pdf':   { format: 'DOCUMENT', maxBytes: 100 * 1024 * 1024 },
  };

  r.post('/:id/header-media', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const tmpl = svc.getById(db, req.tenantId, id);
      if (!tmpl) return res.status(404).json({ error: 'Plantilla no encontrada' });

      const { data, mimetype } = req.body || {};
      if (!data || !mimetype) return res.status(400).json({ error: 'data y mimetype requeridos' });

      const rule = TPL_MEDIA_RULES[mimetype];
      if (!rule) {
        return res.status(400).json({
          error: `Formato no aceptado por Meta: ${mimetype}. Usa JPEG/PNG (imagen), MP4/3GPP (video) o PDF (documento).`,
        });
      }

      const cleanB64 = String(data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'archivo vacío' });
      if (buffer.length > rule.maxBytes) {
        const maxMb = (rule.maxBytes / 1024 / 1024).toFixed(0);
        const myMb  = (buffer.length / 1024 / 1024).toFixed(1);
        return res.status(400).json({
          error: `Archivo de ${myMb}MB excede el máximo para ${rule.format} (${maxMb}MB).`,
        });
      }

      const ext = mimetype === 'image/jpeg' ? 'jpg'
                : mimetype === 'image/png'  ? 'png'
                : mimetype === 'video/mp4'  ? 'mp4'
                : mimetype === 'video/3gpp' ? '3gp'
                : 'pdf';
      const filename = `tpl-${id}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(tplMediaDir, filename), buffer);
      const publicUrl = `${APP_BASE_URL}/uploads/template-media/${filename}`;

      const handle = await svc.uploadHeaderToMeta(db, req.tenantId, buffer, mimetype);
      svc.update(db, req.tenantId, id, {
        headerType: rule.format,
        headerMediaHandle: handle,
        headerMediaUrl: publicUrl,
      });

      res.json({ ok: true, handle, headerType: rule.format, headerMediaUrl: publicUrl });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  r.post('/:id/submit', async (req, res) => {
    try {
      const result = await svc.submitToMeta(db, req.tenantId, Number(req.params.id));
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.post('/:id/sync', async (req, res) => {
    try {
      const result = await svc.syncFromMeta(db, req.tenantId, Number(req.params.id));
      res.json(result);
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  r.put('/:id/tags', (req, res) => {
    const id = Number(req.params.id);
    const tmpl = svc.getById(db, req.tenantId, id);
    if (!tmpl) return res.status(404).json({ error: 'Plantilla no encontrada' });
    const tagIds = Array.isArray(req.body?.tagIds) ? req.body.tagIds : [];
    svc.setTags(db, req.tenantId, id, tagIds);
    res.json(svc.getById(db, req.tenantId, id));
  });

  r.post('/sync-all', async (req, res) => {
    try {
      const results = await svc.syncAll(db, req.tenantId);
      res.json(results);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return r;
};
