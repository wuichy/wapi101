const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
  }).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
    N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
  }).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(db, advisorId) {
  const token = generateToken();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 días
  db.prepare('INSERT INTO advisor_sessions (token, advisor_id, expires_at) VALUES (?, ?, ?)').run(token, advisorId, expiresAt);
  return token;
}

function getSession(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT s.advisor_id, s.expires_at, a.id, a.name, a.username, a.email, a.role, a.permissions, a.active, a.tenant_id
    FROM advisor_sessions s
    JOIN advisors a ON a.id = s.advisor_id
    WHERE s.token = ? AND s.expires_at > unixepoch()
  `).get(token);
  if (!row || !row.active) return null;
  return {
    id:          row.id,
    name:        row.name,
    username:    row.username,
    email:       row.email,
    role:        row.role,
    permissions: JSON.parse(row.permissions || '{}'),
    tenantId:    row.tenant_id,
  };
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM advisor_sessions WHERE token = ?').run(token);
}

function login(db, usernameOrEmail, password) {
  const advisor = db.prepare(
    'SELECT * FROM advisors WHERE (username = ? OR email = ?) AND active = 1'
  ).get(usernameOrEmail, usernameOrEmail);
  if (!advisor) return null;
  if (!verifyPassword(password, advisor.password_hash)) return null;
  return advisor;
}

function list(db) {
  return db.prepare('SELECT id, name, username, email, role, permissions, active, created_at FROM advisors ORDER BY id').all()
    .map(r => ({ ...r, permissions: JSON.parse(r.permissions || '{}') }));
}

function create(db, { name, username, email, password, role = 'asesor', permissions = {} }) {
  const defaultPerms = { write: true, delete: false, view_reports: false, manage_advisors: false };
  const perms = JSON.stringify({ ...defaultPerms, ...permissions });
  const hash = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO advisors (name, username, email, password_hash, role, permissions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, username, email || null, hash, role, perms);
  return db.prepare('SELECT id, name, username, email, role, permissions, active FROM advisors WHERE id = ?').get(result.lastInsertRowid);
}

function update(db, id, { name, username, email, password, role, permissions, active }) {
  const row = db.prepare('SELECT * FROM advisors WHERE id = ?').get(id);
  if (!row) throw new Error('Asesor no encontrado');

  const perms = permissions !== undefined
    ? JSON.stringify({ write: true, delete: false, view_reports: false, manage_advisors: false, ...permissions })
    : row.permissions;
  const hash = password ? hashPassword(password) : row.password_hash;

  db.prepare(`
    UPDATE advisors SET
      name = ?, username = ?, email = ?,
      password_hash = ?, role = ?, permissions = ?, active = ?
    WHERE id = ?
  `).run(
    name       ?? row.name,
    username   ?? row.username,
    email      !== undefined ? (email || null) : row.email,
    hash,
    role       ?? row.role,
    perms,
    active     !== undefined ? (active ? 1 : 0) : row.active,
    id,
  );
  return db.prepare('SELECT id, name, username, email, role, permissions, active FROM advisors WHERE id = ?').get(id);
}

function remove(db, id) {
  db.prepare('DELETE FROM advisors WHERE id = ?').run(id);
}

function ensureFirstAdmin(db, { name, username, password }) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM advisors').get().n;
  if (count === 0) {
    create(db, { name, username, password, role: 'admin', permissions: { write: true, delete: true, manage_advisors: true } });
    console.log(`[advisors] Admin inicial creado: ${username}`);
  }
}

module.exports = { login, createSession, getSession, deleteSession, list, create, update, remove, ensureFirstAdmin };
