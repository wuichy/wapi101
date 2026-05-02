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
      // Solo las ocultas (las que el asesor escogió esconder y NO han recibido
      // mensaje nuevo después).
      sql = `
        SELECT c.*, ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
               ct.phone AS contact_phone, ct.email AS contact_email,
               pcs.hidden_at
          FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          JOIN personal_conversation_state pcs
            ON pcs.conversation_id = c.id AND pcs.advisor_id = ?
         WHERE c.last_message_at <= pcs.hidden_at
         ORDER BY c.last_message_at DESC
         LIMIT ?
      `;
    } else {
      // Todas excepto las ocultas vigentes.
      sql = `
        SELECT c.*, ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
               ct.phone AS contact_phone, ct.email AS contact_email
          FROM conversations c
          JOIN contacts ct ON ct.id = c.contact_id
          LEFT JOIN personal_conversation_state pcs
            ON pcs.conversation_id = c.id AND pcs.advisor_id = ?
         WHERE pcs.hidden_at IS NULL
            OR c.last_message_at > pcs.hidden_at
         ORDER BY c.last_message_at DESC
         LIMIT ?
      `;
    }

    const rows = db.prepare(sql).all(advisorId, limit);
    res.json({ items: rows });
  });

  // Ocultar una conversación
  router.post('/conversations/:id/hide', (req, res) => {
    const advisorId = req.advisor.id;
    const convoId = Number(req.params.id);
    const exists = db.prepare('SELECT id FROM conversations WHERE id = ?').get(convoId);
    if (!exists) return res.status(404).json({ error: 'Conversación no encontrada' });
    db.prepare(`
      INSERT INTO personal_conversation_state (advisor_id, conversation_id, hidden_at)
      VALUES (?, ?, unixepoch())
      ON CONFLICT(advisor_id, conversation_id) DO UPDATE SET hidden_at = excluded.hidden_at
    `).run(advisorId, convoId);
    res.json({ ok: true });
  });

  // Desocultar manualmente
  router.post('/conversations/:id/unhide', (req, res) => {
    const advisorId = req.advisor.id;
    const convoId = Number(req.params.id);
    db.prepare(
      'DELETE FROM personal_conversation_state WHERE advisor_id = ? AND conversation_id = ?'
    ).run(advisorId, convoId);
    res.json({ ok: true });
  });

  // ─── Etiquetas personales ───
  router.get('/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const items = db.prepare(`
      SELECT id, name, color, created_at
        FROM personal_tags
       WHERE advisor_id = ?
       ORDER BY name COLLATE NOCASE
    `).all(advisorId);
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
        'INSERT INTO personal_tags (advisor_id, name, color) VALUES (?, ?, ?)'
      ).run(advisorId, name, color);
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
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ?'
    ).get(tagId, advisorId);
    if (!existing) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    try {
      db.prepare(
        'UPDATE personal_tags SET name = ?, color = ? WHERE id = ?'
      ).run(name, color, tagId);
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
      'DELETE FROM personal_tags WHERE id = ? AND advisor_id = ?'
    ).run(tagId, advisorId);
    res.json({ ok: true });
  });

  // ─── Etiquetas asignadas a contactos ───
  router.get('/contacts/:id/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const items = db.prepare(`
      SELECT pt.id, pt.name, pt.color
        FROM personal_contact_tags pct
        JOIN personal_tags pt ON pt.id = pct.tag_id
       WHERE pct.advisor_id = ? AND pct.contact_id = ?
       ORDER BY pt.name COLLATE NOCASE
    `).all(advisorId, contactId);
    res.json({ items });
  });

  router.post('/contacts/:id/tags', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const tagId = Number(req.body?.tagId);
    if (!tagId) return res.status(400).json({ error: 'tagId requerido' });
    // Verificar que la etiqueta pertenezca al asesor (anti-cross-tenant)
    const ownsTag = db.prepare(
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ?'
    ).get(tagId, advisorId);
    if (!ownsTag) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const exists = db.prepare('SELECT id FROM contacts WHERE id = ?').get(contactId);
    if (!exists) return res.status(404).json({ error: 'Contacto no encontrado' });
    db.prepare(`
      INSERT OR IGNORE INTO personal_contact_tags (advisor_id, contact_id, tag_id)
      VALUES (?, ?, ?)
    `).run(advisorId, contactId, tagId);
    res.json({ ok: true });
  });

  router.delete('/contacts/:id/tags/:tagId', (req, res) => {
    const advisorId = req.advisor.id;
    const contactId = Number(req.params.id);
    const tagId = Number(req.params.tagId);
    db.prepare(`
      DELETE FROM personal_contact_tags
       WHERE advisor_id = ? AND contact_id = ? AND tag_id = ?
    `).run(advisorId, contactId, tagId);
    res.json({ ok: true });
  });

  // ─── Filtrar contactos por una de mis etiquetas ───
  router.get('/contacts-by-tag/:tagId', (req, res) => {
    const advisorId = req.advisor.id;
    const tagId = Number(req.params.tagId);
    const ownsTag = db.prepare(
      'SELECT id FROM personal_tags WHERE id = ? AND advisor_id = ?'
    ).get(tagId, advisorId);
    if (!ownsTag) return res.status(404).json({ error: 'Etiqueta no encontrada' });
    const items = db.prepare(`
      SELECT c.id, c.first_name, c.last_name, c.phone, c.email
        FROM personal_contact_tags pct
        JOIN contacts c ON c.id = pct.contact_id
       WHERE pct.advisor_id = ? AND pct.tag_id = ?
       ORDER BY c.first_name, c.last_name
    `).all(advisorId, tagId);
    res.json({ items });
  });

  return router;
};
