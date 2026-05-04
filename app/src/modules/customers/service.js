// Lógica de clientes (contactos). Expone funciones puras que reciben `db`.
// Las rutas HTTP viven en routes.js — este archivo no sabe de Express.

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, '');
  if (!digits) return null;
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+52${digits}`;             // asume MX
  if (digits.length >= 11 && digits.startsWith('52')) return `+${digits}`;
  return digits;
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Convierte un row de SQLite (snake_case) a camelCase y agrega tags + expedientes.
function hydrate(db, row) {
  if (!row) return null;
  const tags = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? ORDER BY id').all(row.id).map((r) => r.tag);
  const expedients = db.prepare(`
    SELECT e.id, e.name, e.value, e.pipeline_id, e.stage_id,
           p.name AS pipeline_name, p.color AS pipeline_color,
           s.name AS stage_name, s.color AS stage_color, s.kind AS stage_kind
    FROM expedients e
    JOIN pipelines p ON p.id = e.pipeline_id
    JOIN stages s ON s.id = e.stage_id
    WHERE e.contact_id = ?
    ORDER BY e.created_at DESC
  `).all(row.id);

  // Cargar fieldValues de todos los expedients en una sola query (evita N+1)
  // para que el modal de Contacto pueda renderizar y editar los campos custom.
  const expIds = expedients.map(e => e.id);
  const fieldValuesByExp = {};
  if (expIds.length) {
    const placeholders = expIds.map(() => '?').join(',');
    const fvRows = db.prepare(`
      SELECT cfv.record_id AS exp_id, cfv.field_id, cfv.value,
             cfd.label, cfd.field_type, cfd.options
        FROM custom_field_values cfv
        JOIN custom_field_defs cfd ON cfd.id = cfv.field_id
       WHERE cfv.entity = 'expedient' AND cfv.record_id IN (${placeholders})
    `).all(...expIds);
    for (const r of fvRows) {
      if (!fieldValuesByExp[r.exp_id]) fieldValuesByExp[r.exp_id] = [];
      fieldValuesByExp[r.exp_id].push({
        fieldId:   r.field_id,
        label:     r.label,
        fieldType: r.field_type,
        options:   r.options ? JSON.parse(r.options) : [],
        value:     r.value,
      });
    }
  }

  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name || '',
    phone: row.phone || '',
    email: row.email || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tags,
    expedients: expedients.map((e) => ({
      id: e.id,
      name: e.name || '',
      value: e.value || 0,
      pipelineId: e.pipeline_id,
      pipelineName: e.pipeline_name,
      pipelineColor: e.pipeline_color,
      stageId: e.stage_id,
      stageName: e.stage_name,
      stageColor: e.stage_color,
      stageKind: e.stage_kind,
      fieldValues: fieldValuesByExp[e.id] || [],
    }))
  };
}

// Whitelist de columnas ordenables (clave UI → expresión SQL)
const SORTABLE = {
  name:            "first_name COLLATE NOCASE, IFNULL(last_name, '') COLLATE NOCASE",
  phone:           'phone',
  email:           'email COLLATE NOCASE',
  createdAt:       'created_at',
  updatedAt:       'updated_at',
  expedientCount:  '(SELECT COUNT(*) FROM expedients WHERE expedients.contact_id = contacts.id)'
};

function list(db, { search, page = 1, pageSize = 50, sortBy = 'createdAt', sortDir = 'desc' } = {}) {
  // Sanitiza paginación
  const allowedSizes = [10, 25, 50, 100, 200];
  pageSize = allowedSizes.includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);

  // Sanitiza sort (whitelist + dir)
  const sortExpr = SORTABLE[sortBy] || SORTABLE.createdAt;
  const dir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // Tiebreaker: id DESC (más reciente entre empates)
  const orderBy = `${sortExpr} ${dir}, id DESC`;

  let countRow, rows;
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    const where = `
      WHERE LOWER(first_name) LIKE ?
         OR LOWER(IFNULL(last_name, '')) LIKE ?
         OR LOWER(IFNULL(phone, '')) LIKE ?
         OR LOWER(IFNULL(email, '')) LIKE ?
    `;
    countRow = db.prepare(`SELECT COUNT(*) AS n FROM contacts ${where}`).get(q, q, q, q);
    rows = db.prepare(`SELECT * FROM contacts ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(q, q, q, q, pageSize, (page - 1) * pageSize);
  } else {
    countRow = db.prepare('SELECT COUNT(*) AS n FROM contacts').get();
    rows = db.prepare(`SELECT * FROM contacts ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(pageSize, (page - 1) * pageSize);
  }

  return {
    items: rows.map((r) => hydrate(db, r)),
    total: countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
    sortBy: SORTABLE[sortBy] ? sortBy : 'createdAt',
    sortDir: dir.toLowerCase()
  };
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  return hydrate(db, row);
}

// Busca duplicado por phone normalizado o email lowercased
function findDuplicate(db, { phone, email }) {
  const normPhone = normalizePhone(phone);
  const normEmail = email ? email.trim().toLowerCase() : null;
  if (!normPhone && !normEmail) return null;

  const rows = db.prepare(`
    SELECT * FROM contacts
    WHERE (? IS NOT NULL AND phone = ?)
       OR (? IS NOT NULL AND LOWER(email) = ?)
    LIMIT 1
  `).all(normPhone, normPhone, normEmail, normEmail);
  return rows[0] || null;
}

function create(db, { firstName, lastName, phone, email, tags = [] }) {
  if (!firstName || !firstName.trim()) {
    throw new Error('El nombre es obligatorio');
  }
  const trx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO contacts (first_name, last_name, phone, email)
      VALUES (?, ?, ?, ?)
    `).run(
      firstName.trim(),
      lastName?.trim() || null,
      normalizePhone(phone),
      email?.trim() || null
    );
    const id = result.lastInsertRowid;
    const insertTag = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)');
    for (const tag of tags) {
      const t = String(tag).trim();
      if (t) insertTag.run(id, t);
    }
    return id;
  });
  const id = trx();
  return getById(db, id);
}

function update(db, id, { firstName, lastName, phone, email, tags }) {
  const trx = db.transaction(() => {
    db.prepare(`
      UPDATE contacts
      SET first_name = ?, last_name = ?, phone = ?, email = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(
      firstName?.trim() || '',
      lastName?.trim() || null,
      normalizePhone(phone),
      email?.trim() || null,
      id
    );
    if (Array.isArray(tags)) {
      db.prepare('DELETE FROM contact_tags WHERE contact_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)');
      for (const tag of tags) {
        const t = String(tag).trim();
        if (t) insertTag.run(id, t);
      }
    }
  });
  trx();
  return getById(db, id);
}

function remove(db, id, advisor) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!row) return false;
  const tags = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ?').all(id).map(r => r.tag);
  const trash = require('../trash/service');
  trash.save(db, {
    entityType:    'contact',
    entityId:      id,
    entityName:    [row.first_name, row.last_name].filter(Boolean).join(' '),
    snapshot:      { ...row, tags },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  return db.prepare('DELETE FROM contacts WHERE id = ?').run(id).changes > 0;
}

// Importación bulk con detección de duplicados.
// dupePolicy: 'skip' | 'update' | 'create'
function importBulk(db, rows, { dupePolicy = 'skip', bulkTag = null } = {}) {
  const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

  const trx = db.transaction(() => {
    for (const r of rows) {
      const firstName = (r.firstName || '').trim();
      if (!firstName && !(r.lastName || '').trim()) {
        result.errors++;
        continue;
      }

      const dupe = findDuplicate(db, { phone: r.phone, email: r.email });
      if (dupe) {
        if (dupePolicy === 'skip') {
          result.skipped++;
          continue;
        }
        if (dupePolicy === 'update') {
          update(db, dupe.id, {
            firstName: firstName || dupe.first_name,
            lastName: r.lastName || dupe.last_name,
            phone: r.phone || dupe.phone,
            email: r.email || dupe.email,
            tags: undefined
          });
          if (bulkTag) {
            db.prepare('INSERT OR IGNORE INTO contact_tags (contact_id, tag) VALUES (?, ?)').run(dupe.id, bulkTag);
          }
          result.updated++;
          continue;
        }
        // dupePolicy === 'create' → cae al insert normal
      }

      const tags = bulkTag ? [bulkTag] : [];
      create(db, {
        firstName: firstName || (r.lastName || '').trim(),
        lastName: firstName ? r.lastName : '',
        phone: r.phone,
        email: r.email,
        tags
      });
      result.created++;
    }
  });
  trx();
  return result;
}

module.exports = { list, getById, create, update, remove, importBulk, findDuplicate, normalizePhone, isValidEmail };
