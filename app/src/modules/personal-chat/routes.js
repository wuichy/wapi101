// Capa personal del chat: cada asesor tiene su propia vista del CRM
// con conversaciones ocultas y etiquetas en contactos. NO afecta la vista
// del equipo en /lucho101.com.

const express = require('express');

module.exports = function personalChatRoutes(db) {
  const router = express.Router();

  // ─── Conversaciones ───
  // Lista las conversaciones aplicando el filtro personal de "ocultas".
  // Auto-unhide: si llegó un mensaje nuevo después de hidden_at, vuelve a aparecer.
  router.get('/conversations', (req, res) => {
    const advisorId = req.advisor.id;
    const showHidden = req.query.showHidden === '1';
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    let sql;
    if (showHidden) {
      sql = `
        SELECT c.*, ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
               ct.phone AS contact_phone, ct.email AS contact_email,
               pcs.hidden_at
          FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          JOIN personal_conversation_state pcs
            ON pcs.conversation_id = c.id AND pcs.advisor_id = ?
         WHERE c.tenant_id = ?
           AND c.last_message_at <= pcs.hidden_at
         ORDER BY c.last_message_at DESC
         LIMIT ?
      `;
    } else {
      sql = `
        SELECT c.*, ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
               ct.phone AS contact_phone, ct.email AS contact_email
          FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          LEFT JOIN personal_conversation_state pcs
            ON pcs.conversation_id = c.id AND pcs.advisor_id = ?
         WHERE c.tenant_id = ?
           AND (pcs.hidden_at IS NULL OR c.last_message_at > pcs.hidden_at)
         ORDER BY c.last_message_at DESC
         LIMIT ?
      `;
    }

    const rows = db.prepare(sql).all(advisorId, req.tenantId, limit);
    res.json({ items: rows });
  });

  router.post('/conversations/:id/hide', (req, res) => {
    const advisorId = req.advisor.id;
    const convoId = Number(req.params.id);
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?').get(convoId, req.tenantId);
    if (!exists) return res.status(404).json({ error: 'Conversación no encontrada' });
    db.prepare(`
      INSERT INTO personal_conversation_state (tenant_id, advisor_id, conversation_id, hidden_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(advisor_id, conversation_id) DO UPDATE SET hidden_at = excluded.hidden_at
    `).run(req.tenantId, advisorId, convoId);
    res.json({ ok: true });
  });

  router.post('/conversations/:id/unhide', (req, res) => {
    const advisorId = req.advisor.id;
    const convoId = Number(req.params.id);
    db.prepare(
      'DELETE FROM personal_conversation_state WHERE advisor_id = ? AND conversation_id = ? AND tenant_id = ?'
    ).run(advisorId, convoId, req.tenantId);
    res.json({ ok: true });
  });

  // ─── Etiquetas personales ───
  router.get('/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const items = db.prepare(`
      SELECT id, name, color, created_at
        FROM personal_tags
       WHERE advisor_id = ? AND tenant_id = ?
       ORDER BY name COLLATE NOCASE
    `).all(advisorId, req.tenantId);
    res.json({ items });
  });

  router.post('/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#94a3b8').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    if (name.length > 40) return res.status(400).json({ error: 'Nombre demasiado largo (máx 40)' });
    try {
      const r = db.prepare(
        'INSERT INTO personal_tags (tenant_id, advisor_id, name, color) VALUES (?, ?, ?, ?)'
      ).run(req.tenantId, advisorId, name, color);
      const tag = db.prepare(
        'SELECT id, name, color, created_at FROM personal_tags WHERE id = ?'
      ).get(r.lastInsertRowid);
      res.json(tag);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Ya tienes una etiqueta con ese nombre' });
      }
      throw err;
    }
  });

  router.put('/tags/:id', (req, res) => {
    const advisorId = req.advisor.id;
    const tagId = Number(req.params.id);
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#94a3b8').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const existing = db.prepare(
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ? AND tenant_id = ?'
    ).get(tagId, advisorId, req.tenantId);
    if (!existing) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    try {
      db.prepare(
        'UPDATE personal_tags SET name = ?, color = ? WHERE id = ? AND tenant_id = ?'
      ).run(name, color, tagId, req.tenantId);
      const tag = db.prepare(
        'SELECT id, name, color, created_at FROM personal_tags WHERE id = ?'
      ).get(tagId);
      res.json(tag);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        return res.status(409).json({ error: 'Ya tienes una etiqueta con ese nombre' });
      }
      throw err;
    }
  });

  router.delete('/tags/:id', (req, res) => {
    const advisorId = req.advisor.id;
    const tagId = Number(req.params.id);
    db.prepare(
      'DELETE FROM personal_tags WHERE id = ? AND advisor_id = ? AND tenant_id = ?'
    ).run(tagId, advisorId, req.tenantId);
    res.json({ ok: true });
  });

  router.get('/contacts/:id/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const items = db.prepare(`
      SELECT pt.id, pt.name, pt.color
        FROM personal_contact_tags pct
        JOIN personal_tags pt ON pt.id = pct.tag_id
       WHERE pct.advisor_id = ? AND pct.contact_id = ? AND pct.tenant_id = ?
       ORDER BY pt.name COLLATE NOCASE
    `).all(advisorId, contactId, req.tenantId);
    res.json({ items });
  });

  router.post('/contacts/:id/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const tagId = Number(req.body?.tagId);
    if (!tagId) return res.status(400).json({ error: 'tagId requerido' });
    const ownsTag = db.prepare(
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ? AND tenant_id = ?'
    ).get(tagId, advisorId, req.tenantId);
    if (!ownsTag) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const exists = db.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, req.tenantId);
    if (!exists) return res.status(404).json({ error: 'Contacto no encontrado' });
    db.prepare(`
      INSERT OR IGNORE INTO personal_contact_tags (tenant_id, advisor_id, contact_id, tag_id)
      VALUES (?, ?, ?, ?)
    `).run(req.tenantId, advisorId, contactId, tagId);
    res.json({ ok: true });
  });

  router.delete('/contacts/:id/tags/:tagId', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const tagId = Number(req.params.tagId);
    db.prepare(`
      DELETE FROM personal_contact_tags
       WHERE advisor_id = ? AND contact_id = ? AND tag_id = ? AND tenant_id = ?
    `).run(advisorId, contactId, tagId, req.tenantId);
    res.json({ ok: true });
  });

  router.get('/contacts-by-tag/:tagId', (req, res) => {
    const advisorId = req.advisor.id;
    const tagId = Number(req.params.tagId);
    const ownsTag = db.prepare(
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ? AND tenant_id = ?'
    ).get(tagId, advisorId, req.tenantId);
    if (!ownsTag) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const items = db.prepare(`
      SELECT c.id, c.first_name, c.last_name, c.phone, c.email
        FROM personal_contact_tags pct
        JOIN contacts c ON c.id = pct.contact_id
       WHERE pct.advisor_id = ? AND pct.tag_id = ? AND pct.tenant_id = ?
       ORDER BY c.first_name, c.last_name
    `).all(advisorId, tagId, req.tenantId);
    res.json({ items });
  });

  return router;
};
