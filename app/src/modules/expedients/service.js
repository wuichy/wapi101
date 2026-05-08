// Servicio de Expedientes — multi-tenant aware.
//
// Convención: todas las funciones reciben `tenantId` como segundo argumento.
// Si los callers internos (webhooks, bot/engine, whatsapp-web/bootstrap) no
// tienen tenantId a la mano todavía, pueden pasar null y el servicio lo deriva
// del contacto / expediente referenciado. Esto mantiene la API funcionando
// para esos callers mientras se refactorizan en Fase 2c.

const VALID_SORT = {
  name:       'e.name COLLATE NOCASE',
  contact:    'c.first_name COLLATE NOCASE',
  pipeline:   'p.name COLLATE NOCASE',
  stage:      's.name COLLATE NOCASE',
  createdAt:  'e.created_at',
  updatedAt:  'e.updated_at',
};

// Helpers de resolución de tenant para callers que pasan null.
function _tenantFromContact(db, contactId) {
  if (!contactId) return null;
  return db.prepare('SELECT tenant_id FROM contacts WHERE id = ?').get(contactId)?.tenant_id || null;
}
function _tenantFromExpedient(db, expedientId) {
  if (!expedientId) return null;
  return db.prepare('SELECT tenant_id FROM expedients WHERE id = ?').get(expedientId)?.tenant_id || null;
}

// Completa un row de expedient con tags y valores de campos personalizados.
function hydrate(db, tenantId, row) {
  if (!row) return null;
  const tags = db.prepare('SELECT tag FROM expedient_tags WHERE expedient_id = ? AND tenant_id = ? ORDER BY tag').all(row.id, tenantId).map((r) => r.tag);
  const fieldValues = db.prepare(`
    SELECT cfv.field_id, cfv.value, cfd.label, cfd.field_type, cfd.options
    FROM custom_field_values cfv
    JOIN custom_field_defs cfd ON cfd.id = cfv.field_id
    WHERE cfv.entity = 'expedient' AND cfv.record_id = ? AND cfv.tenant_id = ?
    ORDER BY cfd.sort_order
  `).all(row.id, tenantId);

  return {
    id:           row.id,
    name:         row.name,
    nameIsAuto:   !!row.name_is_auto,
    contactId:    row.contact_id,
    contactName:  row.contact_name || null,
    contactEmail: row.contact_email || null,
    contactPhone: row.contact_phone || null,
    contactAvatarUrl: row.contact_avatar_url || null,
    assignedAdvisorId:   row.assigned_advisor_id || null,
    assignedAdvisorName: row.assigned_advisor_name || null,
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
    stageEnteredAt: row.stage_entered_at || row.created_at,
    lastIncomingAt: row.last_incoming_at || null,
    lastMessageAt:  row.last_message_at  || null,
    botPaused:      !!row.conv_bot_paused,
    botPausedAt:    row.bot_paused_at || null,
    deliveryFailure: _lastDeliveryFailure(db, tenantId, row.contact_id),
  };
}

// Devuelve { reason, at, provider } si el último mensaje OUTGOING del contacto
// (en cualquier conversación del mismo tenant) está en estado 'failed'.
function _lastDeliveryFailure(db, tenantId, contactId) {
  if (!contactId) return null;
  try {
    const row = db.prepare(`
      SELECT m.status, m.error_reason, m.created_at, m.provider
        FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
       WHERE c.contact_id = ? AND c.tenant_id = ? AND m.direction = 'outgoing'
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1
    `).get(contactId, tenantId);
    if (row && row.status === 'failed') {
      return {
        reason: row.error_reason || 'Error desconocido',
        at: row.created_at,
        provider: row.provider,
      };
    }
  } catch (_) {}
  return null;
}

const BASE_SELECT = `
  SELECT e.*,
    (c.first_name || COALESCE(' ' || c.last_name, '')) AS contact_name,
    c.email AS contact_email,
    c.phone AS contact_phone,
    c.avatar_url AS contact_avatar_url,
    aa.name AS assigned_advisor_name,
    aa.username AS assigned_advisor_username,
    p.name AS pipeline_name,
    p.color AS pipeline_color,
    s.name AS stage_name,
    s.kind AS stage_kind,
    s.color AS stage_color,
    conv.last_incoming_at AS last_incoming_at,
    conv.last_message_at  AS last_message_at,
    conv.bot_paused       AS conv_bot_paused,
    conv.bot_paused_at    AS bot_paused_at
  FROM expedients e
  JOIN contacts c ON c.id = e.contact_id
  JOIN pipelines p ON p.id = e.pipeline_id
  JOIN stages s ON s.id = e.stage_id
  LEFT JOIN advisors aa ON aa.id = e.assigned_advisor_id
  LEFT JOIN (
    SELECT contact_id, tenant_id,
           MAX(last_incoming_at) AS last_incoming_at,
           MAX(last_message_at)  AS last_message_at,
           MAX(bot_paused)       AS bot_paused,
           MAX(bot_paused_at)    AS bot_paused_at
      FROM conversations
     GROUP BY contact_id, tenant_id
  ) conv ON conv.contact_id = e.contact_id AND conv.tenant_id = e.tenant_id
`;

function list(db, tenantId, { search = '', page = 1, pageSize = 50, sortBy = 'createdAt', sortDir = 'desc', tags = [], fieldFilters = {}, contactId = null } = {}) {
  pageSize = [10, 25, 50, 100, 200].includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);
  const sortCol = VALID_SORT[sortBy] || VALID_SORT.createdAt;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const conditions = ['e.tenant_id = ?'];
  const params = [tenantId];

  if (contactId) {
    conditions.push('e.contact_id = ?');
    params.push(Number(contactId));
  }

  if (search) {
    const likeVal = `%${search}%`;
    conditions.push(`(e.name LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ? OR p.name LIKE ? OR c.phone LIKE ? OR LOWER(IFNULL(c.email,'')) LIKE ?)`);
    params.push(likeVal, likeVal, likeVal, likeVal, likeVal, likeVal.toLowerCase());
  }

  const tagList = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  for (const tag of tagList) {
    conditions.push(`EXISTS (SELECT 1 FROM expedient_tags et WHERE et.expedient_id = e.id AND et.tag = ? AND et.tenant_id = e.tenant_id)`);
    params.push(tag);
  }

  for (const [fieldId, value] of Object.entries(fieldFilters || {})) {
    conditions.push(`EXISTS (SELECT 1 FROM custom_field_values cfv WHERE cfv.entity = 'expedient' AND cfv.record_id = e.id AND cfv.field_id = ? AND cfv.value LIKE ? AND cfv.tenant_id = e.tenant_id)`);
    params.push(Number(fieldId), `%${value}%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) AS n FROM expedients e JOIN contacts c ON c.id = e.contact_id JOIN pipelines p ON p.id = e.pipeline_id JOIN stages s ON s.id = e.stage_id ${where}`).get(...params).n;
  const rows  = db.prepare(`${BASE_SELECT} ${where} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map((r) => hydrate(db, tenantId, r)),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

function listTags(db, tenantId) {
  return db.prepare('SELECT DISTINCT tag FROM expedient_tags WHERE tenant_id = ? ORDER BY tag').all(tenantId).map(r => r.tag);
}

function getById(db, tenantId, id) {
  const t = tenantId ?? _tenantFromExpedient(db, id);
  if (!t) return null;
  const row = db.prepare(`${BASE_SELECT} WHERE e.id = ? AND e.tenant_id = ?`).get(id, t);
  return hydrate(db, t, row);
}

function create(db, tenantId, { contactId, pipelineId, stageId, name, value = 0, tags = [], fieldValues = {}, assignedAdvisorId = null }) {
  if (!contactId) throw new Error('El contacto es obligatorio');
  if (!pipelineId) throw new Error('El pipeline es obligatorio');
  if (!stageId) throw new Error('La etapa es obligatoria');

  // Si no nos pasaron tenantId, derivarlo del contacto.
  const t = tenantId ?? _tenantFromContact(db, contactId);
  if (!t) throw new Error('No se pudo determinar el tenant del expediente');

  // Validar que contacto, pipeline y etapa existen y pertenecen al mismo tenant
  if (!db.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, t)) throw new Error('Contacto no encontrado');
  if (!db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(pipelineId, t)) throw new Error('Pipeline no encontrado');
  if (!db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ? AND tenant_id = ?').get(stageId, pipelineId, t)) throw new Error('La etapa no pertenece al pipeline seleccionado');

  const trimmedName = name?.trim() || null;
  const r = db.prepare(`
    INSERT INTO expedients (tenant_id, contact_id, pipeline_id, stage_id, name, value, name_is_auto, stage_entered_at, assigned_advisor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
  `).run(t, contactId, pipelineId, stageId, trimmedName, Number(value) || 0, trimmedName ? 0 : 1, assignedAdvisorId || null);

  const id = r.lastInsertRowid;

  if (!trimmedName) {
    db.prepare('UPDATE expedients SET name = ? WHERE id = ? AND tenant_id = ?').run(String(id), id, t);
  }

  setTags(db, t, id, tags);
  setCustomFieldValues(db, t, id, fieldValues);
  return getById(db, t, id);
}

function update(db, tenantId, id, { pipelineId, stageId, name, value, tags, fieldValues, contactId, contactName, assignedAdvisorId }) {
  const t = tenantId ?? _tenantFromExpedient(db, id);
  if (!t) return null;
  const row = db.prepare('SELECT * FROM expedients WHERE id = ? AND tenant_id = ?').get(id, t);
  if (!row) return null;

  if (contactName !== undefined && row.contact_id) {
    const trimmed = contactName.trim();
    db.prepare('UPDATE contacts SET first_name = ? WHERE id = ? AND tenant_id = ?').run(trimmed || null, row.contact_id, t);
  }

  const fields = [];
  const params = [];

  if (contactId !== undefined) {
    if (!db.prepare('SELECT id FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, t)) throw new Error('Contacto no encontrado');
    fields.push('contact_id = ?'); params.push(contactId);
  }
  if (name !== undefined) {
    const trimmed = name?.trim() || null;
    fields.push('name = ?'); params.push(trimmed);
    if (trimmed && row.name_is_auto) { fields.push('name_is_auto = 0'); }
  }
  if (value !== undefined) { fields.push('value = ?'); params.push(Number(value) || 0); }
  if (pipelineId !== undefined) { fields.push('pipeline_id = ?'); params.push(pipelineId); }
  if (stageId !== undefined && stageId !== row.stage_id) {
    fields.push('stage_id = ?'); params.push(stageId);
    fields.push('stage_entered_at = unixepoch()');
  } else if (stageId !== undefined) {
    fields.push('stage_id = ?'); params.push(stageId);
  }
  if (assignedAdvisorId !== undefined) {
    if (assignedAdvisorId === null) {
      fields.push('assigned_advisor_id = NULL');
    } else {
      const adv = db.prepare('SELECT id FROM advisors WHERE id = ? AND tenant_id = ?').get(assignedAdvisorId, t);
      if (!adv) throw new Error('Asesor no encontrado');
      fields.push('assigned_advisor_id = ?'); params.push(assignedAdvisorId);
    }
  }
  if (fields.length) {
    fields.push('updated_at = unixepoch()');
    params.push(id, t);
    db.prepare(`UPDATE expedients SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`).run(...params);
  }

  if (Array.isArray(tags)) setTags(db, t, id, tags);
  if (fieldValues && typeof fieldValues === 'object') setCustomFieldValues(db, t, id, fieldValues);

  return getById(db, t, id);
}

function remove(db, tenantId, id, advisor) {
  const t = tenantId ?? _tenantFromExpedient(db, id);
  if (!t) return false;
  const row = db.prepare('SELECT * FROM expedients WHERE id = ? AND tenant_id = ?').get(id, t);
  if (!row) return false;
  const tags = db.prepare('SELECT tag FROM expedient_tags WHERE expedient_id = ? AND tenant_id = ?').all(id, t).map(r => r.tag);
  const fieldValues = db.prepare(
    'SELECT field_id, value FROM custom_field_values WHERE entity = ? AND record_id = ? AND tenant_id = ?'
  ).all('expedient', id, t);
  const trash = require('../trash/service');
  trash.save(db, t, {
    entityType:    'expedient',
    entityId:      id,
    entityName:    row.name || String(id),
    snapshot:      { ...row, tags, fieldValues },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  return db.prepare('DELETE FROM expedients WHERE id = ? AND tenant_id = ?').run(id, t).changes > 0;
}

function setTags(db, tenantId, expedientId, tags) {
  db.prepare('DELETE FROM expedient_tags WHERE expedient_id = ? AND tenant_id = ?').run(expedientId, tenantId);
  const stmt = db.prepare('INSERT OR IGNORE INTO expedient_tags (tenant_id, expedient_id, tag) VALUES (?, ?, ?)');
  for (const tag of tags) {
    const t = String(tag).trim();
    if (t) stmt.run(tenantId, expedientId, t);
  }
}

function setCustomFieldValues(db, tenantId, expedientId, values) {
  const upsert = db.prepare(`
    INSERT INTO custom_field_values (tenant_id, entity, record_id, field_id, value) VALUES (?, 'expedient', ?, ?, ?)
    ON CONFLICT(entity, record_id, field_id) DO UPDATE SET value = excluded.value
  `);
  for (const [fieldId, val] of Object.entries(values)) {
    const v = val === null || val === undefined ? null : String(val);
    upsert.run(tenantId, expedientId, Number(fieldId), v);
  }
}

// ─── Campos personalizados ───
function listFieldDefs(db, tenantId, entity = 'expedient') {
  return db.prepare('SELECT * FROM custom_field_defs WHERE entity = ? AND tenant_id = ? ORDER BY sort_order, id').all(entity, tenantId).map((r) => ({
    id:        r.id,
    entity:    r.entity,
    label:     r.label,
    fieldType: r.field_type,
    options:   r.options ? JSON.parse(r.options) : [],
    sortOrder: r.sort_order,
  }));
}

const VALID_TYPES = ['text','number','toggle','select','multi_select','date','url','long_text','birthday','datetime'];

function createFieldDef(db, tenantId, { entity = 'expedient', label, fieldType = 'text', options = [] }) {
  if (!label?.trim()) throw new Error('El nombre del campo es obligatorio');
  if (!VALID_TYPES.includes(fieldType)) throw new Error(`Tipo inválido: ${fieldType}`);
  const maxOrder = db.prepare('SELECT MAX(sort_order) AS m FROM custom_field_defs WHERE entity = ? AND tenant_id = ?').get(entity, tenantId).m || 0;
  const r = db.prepare(`
    INSERT INTO custom_field_defs (tenant_id, entity, label, field_type, options, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, entity, label.trim(), fieldType, options.length ? JSON.stringify(options) : null, maxOrder + 1);
  return listFieldDefs(db, tenantId, entity).find((f) => f.id === r.lastInsertRowid);
}

function updateFieldDef(db, tenantId, id, { label, fieldType, options }) {
  const row = db.prepare('SELECT * FROM custom_field_defs WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Campo no encontrado');
  const newLabel    = label?.trim() || row.label;
  const newType     = fieldType && VALID_TYPES.includes(fieldType) ? fieldType : row.field_type;
  const newOptions  = options !== undefined ? (options.length ? JSON.stringify(options) : null) : row.options;
  db.prepare('UPDATE custom_field_defs SET label = ?, field_type = ?, options = ? WHERE id = ? AND tenant_id = ?').run(newLabel, newType, newOptions, id, tenantId);
  return listFieldDefs(db, tenantId, row.entity).find((f) => f.id === id);
}

function removeFieldDef(db, tenantId, id) {
  return db.prepare('DELETE FROM custom_field_defs WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes > 0;
}

// Búsqueda rápida de contactos (para el selector del modal)
function searchContacts(db, tenantId, q) {
  const like = `%${q || ''}%`;
  return db.prepare(`
    SELECT id, first_name, last_name, phone, email FROM contacts
    WHERE tenant_id = ?
      AND (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?)
    ORDER BY first_name COLLATE NOCASE LIMIT 20
  `).all(tenantId, like, like, like, like).map((c) => ({
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
