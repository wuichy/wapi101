// Servicio de Expedientes. Reemplaza el anterior (que aún referenciaba "leads").

const VALID_SORT = {
  name:       'e.name COLLATE NOCASE',
  contact:    'c.first_name COLLATE NOCASE',
  pipeline:   'p.name COLLATE NOCASE',
  stage:      's.name COLLATE NOCASE',
  createdAt:  'e.created_at',
  updatedAt:  'e.updated_at',
};

// Completa un row de expedient con tags y valores de campos personalizados.
function hydrate(db, row) {
  if (!row) return null;
  const tags = db.prepare('SELECT tag FROM expedient_tags WHERE expedient_id = ? ORDER BY tag').all(row.id).map((r) => r.tag);
  const fieldValues = db.prepare(`
    SELECT cfv.field_id, cfv.value, cfd.label, cfd.field_type, cfd.options
    FROM custom_field_values cfv
    JOIN custom_field_defs cfd ON cfd.id = cfv.field_id
    WHERE cfv.entity = 'expedient' AND cfv.record_id = ?
    ORDER BY cfd.sort_order
  `).all(row.id);

  return {
    id:           row.id,
    name:         row.name,
    nameIsAuto:   !!row.name_is_auto,
    contactId:    row.contact_id,
    contactName:  row.contact_name || null,
    pipelineId:   row.pipeline_id,
    pipelineName: row.pipeline_name || null,
    pipelineColor: row.pipeline_color || null,
    stageId:      row.stage_id,
    stageName:    row.stage_name || null,
    stageKind:    row.stage_kind || null,
    stageColor:   row.stage_color || null,
    value:        row.value || 0,
    tags,
    fieldValues:  fieldValues.map((fv) => ({
      fieldId:   fv.field_id,
      label:     fv.label,
      fieldType: fv.field_type,
      options:   fv.options ? JSON.parse(fv.options) : [],
      value:     fv.value,
    })),
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT e.*,
    (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name,
    p.name AS pipeline_name,
    p.color AS pipeline_color,
    s.name AS stage_name,
    s.kind AS stage_kind,
    s.color AS stage_color
  FROM expedients e
  JOIN contacts c ON c.id = e.contact_id
  JOIN pipelines p ON p.id = e.pipeline_id
  JOIN stages s ON s.id = e.stage_id
`;

function list(db, { search = '', page = 1, pageSize = 50, sortBy = 'createdAt', sortDir = 'desc', tags = [], fieldFilters = {} } = {}) {
  pageSize = [10, 25, 50, 100, 200].includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);
  const sortCol = VALID_SORT[sortBy] || VALID_SORT.createdAt;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const conditions = [];
  const params = [];

  if (search) {
    const likeVal = `%${search}%`;
    conditions.push(`(e.name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR p.name LIKE ? OR c.phone LIKE ? OR LOWER(IFNULL(c.email,'')) LIKE ?)`);
    params.push(likeVal, likeVal, likeVal, likeVal, likeVal, likeVal.toLowerCase());
  }

  const tagList = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  for (const tag of tagList) {
    conditions.push(`EXISTS (SELECT 1 FROM expedient_tags et WHERE et.expedient_id = e.id AND et.tag = ?)`);
    params.push(tag);
  }

  for (const [fieldId, value] of Object.entries(fieldFilters || {})) {
    conditions.push(`EXISTS (SELECT 1 FROM custom_field_values cfv WHERE cfv.entity = 'expedient' AND cfv.record_id = e.id AND cfv.field_id = ? AND cfv.value LIKE ?)`);
    params.push(Number(fieldId), `%${value}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM expedients e JOIN contacts c ON c.id = e.contact_id JOIN pipelines p ON p.id = e.pipeline_id JOIN stages s ON s.id = e.stage_id ${where}`).get(...params).n;
  const rows  = db.prepare(`${BASE_SELECT} ${where} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map((r) => hydrate(db, r)),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function listTags(db) {
  return db.prepare('SELECT DISTINCT tag FROM expedient_tags ORDER BY tag').all().map(r => r.tag);
}

function getById(db, id) {
  const row = db.prepare(`${BASE_SELECT} WHERE e.id = ?`).get(id);
  return hydrate(db, row);
}

function create(db, { contactId, pipelineId, stageId, name, value = 0, tags = [], fieldValues = {} }) {
  if (!contactId) throw new Error('El contacto es obligatorio');
  if (!pipelineId) throw new Error('El pipeline es obligatorio');
  if (!stageId) throw new Error('La etapa es obligatoria');

  // Validar que el contacto, pipeline y etapa existen
  if (!db.prepare('SELECT id FROM contacts WHERE id = ?').get(contactId)) throw new Error('Contacto no encontrado');
  if (!db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId)) throw new Error('Pipeline no encontrado');
  if (!db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').get(stageId, pipelineId)) throw new Error('La etapa no pertenece al pipeline seleccionado');

  const trimmedName = name?.trim() || null;
  const r = db.prepare(`
    INSERT INTO expedients (contact_id, pipeline_id, stage_id, name, value, name_is_auto)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(contactId, pipelineId, stageId, trimmedName, Number(value) || 0, trimmedName ? 0 : 1);

  const id = r.lastInsertRowid;

  if (!trimmedName) {
    db.prepare('UPDATE expedients SET name = ? WHERE id = ?').run(String(id), id);
  }

  setTags(db, id, tags);
  setCustomFieldValues(db, id, fieldValues);
  return getById(db, id);
}

function update(db, id, { pipelineId, stageId, name, value, tags, fieldValues, contactId, contactName }) {
  const row = db.prepare('SELECT * FROM expedients WHERE id = ?').get(id);
  if (!row) return null;

  if (contactName !== undefined && row.contact_id) {
    const trimmed = contactName.trim();
    db.prepare('UPDATE contacts SET first_name = ? WHERE id = ?').run(trimmed || null, row.contact_id);
  }

  const fields = [];
  const params = [];

  if (contactId !== undefined) {
    if (!db.prepare('SELECT id FROM contacts WHERE id = ?').get(contactId)) throw new Error('Contacto no encontrado');
    fields.push('contact_id = ?'); params.push(contactId);
  }
  if (name !== undefined) {
    const trimmed = name?.trim() || null;
    fields.push('name = ?'); params.push(trimmed);
    // Si se está poniendo un nombre real, marcar como no-auto
    if (trimmed && row.name_is_auto) { fields.push('name_is_auto = 0'); }
  }
  if (value !== undefined) { fields.push('value = ?'); params.push(Number(value) || 0); }
  if (pipelineId !== undefined) { fields.push('pipeline_id = ?'); params.push(pipelineId); }
  if (stageId !== undefined) { fields.push('stage_id = ?'); params.push(stageId); }
  if (fields.length) {
    fields.push('updated_at = unixepoch()');
    params.push(id);
    db.prepare(`UPDATE expedients SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  }

  if (Array.isArray(tags)) setTags(db, id, tags);
  if (fieldValues && typeof fieldValues === 'object') setCustomFieldValues(db, id, fieldValues);

  return getById(db, id);
}

function remove(db, id, advisor) {
  const row = db.prepare('SELECT * FROM expedients WHERE id = ?').get(id);
  if (!row) return false;
  const tags = db.prepare('SELECT tag FROM expedient_tags WHERE expedient_id = ?').all(id).map(r => r.tag);
  const fieldValues = db.prepare(
    'SELECT field_id, value FROM custom_field_values WHERE entity = ? AND record_id = ?'
  ).all('expedient', id);
  const trash = require('../trash/service');
  trash.save(db, {
    entityType:    'expedient',
    entityId:      id,
    entityName:    row.name || String(id),
    snapshot:      { ...row, tags, fieldValues },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  return db.prepare('DELETE FROM expedients WHERE id = ?').run(id).changes > 0;
}

function setTags(db, expedientId, tags) {
  db.prepare('DELETE FROM expedient_tags WHERE expedient_id = ?').run(expedientId);
  const stmt = db.prepare('INSERT OR IGNORE INTO expedient_tags (expedient_id, tag) VALUES (?, ?)');
  for (const tag of tags) {
    const t = String(tag).trim();
    if (t) stmt.run(expedientId, t);
  }
}

function setCustomFieldValues(db, expedientId, values) {
  const upsert = db.prepare(`
    INSERT INTO custom_field_values (entity, record_id, field_id, value) VALUES ('expedient', ?, ?, ?)
    ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
  `);
  for (const [fieldId, val] of Object.entries(values)) {
    const v = val === null || val === undefined ? null : String(val);
    upsert.run(expedientId, Number(fieldId), v);
  }
}

// ─── Campos personalizados ───
function listFieldDefs(db, entity = 'expedient') {
  return db.prepare('SELECT * FROM custom_field_defs WHERE entity = ? ORDER BY sort_order, id').all(entity).map((r) => ({
    id:        r.id,
    entity:    r.entity,
    label:     r.label,
    fieldType: r.field_type,
    options:   r.options ? JSON.parse(r.options) : [],
    sortOrder: r.sort_order,
  }));
}

const VALID_TYPES = ['text','number','toggle','select','multi_select','date','url','long_text','birthday','datetime'];

function createFieldDef(db, { entity = 'expedient', label, fieldType = 'text', options = [] }) {
  if (!label?.trim()) throw new Error('El nombre del campo es obligatorio');
  if (!VALID_TYPES.includes(fieldType)) throw new Error(`Tipo inválido: ${fieldType}`);
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM custom_field_defs WHERE entity = ?').get(entity).m || 0;
  const r = db.prepare(`
    INSERT INTO custom_field_defs (entity, label, field_type, options, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(entity, label.trim(), fieldType, options.length ? JSON.stringify(options) : null, maxOrder + 1);
  return listFieldDefs(db, entity).find((f) => f.id === r.lastInsertRowid);
}

function updateFieldDef(db, id, { label, fieldType, options }) {
  const row = db.prepare('SELECT * FROM custom_field_defs WHERE id = ?').get(id);
  if (!row) throw new Error('Campo no encontrado');
  const newLabel    = label?.trim() || row.label;
  const newType     = fieldType && VALID_TYPES.includes(fieldType) ? fieldType : row.field_type;
  const newOptions  = options !== undefined ? (options.length ? JSON.stringify(options) : null) : row.options;
  db.prepare('UPDATE custom_field_defs SET label = ?, field_type = ?, options = ? WHERE id = ?').run(newLabel, newType, newOptions, id);
  return listFieldDefs(db, row.entity).find((f) => f.id === id);
}

function removeFieldDef(db, id) {
  return db.prepare('DELETE FROM custom_field_defs WHERE id = ?').run(id).changes > 0;
}

// Búsqueda rápida de contactos (para el selector del modal)
function searchContacts(db, q) {
  const like = `%${q || ''}%`;
  return db.prepare(`
    SELECT id, first_name, last_name, phone, email FROM contacts
    WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?
    ORDER BY first_name COLLATE NOCASE LIMIT 20
  `).all(like, like, like, like).map((c) => ({
    id: c.id,
    name: [c.first_name, c.last_name].filter(Boolean).join(' '),
    phone: c.phone,
    email: c.email,
  }));
}

module.exports = {
  list, getById, create, update, remove,
  listFieldDefs, createFieldDef, updateFieldDef, removeFieldDef,
  searchContacts, listTags,
};
