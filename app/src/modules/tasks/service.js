// Servicio de tasks (recordatorios) — multi-tenant.
// Todas las funciones reciben tenantId como 2do argumento.

const BASE_SELECT = `
  SELECT t.*,
    a_assigned.name AS assigned_advisor_name,
    a_creator.name  AS created_by_advisor_name,
    e.name          AS expedient_name,
    (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name
  FROM tasks t
  LEFT JOIN advisors    a_assigned ON a_assigned.id = t.assigned_advisor_id
  LEFT JOIN advisors    a_creator  ON a_creator.id  = t.created_by_advisor_id
  LEFT JOIN expedients  e          ON e.id          = t.expedient_id
  LEFT JOIN contacts    c          ON c.id          = t.contact_id
`;

function _hydrate(row) {
  if (!row) return null;
  return {
    id:              row.id,
    title:           row.title,
    description:     row.description || null,
    dueAt:           row.due_at,
    durationMinutes: row.duration_minutes || null,
    assignedAdvisorId:   row.assigned_advisor_id,
    assignedAdvisorName: row.assigned_advisor_name || null,
    expedientId:     row.expedient_id,
    expedientName:   row.expedient_name || null,
    contactId:       row.contact_id,
    contactName:     row.contact_name || null,
    completed:       !!row.completed,
    completedAt:     row.completed_at,
    createdByAdvisorId:   row.created_by_advisor_id,
    createdByAdvisorName: row.created_by_advisor_name || null,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

// Devuelve la tarea conflictiva si [dueAt, dueAt+dur] se solapa con otra del mismo asesor.
function _checkConflict(db, tenantId, advisorId, dueAt, durationMinutes, excludeId = 0) {
  if (!advisorId || !durationMinutes || !dueAt) return null;
  const endAt = dueAt + durationMinutes * 60;
  return db.prepare(`
    SELECT id, title, due_at, duration_minutes FROM tasks
    WHERE tenant_id = ? AND assigned_advisor_id = ? AND id != ?
      AND completed = 0
      AND duration_minutes IS NOT NULL AND duration_minutes > 0
      AND due_at < ? AND (due_at + duration_minutes * 60) > ?
    LIMIT 1
  `).get(tenantId, advisorId, excludeId, endAt, dueAt);
}

// Lista con filtros opcionales:
//   filter: 'all' | 'pending' | 'completed' | 'overdue' | 'today' | 'upcoming'
//   advisorId: filtrar por asignado (opcional)
//   expedientId / contactId: filtrar por vinculación
function list(db, tenantId, { filter = 'pending', advisorId = null, expedientId = null, contactId = null, limit = 200 } = {}) {
  const conds = ['t.tenant_id = ?'];
  const params = [tenantId];

  const now = Math.floor(Date.now() / 1000);
  const startOfToday = Math.floor(new Date(new Date().setHours(0,0,0,0)).getTime() / 1000);
  const endOfToday   = Math.floor(new Date(new Date().setHours(23,59,59,999)).getTime() / 1000);

  switch (filter) {
    case 'overdue':   conds.push('t.completed = 0 AND t.due_at < ?'); params.push(now); break;
    case 'today':     conds.push('t.completed = 0 AND t.due_at BETWEEN ? AND ?'); params.push(startOfToday, endOfToday); break;
    case 'upcoming':  conds.push('t.completed = 0 AND t.due_at > ?'); params.push(endOfToday); break;
    case 'pending':   conds.push('t.completed = 0'); break;
    case 'completed': conds.push('t.completed = 1'); break;
    case 'all':       break;
  }

  if (advisorId)    { conds.push('t.assigned_advisor_id = ?'); params.push(advisorId); }
  if (expedientId)  { conds.push('t.expedient_id = ?'); params.push(expedientId); }
  if (contactId)    { conds.push('t.contact_id = ?'); params.push(contactId); }

  const sql = BASE_SELECT + ` WHERE ${conds.join(' AND ')} ORDER BY t.due_at ASC, t.id ASC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params).map(_hydrate);
}

function getById(db, tenantId, id) {
  const row = db.prepare(BASE_SELECT + ' WHERE t.id = ? AND t.tenant_id = ?').get(id, tenantId);
  return _hydrate(row);
}

function create(db, tenantId, { title, description, dueAt, durationMinutes, assignedAdvisorId, expedientId, contactId, createdByAdvisorId }) {
  if (!title || !title.trim()) throw new Error('El título es requerido');
  if (!dueAt) throw new Error('La fecha de vencimiento es requerida');
  const dur = durationMinutes ? Number(durationMinutes) : null;
  const conflict = _checkConflict(db, tenantId, assignedAdvisorId, Number(dueAt), dur);
  if (conflict) {
    const t = new Date(conflict.due_at * 1000);
    const fmt = t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const end = new Date((conflict.due_at + conflict.duration_minutes * 60) * 1000);
    const fmtEnd = end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const err = new Error(`Conflicto con "${conflict.title}" (${fmt}–${fmtEnd})`);
    err.statusCode = 409;
    throw err;
  }
  const r = db.prepare(`
    INSERT INTO tasks (tenant_id, title, description, due_at, duration_minutes, assigned_advisor_id, expedient_id, contact_id, created_by_advisor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tenantId, title.trim(), description?.trim() || null, Number(dueAt), dur, assignedAdvisorId || null, expedientId || null, contactId || null, createdByAdvisorId || null);
  return getById(db, tenantId, r.lastInsertRowid);
}

function update(db, tenantId, id, patch = {}) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Tarea no encontrada');

  const fields = [];
  const params = [];
  if (patch.title !== undefined) {
    if (!patch.title || !patch.title.trim()) throw new Error('El título no puede estar vacío');
    fields.push('title = ?'); params.push(patch.title.trim());
  }
  if (patch.description !== undefined) { fields.push('description = ?'); params.push(patch.description?.trim() || null); }
  if (patch.dueAt !== undefined) { fields.push('due_at = ?'); params.push(Number(patch.dueAt)); }
  if (patch.durationMinutes !== undefined) { fields.push('duration_minutes = ?'); params.push(patch.durationMinutes ? Number(patch.durationMinutes) : null); }
  if (patch.assignedAdvisorId !== undefined) { fields.push('assigned_advisor_id = ?'); params.push(patch.assignedAdvisorId || null); }

  // Conflict check using patched values
  const effectiveDueAt       = patch.dueAt !== undefined ? Number(patch.dueAt) : row.due_at;
  const effectiveDuration    = patch.durationMinutes !== undefined ? (patch.durationMinutes ? Number(patch.durationMinutes) : null) : row.duration_minutes;
  const effectiveAdvisorId   = patch.assignedAdvisorId !== undefined ? (patch.assignedAdvisorId || null) : row.assigned_advisor_id;
  const conflict = _checkConflict(db, tenantId, effectiveAdvisorId, effectiveDueAt, effectiveDuration, id);
  if (conflict) {
    const t = new Date(conflict.due_at * 1000);
    const fmt = t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const end = new Date((conflict.due_at + conflict.duration_minutes * 60) * 1000);
    const fmtEnd = end.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
    const err = new Error(`Conflicto con "${conflict.title}" (${fmt}–${fmtEnd})`);
    err.statusCode = 409;
    throw err;
  }
  if (patch.expedientId !== undefined) { fields.push('expedient_id = ?'); params.push(patch.expedientId || null); }
  if (patch.contactId !== undefined) { fields.push('contact_id = ?'); params.push(patch.contactId || null); }
  if (patch.completed !== undefined) {
    const done = patch.completed ? 1 : 0;
    fields.push('completed = ?'); params.push(done);
    fields.push('completed_at = ?'); params.push(done ? Math.floor(Date.now() / 1000) : null);
  }

  if (!fields.length) return getById(db, tenantId, id);
  fields.push('updated_at = unixepoch()');
  params.push(id, tenantId);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
  return getById(db, tenantId, id);
}

function remove(db, tenantId, id) {
  db.prepare('DELETE FROM tasks WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// Conteo rápido de tareas no completadas por expedient_id — usado para
// pintar iconos verde/rojo en cards de pipeline (S2 pendiente).
// Devuelve un Map: expedient_id → { pending, overdue }
function countByExpedients(db, tenantId, expedientIds) {
  if (!expedientIds || !expedientIds.length) return new Map();
  const placeholders = expedientIds.map(() => '?').join(',');
  const now = Math.floor(Date.now() / 1000);
  const rows = db.prepare(`
    SELECT expedient_id,
           SUM(CASE WHEN completed = 0 THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN completed = 0 AND due_at < ? THEN 1 ELSE 0 END) AS overdue
      FROM tasks
     WHERE tenant_id = ? AND expedient_id IN (${placeholders})
     GROUP BY expedient_id
  `).all(now, tenantId, ...expedientIds);
  const map = new Map();
  for (const r of rows) {
    map.set(r.expedient_id, { pending: r.pending || 0, overdue: r.overdue || 0 });
  }
  return map;
}

module.exports = { list, getById, create, update, remove, countByExpedients };
