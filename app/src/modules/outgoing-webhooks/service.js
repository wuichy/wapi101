const { encryptJson, decryptJson } = require('../../security/crypto');

function list(db) {
  return db.prepare('SELECT * FROM outgoing_webhooks ORDER BY id DESC').all().map(hydrate);
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM outgoing_webhooks WHERE id = ?').get(id);
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

function create(db, { name, url, events = [], secret, active = true }) {
  if (!url) throw new Error('La URL es obligatoria');
  if (!url.startsWith('http://') && !url.startsWith('https://')) throw new Error('La URL debe empezar con http:// o https://');
  const secretEnc = secret ? encryptJson({ secret }) : null;
  const eventsJson = JSON.stringify(Array.isArray(events) ? events : []);
  const r = db.prepare(`
    INSERT INTO outgoing_webhooks (name, url, events, active, secret_enc)
    VALUES (?, ?, ?, ?, ?)
  `).run(name || 'Webhook', url, eventsJson, active ? 1 : 0, secretEnc);
  return getById(db, r.lastInsertRowid);
}

function update(db, id, { name, url, events, secret, active }) {
  const row = db.prepare('SELECT * FROM outgoing_webhooks WHERE id = ?').get(id);
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

  if (nextUrl && !nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
    throw new Error('La URL debe empezar con http:// o https://');
  }

  db.prepare(`
    UPDATE outgoing_webhooks
    SET name = ?, url = ?, events = ?, active = ?, secret_enc = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(nextName, nextUrl, nextEvents, nextActive, nextSecretEnc, id);
  return getById(db, id);
}

function remove(db, id) {
  return db.prepare('DELETE FROM outgoing_webhooks WHERE id = ?').run(id).changes > 0;
}

module.exports = { list, getById, create, update, remove };
