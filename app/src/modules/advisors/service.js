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
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const attempt = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, {
      N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p,
    }).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(attempt, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function createSession(db, advisorId, remember = false) {
  const token = generateToken();
  const days = remember ? 90 : 30; // "recuerda mi sesión" = 90 días; normal = 30
  const expiresAt = Math.floor(Date.now() / 1000) + days * 24 * 3600;
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

// Login multi-tenant.
//
// Modos:
//   - Con tenantSlug: resuelve tenant_id desde slug y filtra advisors por
//     tenant + username/email + active. Si el slug no existe → AMBIGUOUS_SLUG.
//   - Sin tenantSlug (legacy / single-tenant deploys): busca globalmente.
//     Si hay 1 solo match → OK. Si hay >1 → SLUG_REQUIRED (el caller debe
//     pedir tenantSlug). Mientras solo hay 1 tenant en el sistema, el flujo
//     legacy sigue funcionando sin cambios.
//
// Retorna:
//   { advisor }                      — login OK
//   { error: 'INVALID_CREDS' }       — credenciales inválidas (genérico para
//                                      no leakear si existe el usuario o no)
//   { error: 'SLUG_REQUIRED' }       — múltiples cuentas con ese username,
//                                      el caller debe pedir tenantSlug
function login(db, usernameOrEmail, password, tenantSlug = null) {
  let candidates;
  if (tenantSlug) {
    const tenant = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(tenantSlug);
    if (!tenant) return { error: 'INVALID_CREDS' }; // slug inexistente → genérico
    candidates = db.prepare(
      'SELECT * FROM advisors WHERE (username = ? OR email = ?) AND tenant_id = ? AND active = 1'
    ).all(usernameOrEmail, usernameOrEmail, tenant.id);
  } else {
    candidates = db.prepare(
      'SELECT * FROM advisors WHERE (username = ? OR email = ?) AND active = 1'
    ).all(usernameOrEmail, usernameOrEmail);
  }
  if (candidates.length === 0) return { error: 'INVALID_CREDS' };
  if (candidates.length > 1)  return { error: 'SLUG_REQUIRED' };
  const advisor = candidates[0];
  if (!verifyPassword(password, advisor.password_hash)) return { error: 'INVALID_CREDS' };
  return { advisor };
}

function list(db, tenantId) {
  return db.prepare('SELECT id, name, username, email, role, permissions, active, created_at FROM advisors WHERE tenant_id = ? ORDER BY id').all(tenantId)
    .map(r => ({ ...r, permissions: JSON.parse(r.permissions || '{}') }));
}

function create(db, tenantId, { name, username, email, password, role = 'asesor', permissions = {}, _skipPlanCheck = false }) {
  if (!_skipPlanCheck) {
    const tenant = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId);
    if (tenant?.plan === 'free') {
      const count = db.prepare('SELECT COUNT(*) AS n FROM advisors WHERE tenant_id = ? AND active = 1').get(tenantId).n;
      if (count >= 1) throw Object.assign(new Error('El plan Gratis solo permite 1 usuario. Actualiza tu plan para agregar más asesores.'), { code: 'PLAN_LIMIT' });
    }
  }
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

// ─── Password Reset ────────────────────────────────────────────
// Flow: usuario pide reset → generamos token plano (devuelto) + guardamos hash.
// El token expira en 1 hora. Único uso (se marca used_at al consumirse).

const RESET_TOKEN_TTL_SECS = 60 * 60; // 1 hora

function _hashToken(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

// Busca advisor por email (case-insensitive vía COLLATE NOCASE) y crea token.
// Devuelve { plainToken, advisor } o null si no existe el email (no leakeamos).
function requestPasswordReset(db, email, ipAddress = null, userAgent = null) {
  if (!email || typeof email !== 'string') return null;
  const advisor = db.prepare(
    'SELECT id, name, email, tenant_id, active FROM advisors WHERE email = ? AND active = 1 LIMIT 1'
  ).get(email.trim());
  if (!advisor) return null;

  // Invalidar tokens previos no usados de este advisor (anti reset-spam)
  db.prepare(
    "UPDATE password_reset_tokens SET used_at = unixepoch() WHERE advisor_id = ? AND used_at IS NULL"
  ).run(advisor.id);

  const plainToken = generateToken(); // 64 hex chars
  const tokenHash = _hashToken(plainToken);
  const expiresAt = Math.floor(Date.now() / 1000) + RESET_TOKEN_TTL_SECS;

  db.prepare(`
    INSERT INTO password_reset_tokens (advisor_id, tenant_id, token_hash, expires_at, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(advisor.id, advisor.tenant_id, tokenHash, expiresAt, ipAddress, userAgent);

  return { plainToken, advisor };
}

// Verifica si un token plano sigue siendo válido. Devuelve { advisor, tokenRow } o null.
function verifyResetToken(db, plainToken) {
  if (!plainToken || typeof plainToken !== 'string') return null;
  const tokenHash = _hashToken(plainToken);
  const row = db.prepare(`
    SELECT t.id, t.advisor_id, t.tenant_id, t.expires_at, t.used_at,
           a.id AS aid, a.name, a.email, a.username, a.active
    FROM password_reset_tokens t
    JOIN advisors a ON a.id = t.advisor_id
    WHERE t.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  if (row.used_at) return null;
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  if (!row.active) return null;
  return {
    tokenId:  row.id,
    advisor:  { id: row.aid, name: row.name, email: row.email, username: row.username, tenantId: row.tenant_id },
  };
}

// Aplica el cambio de password y marca token como usado.
// Invalida todas las sesiones existentes del advisor (por si alguien las robó).
function applyPasswordReset(db, plainToken, newPassword) {
  const verified = verifyResetToken(db, plainToken);
  if (!verified) return { error: 'INVALID_TOKEN' };
  if (!newPassword || newPassword.length < 8) return { error: 'WEAK_PASSWORD' };

  const newHash = hashPassword(newPassword);
  const tx = db.transaction(() => {
    db.prepare('UPDATE advisors SET password_hash = ? WHERE id = ?').run(newHash, verified.advisor.id);
    db.prepare('UPDATE password_reset_tokens SET used_at = unixepoch() WHERE id = ?').run(verified.tokenId);
    // Cerrar sesiones existentes para forzar re-login
    db.prepare('DELETE FROM advisor_sessions WHERE advisor_id = ?').run(verified.advisor.id);
  });
  tx();
  return { advisor: verified.advisor };
}

module.exports = {
  login, createSession, getSession, deleteSession,
  list, create, update, remove, ensureFirstAdmin,
  requestPasswordReset, verifyResetToken, applyPasswordReset,
};
