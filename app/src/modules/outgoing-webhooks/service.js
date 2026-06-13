const { encryptJson, decryptJson } = require('../../security/crypto');
const { assertSafeUrlShape } = require('../../security/ssrf');

function list(db, tenantId) {
  return db.prepare('SELECT * FROM outgoing_webhooks WHERE tenant_id = ? ORDER BY id DESC').all(tenantId).map(hydrate);
}

function getById(db, tenantId, id) {
  // SEGURIDAD: tenantId requerido (antes permitía null que bypassed multi-tenant isolation)
  if (tenantId == null) throw new Error('getById: tenantId requerido (no se permite bypass de tenant isolation)');
  const row = db.prepare('SELECT * FROM outgoing_webhooks WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  return row ? hydrate(row) : null;
}

function hydrate(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    events: JSON.parse(row.events || '[]'),
    active: !!row.active,
    hasSecret: !!row.secret_enc,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function create(db, tenantId, { name, url, events = [], secret, active = true }) {
  if (!url) throw new Error('La URL es obligatoria');
  assertSafeUrlShape(url); // anti-SSRF: http(s) + no IP/host interno
  const secretEnc = secret ? encryptJson({ secret }) : null;
  const eventsJson = JSON.stringify(Array.isArray(events) ? events : []);
  const r = db.prepare(`
    INSERT INTO outgoing_webhooks (tenant_id, name, url, events, active, secret_enc)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tenantId, name || 'Webhook', url, eventsJson, active ? 1 : 0, secretEnc);
  return getById(db, tenantId, r.lastInsertRowid);
}

function update(db, tenantId, id, { name, url, events, secret, active }) {
  const row = db.prepare('SELECT * FROM outgoing_webhooks WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Webhook no encontrado');

  const nextName = name !== undefined ? name : row.name;
  const nextUrl = url !== undefined ? url : row.url;
  const nextEvents = events !== undefined ? JSON.stringify(Array.isArray(events) ? events : []) : row.events;
  const nextActive = active !== undefined ? (active ? 1 : 0) : row.active;

  let nextSecretEnc = row.secret_enc;
  if (secret === null || secret === '') {
    nextSecretEnc = null;
  } else if (secret) {
    nextSecretEnc = encryptJson({ secret });
  }

  if (url !== undefined) assertSafeUrlShape(nextUrl); // anti-SSRF al cambiar la URL

  db.prepare(`
    UPDATE outgoing_webhooks
    SET name = ?, url = ?, events = ?, active = ?, secret_enc = ?, updated_at = unixepoch()
    WHERE id = ? AND tenant_id = ?
  `).run(nextName, nextUrl, nextEvents, nextActive, nextSecretEnc, id, tenantId);
  return getById(db, tenantId, id);
}

function remove(db, tenantId, id) {
  return db.prepare('DELETE FROM outgoing_webhooks WHERE id = ? AND tenant_id = ?').run(id, tenantId).changes > 0;
}

module.exports = { list, getById, create, update, remove };
