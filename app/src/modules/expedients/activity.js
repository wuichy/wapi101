// Registro de actividad por expediente — inserta y consulta expedient_activity.
//
// Diseño multi-tenant: para no romper callers (bot/engine, bot/routes, etc.)
// que no tienen `tenantId` a la mano, derivamos el tenant_id del expediente
// al que pertenece la actividad. Así la firma de log() queda igual.

function log(db, { expedientId, contactId, type, description, metadata, advisorId, advisorName } = {}) {
  if (!expedientId || !type || !description) return;
  try {
    // Resolver tenant del expediente. Si el expediente fue borrado o no existe,
    // no registramos la actividad (no tendría dueño claro).
    const exp = db.prepare('SELECT tenant_id FROM expedients WHERE id = ?').get(expedientId);
    if (!exp) return;
    db.prepare(`
      INSERT INTO expedient_activity (tenant_id, expedient_id, contact_id, type, description, metadata, advisor_id, advisor_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      exp.tenant_id,
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

function list(db, tenantId, expedientId, { limit = 300 } = {}) {
  return db.prepare(`
    SELECT * FROM expedient_activity
    WHERE expedient_id = ? AND tenant_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `).all(expedientId, tenantId, limit);
}

module.exports = { log, list };
