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

// Login NO recibe tenantId — todavía es por username/email global. Cuando
// onboardée el 2do tenant, /api/auth/login aceptará un tenantSlug opcional
// (subdominio o input explícito) y filtrará por tenant aquí.
function login(db, usernameOrEmail, password) {
  const advisor = db.prepare(
    'SELECT * FROM advisors WHERE (username = ? OR email = ?) AND active = 1'
  ).get(usernameOrEmail, usernameOrEmail);
  if (!advisor) return null;
  if (!verifyPassword(password, advisor.password_hash)) return null;
  return advisor;
}

function list(db, tenantId) {
  return db.prepare('SELECT id, name, username, email, role, permissions, active, created_at FROM advisors WHERE tenant_id = ? ORDER BY id').all(tenantId)
    .map(r => ({ ...r, permissions: JSON.parse(r.permissions || '{}') }));
}

function create(db, tenantId, { name, username, email, password, role = 'asesor', permissions = {} }) {
  const defaultPerms = { write: true, delete: false, view_reports: false, manage_advisors: false };
  const perms = JSON.stringify({ ...defaultPerms, ...permissions });
  const hash = hashPassword(password);
  const result = db.prepare(`
    INSERT INTO advisors (tenant_id, name, username, email, password_hash, role, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(tenantId, name, username, email || null, hash, role, perms);
  return db.prepare('SELECT id, name, username, email, role, permissions, active FROM advisors WHERE id = ?').get(result.lastInsertRowid);
}

function update(db, tenantId, id, { name, username, email, password, role, permissions, active }) {
  const row = db.prepare('SELECT * FROM advisors WHERE id = ? AND tenant_id = ?').get(id, tenantId);
  if (!row) throw new Error('Asesor no encontrado');

  const perms = permissions !== undefined
    ? JSON.stringify({ write: true, delete: false, view_reports: false, manage_advisors: false, ...permissions })
    : row.permissions;
  const hash = password ? hashPassword(password) : row.password_hash;

  db.prepare(`
    UPDATE advisors SET
      name = ?, username = ?, email = ?,
      password_hash = ?, role = ?, permissions = ?, active = ?
    WHERE id = ? AND tenant_id = ?
  `).run(
    name       ?? row.name,
    username   ?? row.username,
    email      !== undefined ? (email || null) : row.email,
    hash,
    role       ?? row.role,
    perms,
    active     !== undefined ? (active ? 1 : 0) : row.active,
    id, tenantId,
  );
  return db.prepare('SELECT id, name, username, email, role, permissions, active FROM advisors WHERE id = ?').get(id);
}

function remove(db, tenantId, id) {
  db.prepare('DELETE FROM advisors WHERE id = ? AND tenant_id = ?').run(id, tenantId);
}

// ensureFirstAdmin: si la DB está vacía (cero advisors en cualquier tenant),
// crea el admin inicial en tenant 1 (Lucho). Solo se ejecuta al boot del server.
function ensureFirstAdmin(db, { name, username, password }) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM advisors').get().n;
  if (count === 0) {
    create(db, 1, { name, username, password, role: 'admin', permissions: { write: true, delete: true, manage_advisors: true } });
    console.log(`[advisors] Admin inicial creado: ${username}`);
  }
}

module.exports = { login, createSession, getSession, deleteSession, list, create, update, remove, ensureFirstAdmin };
