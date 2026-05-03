function toStage(s) {
  let alarmMeta = null;
  if (s.alarm_meta) {
    try { alarmMeta = JSON.parse(s.alarm_meta); } catch { alarmMeta = null; }
  }
  return {
    id: s.id, name: s.name, color: s.color, sortOrder: s.sort_order, kind: s.kind,
    bot_id: s.bot_id || null,
    stale_hours: s.stale_hours || null, // legacy, mantenido por compat
    alarm_type: s.alarm_type || null,
    alarm_threshold_seconds: s.alarm_threshold_seconds || null,
    alarm_meta: alarmMeta,
  };
}
function toPipeline(p, stages) {
  return { id: p.id, name: p.name, color: p.color, icon: p.icon || null, sortOrder: p.sort_order, stages };
}

function listWithStages(db) {
  const pipelines = db.prepare('SELECT * FROM pipelines ORDER BY sort_order, id').all();
  const stages = db.prepare('SELECT * FROM stages ORDER BY pipeline_id, sort_order').all();
  return pipelines.map((p) =>
    toPipeline(p, stages.filter(s => s.pipeline_id === p.id).map(toStage))
  );
}

function create(db, { name, color = '#2563eb', icon = null }) {
  if (!name?.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare('INSERT INTO pipelines (name, color, icon) VALUES (?, ?, ?)').run(name.trim(), color, icon || null);
  return getById(db, r.lastInsertRowid);
}

function getById(db, id) {
  const p = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  if (!p) throw new Error('Pipeline no encontrado');
  const stages = db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort_order').all(id);
  return toPipeline(p, stages.map(toStage));
}

function update(db, id, { name, color, icon }) {
  const p = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(id);
  if (!p) throw new Error('Pipeline no encontrado');
  if (name !== undefined) name = name.trim();
  db.prepare('UPDATE pipelines SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon) WHERE id = ?')
    .run(name || null, color || null, icon !== undefined ? (icon || null) : null, id);
  return getById(db, id);
}

function reorderStages(db, pipelineId, orderedIds) {
  const stmt = db.prepare('UPDATE stages SET sort_order = ? WHERE id = ? AND pipeline_id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((stageId, idx) => stmt.run(idx, stageId, pipelineId));
  });
  trx();
}

function reorderPipelines(db, orderedIds) {
  const stmt = db.prepare('UPDATE pipelines SET sort_order = ? WHERE id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id));
  });
  trx();
}

function remove(db, id, advisor) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE pipeline_id = ?').get(id)?.n || 0;
  if (count > 0) throw new Error(`Este pipeline tiene ${count} expediente${count === 1 ? '' : 's'}. Muévelos a otro pipeline antes de eliminarlo.`);
  const p = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  if (!p) throw new Error('Pipeline no encontrado');
  const stages = db.prepare('SELECT * FROM stages WHERE pipeline_id = ? ORDER BY sort_order').all(id);
  const trash = require('../trash/service');
  trash.save(db, {
    entityType:    'pipeline',
    entityId:      id,
    entityName:    p.name,
    snapshot:      { ...p, stages },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  const r = db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
  if (!r.changes) throw new Error('Pipeline no encontrado');
}

// ── Stages ──
function createStage(db, pipelineId, { name, color = '#94a3b8', kind = 'in_progress' }) {
  if (!name?.trim()) throw new Error('El nombre es requerido');
  db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId)
    || (() => { throw new Error('Pipeline no encontrado'); })();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM stages WHERE pipeline_id = ?').get(pipelineId).n;
  const r = db.prepare(
    'INSERT INTO stages (pipeline_id, name, color, sort_order, kind) VALUES (?, ?, ?, ?, ?)'
  ).run(pipelineId, name.trim(), color, maxOrder, kind);
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(r.lastInsertRowid);
}

function updateStage(db, id, patch) {
  const s = db.prepare('SELECT * FROM stages WHERE id = ?').get(id);
  if (!s) throw new Error('Etapa no encontrada');
  const newName   = patch.name  !== undefined ? (patch.name.trim() || s.name) : s.name;
  const newColor  = patch.color !== undefined ? patch.color : s.color;
  const newKind   = patch.kind  !== undefined ? patch.kind  : s.kind;
  const newBotId  = 'bot_id' in patch ? (patch.bot_id ? Number(patch.bot_id) : null) : s.bot_id;
  const newStale  = 'stale_hours' in patch ? (patch.stale_hours ? Number(patch.stale_hours) : null) : s.stale_hours;
  const newAlarmType = 'alarm_type' in patch ? (patch.alarm_type || null) : s.alarm_type;
  const newAlarmThreshold = 'alarm_threshold_seconds' in patch
    ? (patch.alarm_threshold_seconds ? Number(patch.alarm_threshold_seconds) : null)
    : s.alarm_threshold_seconds;
  let newAlarmMeta = s.alarm_meta;
  if ('alarm_meta' in patch) {
    if (patch.alarm_meta == null) newAlarmMeta = null;
    else if (typeof patch.alarm_meta === 'string') newAlarmMeta = patch.alarm_meta;
    else newAlarmMeta = JSON.stringify(patch.alarm_meta);
  }
  db.prepare('UPDATE stages SET name=?, color=?, kind=?, bot_id=?, stale_hours=?, alarm_type=?, alarm_threshold_seconds=?, alarm_meta=? WHERE id=?')
    .run(newName, newColor, newKind, newBotId, newStale, newAlarmType, newAlarmThreshold, newAlarmMeta, id);
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(id);
}

function removeStage(db, id, advisor) {
  const s = db.prepare('SELECT * FROM stages WHERE id = ?').get(id);
  if (!s) throw new Error('Etapa no encontrada');
  const trash = require('../trash/service');
  trash.save(db, {
    entityType:    'stage',
    entityId:      id,
    entityName:    s.name,
    snapshot:      { ...s },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  const r = db.prepare('DELETE FROM stages WHERE id = ?').run(id);
  if (!r.changes) throw new Error('Etapa no encontrada');
}

module.exports = { listWithStages, create, getById, update, remove, createStage, updateStage, removeStage, reorderStages, reorderPipelines };
