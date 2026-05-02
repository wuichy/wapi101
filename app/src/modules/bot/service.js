function hydrate(row) {
  return {
    ...row,
    enabled: !!row.enabled,
    steps: JSON.parse(row.steps || '[]'),
  };
}

function list(db) {
  return db.prepare('SELECT * FROM salsbots ORDER BY created_at DESC').all().map(hydrate);
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id);
  if (!row) throw new Error('Salesbot no encontrado');
  return hydrate(row);
}

function create(db, { name, enabled = 0, trigger_type = 'keyword', trigger_value = '', steps = [] }) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare(
    'INSERT INTO salsbots (name, enabled, trigger_type, trigger_value, steps) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), enabled ? 1 : 0, trigger_type, trigger_value || '', JSON.stringify(steps));
  return getById(db, r.lastInsertRowid);
}

function update(db, id, patch) {
  const current = getById(db, id);
  const next = { ...current, ...patch };
  db.prepare(
    'UPDATE salsbots SET name=?, enabled=?, trigger_type=?, trigger_value=?, steps=?, updated_at=unixepoch() WHERE id=?'
  ).run(
    (next.name || '').trim() || current.name,
    next.enabled ? 1 : 0,
    next.trigger_type || current.trigger_type,
    next.trigger_value ?? current.trigger_value,
    JSON.stringify(Array.isArray(next.steps) ? next.steps : current.steps),
    id
  );
  return getById(db, id);
}

function remove(db, id, { deletedBy } = {}) {
  // Guardar snapshot en papelera antes de borrar (recuperable 30 días)
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id);
  if (!row) throw new Error('Salesbot no encontrado');

  try {
    const trashSvc = require('../trash/service');
    trashSvc.save(db, {
      entityType: 'salsbot',
      entityId:   row.id,
      entityName: row.name,
      snapshot:   row,
      deletedById:   deletedBy?.id   || null,
      deletedByName: deletedBy?.name || null,
    });
  } catch (err) {
    console.warn('[bot/remove] no se pudo enviar a papelera:', err.message);
  }

  db.prepare('DELETE FROM salsbots WHERE id = ?').run(id);
}

module.exports = { list, getById, create, update, remove };
