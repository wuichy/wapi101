function tagsFor(db, botId) {
  return db.prepare(`
    SELECT t.id, t.name, t.color
    FROM bot_tags t
    JOIN salsbot_tag_assignments a ON a.tag_id = t.id
    WHERE a.bot_id = ?
    ORDER BY t.name COLLATE NOCASE
  `).all(botId);
}

function setTags(db, botId, tagIds) {
  const ids = Array.isArray(tagIds) ? [...new Set(tagIds.map(Number).filter(n => Number.isFinite(n)))] : null;
  if (ids === null) return;
  db.prepare('DELETE FROM salsbot_tag_assignments WHERE bot_id = ?').run(botId);
  const ins = db.prepare('INSERT OR IGNORE INTO salsbot_tag_assignments (bot_id, tag_id) VALUES (?, ?)');
  const txn = db.transaction((arr) => arr.forEach(tid => ins.run(botId, tid)));
  txn(ids);
}

function hydrate(db, row) {
  return {
    ...row,
    enabled: !!row.enabled,
    steps: JSON.parse(row.steps || '[]'),
    tags: tagsFor(db, row.id),
  };
}

function list(db) {
  return db.prepare('SELECT * FROM salsbots ORDER BY created_at DESC').all().map(r => hydrate(db, r));
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM salsbots WHERE id = ?').get(id);
  if (!row) throw new Error('Salesbot no encontrado');
  return hydrate(db, row);
}

function create(db, { name, enabled = 0, trigger_type = 'keyword', trigger_value = '', steps = [], tagIds }) {
  if (!name || !name.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare(
    'INSERT INTO salsbots (name, enabled, trigger_type, trigger_value, steps) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), enabled ? 1 : 0, trigger_type, trigger_value || '', JSON.stringify(steps));
  setTags(db, r.lastInsertRowid, tagIds);
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
  if (Array.isArray(patch.tagIds)) setTags(db, id, patch.tagIds);
  return getById(db, id);
}

function remove(db, id, { deletedBy } = {}) {
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
