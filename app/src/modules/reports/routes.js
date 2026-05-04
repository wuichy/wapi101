const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function reportsRoutes(db) {
  const router = express.Router();

  const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
  const reportsDir = path.join(uploadsDir, 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  function hydrate(row) {
    if (!row) return null;
    let attachments = [];
    try { attachments = JSON.parse(row.attachments || '[]'); } catch {}
    return {
      id: row.id,
      advisorId: row.advisor_id,
      advisorName: row.advisor_name,
      type: row.type,
      priority: row.priority,
      title: row.title,
      body: row.body,
      attachments,
      status: row.status,
      adminResponse: row.admin_response,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  // GET /api/reports — listar (admin del tenant ve todos del tenant, asesor solo los suyos)
  router.get('/', (req, res) => {
    const advisor = req.advisor;
    const isAdmin = advisor?.role === 'admin';
    const status = req.query.status;
    const conditions = ['tenant_id = ?'];
    const params = [req.tenantId];
    if (!isAdmin) {
      conditions.push('advisor_id = ?');
      params.push(advisor?.id || 0);
    }
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = db.prepare(`SELECT * FROM reports ${where} ORDER BY created_at DESC LIMIT 200`).all(...params);
    res.json({ items: rows.map(hydrate) });
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM reports WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), req.tenantId);
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    if (req.advisor?.role !== 'admin' && row.advisor_id !== req.advisor?.id) {
      return res.status(403).json({ error: 'Sin acceso a este reporte' });
    }
    res.json({ item: hydrate(row) });
  });

  // POST /api/reports — crear nuevo
  // body: { type, priority, title, body, attachments: [{ data: base64, mimetype, filename }] }
  router.post('/', (req, res) => {
    const advisor = req.advisor;
    const { type, priority, title, body, attachments } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'Título requerido' });

    // Guardar adjuntos localmente
    const savedUrls = [];
    if (Array.isArray(attachments)) {
      for (const att of attachments) {
        try {
          const cleanB64 = String(att.data || '').replace(/^data:[^;]+;base64,/, '');
          const buffer = Buffer.from(cleanB64, 'base64');
          if (!buffer.length) continue;
          if (buffer.length > 50 * 1024 * 1024) continue; // skip > 50MB
          const ext = (att.filename || '').match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]
                   || att.mimetype?.split('/')[1]?.split(';')[0]
                   || 'bin';
          const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 6);
          const filename = `r-${Date.now()}-${Math.random().toString(36).slice(2,8)}.${safeExt}`;
          fs.writeFileSync(path.join(reportsDir, filename), buffer);
          savedUrls.push({
            url: `/uploads/reports/${filename}`,
            mimetype: att.mimetype,
            filename: att.filename,
            size: buffer.length,
          });
        } catch (err) {
          console.error('[reports] error guardando adjunto:', err.message);
        }
      }
    }

    const r = db.prepare(`
      INSERT INTO reports (tenant_id, advisor_id, advisor_name, type, priority, title, body, attachments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.tenantId,
      advisor?.id || null,
      advisor?.name || null,
      ['bug', 'design', 'suggestion', 'question'].includes(type) ? type : 'bug',
      ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
      title.trim(),
      body || null,
      JSON.stringify(savedUrls),
    );
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ item: hydrate(row) });
  });

  router.patch('/:id', (req, res) => {
    if (req.advisor?.role !== 'admin') return res.status(403).json({ error: 'Solo admin' });
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT id FROM reports WHERE id = ? AND tenant_id = ?').get(id, req.tenantId);
    if (!existing) return res.status(404).json({ error: 'No encontrado' });
    const { status, adminResponse } = req.body || {};
    const fields = [];
    const params = [];
    if (status && ['open', 'in_progress', 'resolved', 'wontfix'].includes(status)) {
      fields.push('status = ?'); params.push(status);
      if (status === 'resolved' || status === 'wontfix') {
        fields.push('resolved_at = unixepoch()');
      }
    }
    if (adminResponse !== undefined) {
      fields.push('admin_response = ?'); params.push(adminResponse || null);
    }
    if (!fields.length) return res.status(400).json({ error: 'Sin cambios' });
    params.push(id, req.tenantId);
    db.prepare(`UPDATE reports SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
    const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    res.json({ item: hydrate(row) });
  });

  return router;
};
