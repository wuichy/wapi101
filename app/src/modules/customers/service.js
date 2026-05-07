// Lógica de clientes (contactos). Expone funciones puras que reciben `db` + `tenantId`.
// Las rutas HTTP viven en routes.js — este archivo no sabe de Express.
//
// Convención multi-tenant: todas las funciones públicas reciben tenantId como
// segundo argumento (después de db) y filtran/stampan en todas las queries.
// Esto evita que un advisor del tenant A vea/edite datos del tenant B.

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
function hydrate(db, tenantId, row) {
  if (!row) return null;
  const tags = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ? ORDER BY id').all(row.id, tenantId).map((r) => r.tag);
  const expedients = db.prepare(`
    SELECT e.id, e.name, e.value, e.pipeline_id, e.stage_id,
           p.name AS pipeline_name, p.color AS pipeline_color,
           s.name AS stage_name, s.color AS stage_color, s.kind AS stage_kind
    FROM expedients e
    JOIN pipelines p ON p.id = e.pipeline_id
    JOIN stages s ON s.id = e.stage_id
    WHERE e.contact_id = ? AND e.tenant_id = ?
    ORDER BY e.created_at DESC
  `).all(row.id, tenantId);

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
       WHERE cfv.entity = 'expedient' AND cfv.tenant_id = ? AND cfv.record_id IN (${placeholders})
    `).all(tenantId, ...expIds);
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
    avatarUrl: row.avatar_url || null,
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
  expedientCount:  '(SELECT COUNT(*) FROM expedients WHERE expedients.contact_id = contacts.id AND expedients.tenant_id = contacts.tenant_id)'
};

function list(db, tenantId, { search, page = 1, pageSize = 50, sortBy = 'createdAt', sortDir = 'desc' } = {}) {
  // Sanitiza paginación
  const allowedSizes = [10, 25, 50, 100, 200];
  pageSize = allowedSizes.includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);

  // ─── Modo especial: solo duplicados ───
  if (sortBy === 'duplicates') {
    return _listDuplicates(db, tenantId, { search, page, pageSize });
  }

  // Sanitiza sort (whitelist + dir)
  const sortExpr = SORTABLE[sortBy] || SORTABLE.createdAt;
  const dir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderBy = `${sortExpr} ${dir}, id DESC`;

  let countRow, rows;
  if (search) {
    const q = `%${search.toLowerCase()}%`;
    const where = `
      WHERE tenant_id = ?
        AND (LOWER(first_name) LIKE ?
         OR LOWER(IFNULL(last_name, '')) LIKE ?
         OR LOWER(IFNULL(phone, '')) LIKE ?
         OR LOWER(IFNULL(email, '')) LIKE ?)
    `;
    countRow = db.prepare(`SELECT COUNT(*) AS n FROM contacts ${where}`).get(tenantId, q, q, q, q);
    rows = db.prepare(`SELECT * FROM contacts ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(tenantId, q, q, q, q, pageSize, (page - 1) * pageSize);
  } else {
    countRow = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?').get(tenantId);
    rows = db.prepare(`SELECT * FROM contacts WHERE tenant_id = ? ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(tenantId, pageSize, (page - 1) * pageSize);
  }

  return {
    items: rows.map((r) => hydrate(db, tenantId, r)),
    total: countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
    sortBy: SORTABLE[sortBy] ? sortBy : 'createdAt',
    sortDir: dir.toLowerCase()
  };
}

// Devuelve solo contactos que comparten teléfono (normalizado) o email con
// otro contacto del MISMO tenant. Cross-tenant no cuenta como duplicado.
function _listDuplicates(db, tenantId, { search, page, pageSize }) {
  const dupQuery = `
    SELECT c.*,
           LOWER(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(c.phone, ''), '+', ''), ' ', ''), '-', ''), '(', '')) AS phone_norm,
           LOWER(TRIM(IFNULL(c.email, ''))) AS email_norm
      FROM contacts c
     WHERE c.tenant_id = ?
       AND (
       (LOWER(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(c.phone, ''), '+', ''), ' ', ''), '-', ''), '(', '')) <> '' AND
        LOWER(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(c.phone, ''), '+', ''), ' ', ''), '-', ''), '(', '')) IN (
         SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''))
           FROM contacts
          WHERE tenant_id = ? AND IFNULL(phone, '') <> ''
          GROUP BY LOWER(REPLACE(REPLACE(REPLACE(REPLACE(IFNULL(phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''))
         HAVING COUNT(*) > 1
       )
     ) OR (
       LOWER(TRIM(IFNULL(c.email, ''))) <> '' AND
       LOWER(TRIM(IFNULL(c.email, ''))) IN (
         SELECT LOWER(TRIM(IFNULL(email, '')))
           FROM contacts
          WHERE tenant_id = ? AND IFNULL(email, '') <> ''
          GROUP BY LOWER(TRIM(IFNULL(email, '')))
         HAVING COUNT(*) > 1
       )
     ))
  `;
  let allDupes = db.prepare(dupQuery).all(tenantId, tenantId, tenantId);
  if (search) {
    const q = String(search).toLowerCase();
    allDupes = allDupes.filter(c =>
      (c.first_name || '').toLowerCase().includes(q) ||
      (c.last_name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }
  allDupes.sort((a, b) => {
    if (a.phone_norm !== b.phone_norm) return a.phone_norm.localeCompare(b.phone_norm);
    if (a.email_norm !== b.email_norm) return a.email_norm.localeCompare(b.email_norm);
    return (b.created_at || 0) - (a.created_at || 0);
  });

  const total = allDupes.length;
  const start = (page - 1) * pageSize;
  const pageRows = allDupes.slice(start, start + pageSize);

  return {
    items: pageRows.map((r) => hydrate(db, tenantId, r)),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sortBy: 'duplicates',
    sortDir: 'desc',
  };
}

function getById(db, tenantId, id) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  return hydrate(db, tenantId, row);
}

// Busca duplicado por phone normalizado o email lowercased — siempre dentro del mismo tenant
function findDuplicate(db, tenantId, { phone, email }) {
  const normPhone = normalizePhone(phone);
  const normEmail = email ? email.trim().toLowerCase() : null;
  if (!normPhone && !normEmail) return null;

  const rows = db.prepare(`
    SELECT * FROM contacts
    WHERE tenant_id = ?
      AND ((? IS NOT NULL AND phone = ?)
       OR (? IS NOT NULL AND LOWER(email) = ?))
    LIMIT 1
  `).all(tenantId, normPhone, normPhone, normEmail, normEmail);
  return rows[0] || null;
}

function create(db, tenantId, { firstName, lastName, phone, email, tags = [] }) {
  if (!firstName || !firstName.trim()) {
    throw new Error('El nombre es obligatorio');
  }
  const trx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO contacts (tenant_id, first_name, last_name, phone, email)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      tenantId,
      firstName.trim(),
      lastName?.trim() || null,
      normalizePhone(phone),
      email?.trim() || null
    );
    const id = result.lastInsertRowid;
    const insertTag = db.prepare('INSERT OR IGNORE INTO contact_tags (tenant_id, contact_id, tag) VALUES (?, ?, ?)');
    for (const tag of tags) {
      const t = String(tag).trim();
      if (t) insertTag.run(tenantId, id, t);
    }
    return id;
  });
  const id = trx();
  return getById(db, tenantId, id);
}

function update(db, tenantId, id, { firstName, lastName, phone, email, tags }) {
  const trx = db.transaction(() => {
    const r = db.prepare(`
      UPDATE contacts
      SET first_name = ?, last_name = ?, phone = ?, email = ?, updated_at = unixepoch()
      WHERE id = ? AND tenant_id = ?
    `).run(
      firstName?.trim() || '',
      lastName?.trim() || null,
      normalizePhone(phone),
      email?.trim() || null,
      id,
      tenantId
    );
    if (r.changes === 0) return false; // contacto no existe o no pertenece al tenant
    if (Array.isArray(tags)) {
      db.prepare('DELETE FROM contact_tags WHERE contact_id = ? AND tenant_id = ?').run(id, tenantId);
      const insertTag = db.prepare('INSERT OR IGNORE INTO contact_tags (tenant_id, contact_id, tag) VALUES (?, ?, ?)');
      for (const tag of tags) {
        const t = String(tag).trim();
        if (t) insertTag.run(tenantId, id, t);
      }
    }
    return true;
  });
  const ok = trx();
  return ok ? getById(db, tenantId, id) : null;
}

function remove(db, tenantId, id, advisor) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) return false;
  const tags = db.prepare('SELECT tag FROM contact_tags WHERE contact_id = ? AND tenant_id = ?').all(id, tenantId).map(r => r.tag);
  const trash = require('../trash/service');
  trash.save(db, tenantId, {
    entityType:    'contact',
    entityId:      id,
    entityName:    [row.first_name, row.last_name].filter(Boolean).join(' '),
    snapshot:      { ...row, tags },
    deletedById:   advisor?.id,
    deletedByName: advisor?.name,
  });
  return db.prepare('DELETE FROM contacts WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes > 0;
}

// Importación bulk con detección de duplicados.
// dupePolicy: 'skip' | 'update' | 'create'
function importBulk(db, tenantId, rows, { dupePolicy = 'skip', bulkTag = null } = {}) {
  const result = { created: 0, updated: 0, skipped: 0, errors: 0 };

  const trx = db.transaction(() => {
    for (const r of rows) {
      const firstName = (r.firstName || '').trim();
      if (!firstName && !(r.lastName || '').trim()) {
        result.errors++;
        continue;
      }

      const dupe = findDuplicate(db, tenantId, { phone: r.phone, email: r.email });
      if (dupe) {
        if (dupePolicy === 'skip') {
          result.skipped++;
          continue;
        }
        if (dupePolicy === 'update') {
          update(db, tenantId, dupe.id, {
            firstName: firstName || dupe.first_name,
            lastName: r.lastName || dupe.last_name,
            phone: r.phone || dupe.phone,
            email: r.email || dupe.email,
            tags: undefined
          });
          if (bulkTag) {
            db.prepare('INSERT OR IGNORE INTO contact_tags (tenant_id, contact_id, tag) VALUES (?, ?, ?)').run(tenantId, dupe.id, bulkTag);
          }
          result.updated++;
          continue;
        }
        // dupePolicy === 'create' → cae al insert normal
      }

      const tags = bulkTag ? [bulkTag] : [];
      create(db, tenantId, {
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

// Setea el avatar de un contacto. Llamado por webhooks (sync con FB/IG profile_pic)
// y por endpoint manual del frontend. Idempotente: no actualiza si la URL es la misma.
function setAvatar(db, tenantId, contactId, avatarUrl) {
  if (!contactId || !avatarUrl) return false;
  const row = db.prepare('SELECT avatar_url FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, tenantId);
  if (!row) return false;
  if (row.avatar_url === avatarUrl) return false;
  db.prepare('UPDATE contacts SET avatar_url = ?, avatar_updated_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
    .run(avatarUrl, contactId, tenantId);
  return true;
}

module.exports = { list, getById, create, update, remove, importBulk, findDuplicate, normalizePhone, isValidEmail, setAvatar };
