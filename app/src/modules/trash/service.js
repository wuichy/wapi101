const THIRTY_DAYS = 30 * 24 * 60 * 60; // segundos

function save(db, { entityType, entityId, entityName, snapshot, deletedById, deletedByName }) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO trash (entity_type, entity_id, entity_name, snapshot, deleted_by_id, deleted_by_name, deleted_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entityType, entityId, entityName || null, JSON.stringify(snapshot), deletedById || null, deletedByName || null, now, now + THIRTY_DAYS);
}

function list(db) {
  purgeExpired(db);
  const rows = db.prepare(`
    SELECT id, entity_type, entity_id, entity_name, deleted_by_name, deleted_at, expires_at
    FROM trash ORDER BY deleted_at DESC
  `).all();
  return rows.map(hydrate);
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM trash WHERE id = ?').get(id);
  if (!row) throw new Error('Elemento no encontrado en la papelera');
  return { ...hydrate(row), snapshot: JSON.parse(row.snapshot || '{}') };
}

function hydrate(row) {
  return {
    id:            row.id,
    entityType:    row.entity_type,
    entityId:      row.entity_id,
    entityName:    row.entity_name,
    deletedByName: row.deleted_by_name,
    deletedAt:     row.deleted_at,
    expiresAt:     row.expires_at,
  };
}

function purgeExpired(db) {
  db.prepare('DELETE FROM trash WHERE expires_at < unixepoch()').run();
}

function permanentDelete(db, id) {
  const r = db.prepare('DELETE FROM trash WHERE id = ?').run(id);
  if (!r.changes) throw new Error('Elemento no encontrado en la papelera');
}

// ── Restore logic por tipo ────────────────────────────────────────────────────

function restore(db, id) {
  const item = getById(db, id);
  let result;

  switch (item.entityType) {
    case 'contact':   result = restoreContact(db, item.snapshot);   break;
    case 'expedient': result = restoreExpedient(db, item.snapshot);  break;
    case 'pipeline':  result = restorePipeline(db, item.snapshot);   break;
    case 'stage':     result = restoreStage(db, item.snapshot);      break;
    case 'salsbot':   result = restoreSalsbot(db, item.snapshot);    break;
    default: throw new Error(`Tipo desconocido: ${item.entityType}`);
  }

  db.prepare('DELETE FROM trash WHERE id = ?').run(id);
  return result;
}

function tryInsertWithId(db, sql, params) {
  try {
    const r = db.prepare(sql).run(...params);
    return r.lastInsertRowid;
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(err.message)) return null;
    throw err;
  }
}

function restoreContact(db, snap) {
  // Intenta recuperar con el ID original; si ya está ocupado, crea uno nuevo
  let insertedId = tryInsertWithId(db,
    'INSERT INTO contacts (id, first_name, last_name, phone, email, bot_paused, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [snap.id, snap.first_name, snap.last_name || null, snap.phone || null, snap.email || null,
     snap.bot_paused || 0, snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)]
  );

  if (!insertedId) {
    // ID ya tomado — insertar sin especificar ID
    const r = db.prepare(
      'INSERT INTO contacts (first_name, last_name, phone, email, bot_paused, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(snap.first_name, snap.last_name || null, snap.phone || null, snap.email || null,
          snap.bot_paused || 0, snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000));
    insertedId = r.lastInsertRowid;
  }

  // Restaurar tags
  if (snap.tags?.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?,?)');
    db.transaction(() => { snap.tags.forEach(t => ins.run(insertedId, t)); })();
  }

  return { id: insertedId, type: 'contact', name: snap.first_name };
}

function restoreExpedient(db, snap) {
  // Verificar que el pipeline y etapa aún existen
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(snap.pipeline_id);
  if (!pipeline) throw new Error('El pipeline original ya no existe. Recupéralo primero desde la papelera.');

  const stage = db.prepare('SELECT id FROM stages WHERE id = ?').get(snap.stage_id);
  if (!stage) throw new Error('La etapa original ya no existe. Recupérala primero desde la papelera.');

  // Verificar que el contacto existe
  const contact = db.prepare('SELECT id FROM contacts WHERE id = ?').get(snap.contact_id);
  if (!contact) throw new Error('El contacto original ya no existe. Recupéralo primero desde la papelera.');

  let insertedId = tryInsertWithId(db,
    'INSERT INTO expedients (id, contact_id, pipeline_id, stage_id, name, value, name_is_auto, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [snap.id, snap.contact_id, snap.pipeline_id, snap.stage_id, snap.name || null,
     snap.value || 0, snap.name_is_auto || 0, snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)]
  );

  if (!insertedId) {
    const r = db.prepare(
      'INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, value, name_is_auto, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
    ).run(snap.contact_id, snap.pipeline_id, snap.stage_id, snap.name || null,
          snap.value || 0, snap.name_is_auto || 0, snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000));
    insertedId = r.lastInsertRowid;
  }

  if (snap.tags?.length) {
    const ins = db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag) VALUES (?,?)');
    db.transaction(() => { snap.tags.forEach(t => ins.run(insertedId, t)); })();
  }

  if (snap.fieldValues?.length) {
    const ins = db.prepare('INSERT OR REPLACE INTO custom_field_values (entity, record_id, field_id, value) VALUES (?,?,?,?)');
    db.transaction(() => {
      snap.fieldValues.forEach(fv => {
        const fieldExists = db.prepare('SELECT id FROM custom_field_defs WHERE id = ?').get(fv.field_id);
        if (fieldExists) ins.run('expedient', insertedId, fv.field_id, fv.value);
      });
    })();
  }

  return { id: insertedId, type: 'expedient', name: snap.name };
}

function restorePipeline(db, snap) {
  let insertedId = tryInsertWithId(db,
    'INSERT INTO pipelines (id, name, color, icon, sort_order, created_at) VALUES (?,?,?,?,?,?)',
    [snap.id, snap.name, snap.color || '#2563eb', snap.icon || null, snap.sort_order || 0, snap.created_at || Math.floor(Date.now()/1000)]
  );

  if (!insertedId) {
    const r = db.prepare(
      'INSERT INTO pipelines (name, color, icon, sort_order, created_at) VALUES (?,?,?,?,?)'
    ).run(snap.name, snap.color || '#2563eb', snap.icon || null, snap.sort_order || 0, snap.created_at || Math.floor(Date.now()/1000));
    insertedId = r.lastInsertRowid;
  }

  // Restaurar etapas del snapshot
  if (snap.stages?.length) {
    const ins = db.prepare(
      'INSERT OR IGNORE INTO stages (id, pipeline_id, name, color, sort_order, kind) VALUES (?,?,?,?,?,?)'
    );
    db.transaction(() => {
      snap.stages.forEach(s => ins.run(s.id, insertedId, s.name, s.color || '#94a3b8', s.sort_order || 0, s.kind || 'in_progress'));
    })();
  }

  return { id: insertedId, type: 'pipeline', name: snap.name };
}

function restoreStage(db, snap) {
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(snap.pipeline_id);
  if (!pipeline) throw new Error('El pipeline de esta etapa ya no existe. Recupéralo primero desde la papelera.');

  let insertedId = tryInsertWithId(db,
    'INSERT INTO stages (id, pipeline_id, name, color, sort_order, kind) VALUES (?,?,?,?,?,?)',
    [snap.id, snap.pipeline_id, snap.name, snap.color || '#94a3b8', snap.sort_order || 0, snap.kind || 'in_progress']
  );

  if (!insertedId) {
    const r = db.prepare(
      'INSERT INTO stages (pipeline_id, name, color, sort_order, kind) VALUES (?,?,?,?,?)'
    ).run(snap.pipeline_id, snap.name, snap.color || '#94a3b8', snap.sort_order || 0, snap.kind || 'in_progress');
    insertedId = r.lastInsertRowid;
  }

  return { id: insertedId, type: 'stage', name: snap.name };
}

function restoreSalsbot(db, snap) {
  // Intenta recuperar con el ID original; si está ocupado, crea uno nuevo
  let insertedId = tryInsertWithId(db,
    'INSERT INTO salsbots (id, name, enabled, trigger_type, trigger_value, steps, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    [snap.id, snap.name, 0 /* deshabilitado al restaurar para evitar disparos */,
     snap.trigger_type || 'keyword', snap.trigger_value || '', snap.steps || '[]',
     snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000)]
  );

  if (!insertedId) {
    const r = db.prepare(
      'INSERT INTO salsbots (name, enabled, trigger_type, trigger_value, steps, created_at, updated_at) VALUES (?,?,?,?,?,?,?)'
    ).run(snap.name + ' (restaurado)', 0, snap.trigger_type || 'keyword', snap.trigger_value || '',
          snap.steps || '[]', snap.created_at || Math.floor(Date.now()/1000), Math.floor(Date.now()/1000));
    insertedId = r.lastInsertRowid;
  }

  return { id: insertedId, type: 'salsbot', name: snap.name };
}

module.exports = { save, list, getById, restore, permanentDelete, purgeExpired };
