// Registro de actividad por expediente — inserta y consulta expedient_activity.

function log(db, { expedientId, contactId, type, description, metadata, advisorId, advisorName } = {}) {
  if (!expedientId || !type || !description) return;
  try {
    db.prepare(`
      INSERT INTO expedient_activity (expedient_id, contact_id, type, description, metadata, advisor_id, advisor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      expedientId,
      contactId   || null,
      type,
      description,
      metadata != null ? JSON.stringify(metadata) : null,
      advisorId   || null,
      advisorName || null,
    );
  } catch (e) {
    console.error('[activity] error registrando:', e.message);
  }
}

function list(db, expedientId, { limit = 300 } = {}) {
  return db.prepare(`
    SELECT * FROM expedient_activity
    WHERE expedient_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(expedientId, limit);
}

module.exports = { log, list };
