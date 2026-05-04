function toStage(s) {
  let alarmMeta = null;
  if (s.alarm_meta) {
    try { alarmMeta = JSON.parse(s.alarm_meta); } catch { alarmMeta = null; }
  }
  // Multi-alarmas: el array se guarda en alarms_json. Si está vacío y hay
  // single-alarm legacy en alarm_type, sintetizamos un array de 1 elemento
  // para que el frontend pueda tratar todo de forma uniforme.
  let alarms = [];
  if (s.alarms_json) {
    try {
      const parsed = JSON.parse(s.alarms_json);
      if (Array.isArray(parsed)) alarms = parsed;
    } catch { alarms = []; }
  }
  if (!alarms.length && s.alarm_type) {
    alarms = [{
      id: 'a1',
      type: s.alarm_type,
      threshold_seconds: s.alarm_threshold_seconds || null,
      meta: alarmMeta || {},
    }];
  }
  return {
    id: s.id, name: s.name, color: s.color, sortOrder: s.sort_order, kind: s.kind,
    bot_id: s.bot_id || null,
    stale_hours: s.stale_hours || null,
    // Single-alarm legacy (mantenido para que vistas/código viejo no rompan).
    // Refleja el primer elemento del array — si solo hay una alarma se ve igual
    // que antes; si hay varias, las extras quedan solo en `alarms`.
    alarm_type: alarms[0]?.type || null,
    alarm_threshold_seconds: alarms[0]?.threshold_seconds || null,
    alarm_meta: alarms[0]?.meta || null,
    alarms,
  };
}
function toPipeline(p, stages) {
  return { id: p.id, name: p.name, color: p.color, icon: p.icon || null, sortOrder: p.sort_order, stages };
}

function listWithStages(db, tenantId) {
  const pipelines = db.prepare('SELECT * FROM pipelines WHERE tenant_id = ? ORDER BY sort_order, id').all(tenantId);
  const stages = db.prepare('SELECT * FROM stages WHERE tenant_id = ? ORDER BY pipeline_id, sort_order').all(tenantId);
  return pipelines.map((p) =>
    toPipeline(p, stages.filter(s => s.pipeline_id === p.id).map(toStage))
  );
}

function create(db, tenantId, { name, color = '#2563eb', icon = null }) {
  if (!name?.trim()) throw new Error('El nombre es requerido');
  const r = db.prepare('INSERT INTO pipelines (tenant_id, name, color, icon) VALUES (?, ?, ?, ?)').run(tenantId, name.trim(), color, icon || null);
  return getById(db, tenantId, r.lastInsertRowid);
}

function getById(db, tenantId, id) {
  const p = db.prepare('SELECT * FROM pipelines WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!p) throw new Error('Pipeline no encontrado');
  const stages = db.prepare('SELECT * FROM stages WHERE pipeline_id = ? AND tenant_id = ? ORDER BY sort_order').all(id, tenantId);
  return toPipeline(p, stages.map(toStage));
}

function update(db, tenantId, id, { name, color, icon }) {
  const p = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!p) throw new Error('Pipeline no encontrado');
  if (name !== undefined) name = name.trim();
  db.prepare('UPDATE pipelines SET name = COALESCE(?, name), color = COALESCE(?, color), icon = COALESCE(?, icon) WHERE id = ? AND tenant_id = ?')
    .run(name || null, color || null, icon !== undefined ? (icon || null) : null, id, tenantId);
  return getById(db, tenantId, id);
}

function reorderStages(db, tenantId, pipelineId, orderedIds) {
  const stmt = db.prepare('UPDATE stages SET sort_order = ? WHERE id = ? AND pipeline_id = ? AND tenant_id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((stageId, idx) => stmt.run(idx, stageId, pipelineId, tenantId));
  });
  trx();
}

function reorderPipelines(db, tenantId, orderedIds) {
  const stmt = db.prepare('UPDATE pipelines SET sort_order = ? WHERE id = ? AND tenant_id = ?');
  const trx = db.transaction(() => {
    orderedIds.forEach((id, idx) => stmt.run(idx, id, tenantId));
  });
  trx();
}

function remove(db, tenantId, id, advisor) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM expedients WHERE pipeline_id = ? AND tenant_id = ?').get(id, tenantId)?.n || 0;
  if (count > 0) throw new Error(`Este pipeline tiene ${count} expediente${count === 1 ? '' : 's'}. Muévelos a otro pipeline antes de eliminarlo.`);
  const p = db.prepare('SELECT * FROM pipelines WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!p) throw new Error('Pipeline no encontrado');
  const stages = db.prepare('SELECT * FROM stages WHERE pipeline_id = ? AND tenant_id = ? ORDER BY sort_order').all(id, tenantId);
  const trash = require('../trash/service');
  trash.save(db, tenantId, {
    entityType:    'pipeline',
    entityId:      id,
    entityName:    p.name,
    snapshot:      { ...p, stages },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  const r = db.prepare('DELETE FROM pipelines WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  if (!r.changes) throw new Error('Pipeline no encontrado');
}

// ── Stages ──
function createStage(db, tenantId, pipelineId, { name, color = '#94a3b8', kind = 'in_progress' }) {
  if (!name?.trim()) throw new Error('El nombre es requerido');
  if (!db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(pipelineId, tenantId)) {
    throw new Error('Pipeline no encontrado');
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM stages WHERE pipeline_id = ? AND tenant_id = ?').get(pipelineId, tenantId).n;
  const r = db.prepare(
    'INSERT INTO stages (tenant_id, pipeline_id, name, color, sort_order, kind) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(tenantId, pipelineId, name.trim(), color, maxOrder, kind);
  return db.prepare('SELECT * FROM stages WHERE id = ?').get(r.lastInsertRowid);
}

function updateStage(db, tenantId, id, patch) {
  const s = db.prepare('SELECT * FROM stages WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!s) throw new Error('Etapa no encontrada');
  const newName   = patch.name  !== undefined ? (patch.name.trim() || s.name) : s.name;
  const newColor  = patch.color !== undefined ? patch.color : s.color;
  const newKind   = patch.kind  !== undefined ? patch.kind  : s.kind;
  let newBotId = s.bot_id;
  if ('bot_id' in patch) {
    const bid = patch.bot_id ? Number(patch.bot_id) : null;
    if (bid && !db.prepare('SELECT id FROM salsbots WHERE id = ? AND tenant_id = ?').get(bid, tenantId)) {
      throw new Error('Bot no encontrado');
    }
    newBotId = bid;
  }
  const newStale = 'stale_hours' in patch ? (patch.stale_hours ? Number(patch.stale_hours) : null) : s.stale_hours;

  // ── Alarmas ──
  // Caminos de actualización:
  //   1. patch.alarms (array) → reemplaza el array completo (modo multi-alarmas)
  //   2. patch.alarm_type/threshold/meta → modo legacy (single alarm).
  //      Lo mapeamos a un array de 1 elemento para mantener consistencia.
  // El primer elemento se duplica también en columnas alarm_* legacy para que
  // queries antiguas y la lógica de healthz/migraciones futuras sigan viendo algo.
  let newAlarms = null;
  if (Array.isArray(patch.alarms)) {
    newAlarms = patch.alarms
      .filter(a => a && a.type) // ignora vacíos
      .map((a, i) => ({
        id: a.id || `a${i + 1}`,
        type: String(a.type),
        threshold_seconds: a.threshold_seconds ? Number(a.threshold_seconds) : null,
        meta: (a.meta && typeof a.meta === 'object') ? a.meta : {},
      }));
  } else if ('alarm_type' in patch) {
    // Legacy: el caller mandó la forma vieja. La convertimos a array de 1.
    if (!patch.alarm_type) {
      newAlarms = [];
    } else {
      let metaObj = {};
      if (patch.alarm_meta && typeof patch.alarm_meta === 'object') metaObj = patch.alarm_meta;
      else if (typeof patch.alarm_meta === 'string') {
        try { metaObj = JSON.parse(patch.alarm_meta); } catch {}
      }
      newAlarms = [{
        id: 'a1',
        type: patch.alarm_type,
        threshold_seconds: patch.alarm_threshold_seconds ? Number(patch.alarm_threshold_seconds) : null,
        meta: metaObj,
      }];
    }
  }

  // Si no hay update de alarmas, mantén lo que había
  let newAlarmsJson, newAlarmType, newAlarmThreshold, newAlarmMetaCol;
  if (newAlarms === null) {
    newAlarmsJson      = s.alarms_json || '[]';
    newAlarmType       = s.alarm_type;
    newAlarmThreshold  = s.alarm_threshold_seconds;
    newAlarmMetaCol    = s.alarm_meta;
  } else {
    newAlarmsJson      = JSON.stringify(newAlarms);
    const first        = newAlarms[0] || null;
    newAlarmType       = first ? first.type : null;
    newAlarmThreshold  = first ? first.threshold_seconds : null;
    newAlarmMetaCol    = first ? JSON.stringify(first.meta || {}) : null;
  }

  db.prepare(`
    UPDATE stages
       SET name=?, color=?, kind=?, bot_id=?, stale_hours=?,
           alarm_type=?, alarm_threshold_seconds=?, alarm_meta=?, alarms_json=?
     WHERE id=? AND tenant_id=?
  `).run(newName, newColor, newKind, newBotId, newStale,
         newAlarmType, newAlarmThreshold, newAlarmMetaCol, newAlarmsJson, id, tenantId);

  return db.prepare('SELECT * FROM stages WHERE id = ? AND tenant_id = ?').get(id, tenantId);
}

function removeStage(db, tenantId, id, advisor) {
  const s = db.prepare('SELECT * FROM stages WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!s) throw new Error('Etapa no encontrada');
  const trash = require('../trash/service');
  trash.save(db, tenantId, {
    entityType:    'stage',
    entityId:      id,
    entityName:    s.name,
    snapshot:      { ...s },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  const r = db.prepare('DELETE FROM stages WHERE id = ? AND tenant_id = ?').run(id, tenantId);
  if (!r.changes) throw new Error('Etapa no encontrada');
}

module.exports = { listWithStages, create, getById, update, remove, createStage, updateStage, removeStage, reorderStages, reorderPipelines };
