// Servicio super-admin: gestiona super_admins (auth) y tenants (CRUD).
// Los super-admins son independientes de advisors — su login va por /super,
// sus tokens tienen prefijo "sa_" y NO atraviesan la auth multi-tenant.

const crypto = require('crypto');

// PBKDF2 — mismo algoritmo que advisors/service.js para consistencia.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 100_000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.pbkdf2Sync(String(password), salt, 100_000, 32, 'sha256').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(test));
}
function generateToken() {
  return 'sa_' + crypto.randomBytes(24).toString('hex');
}

// ─── Auth ───
function login(db, usernameOrEmail, password) {
  const row = db.prepare(
    'SELECT * FROM super_admins WHERE (username = ? OR email = ?) AND active = 1'
  ).get(usernameOrEmail, usernameOrEmail);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return row;
}

function createSession(db, superAdminId, { ip, userAgent } = {}) {
  const token = generateToken();
  // Sesiones cortas para super-admin: 8h. Operaciones cross-tenant son sensibles.
  const expiresAt = Math.floor(Date.now() / 1000) + 8 * 3600;
  db.prepare(
    'INSERT INTO super_admin_sessions (token, super_admin_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)'
  ).run(token, superAdminId, expiresAt, ip || null, userAgent || null);
  db.prepare('UPDATE super_admins SET last_login_at = unixepoch(), last_login_ip = ? WHERE id = ?')
    .run(ip || null, superAdminId);
  return token;
}

function getSession(db, token) {
  if (!token || !token.startsWith('sa_')) return null;
  const row = db.prepare(`
    SELECT s.super_admin_id, s.expires_at, sa.id, sa.username, sa.email, sa.name, sa.active
      FROM super_admin_sessions s
      JOIN super_admins sa ON sa.id = s.super_admin_id
     WHERE s.token = ? AND s.expires_at > unixepoch()
  `).get(token);
  if (!row || !row.active) return null;
  return { id: row.id, username: row.username, email: row.email, name: row.name };
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM super_admin_sessions WHERE token = ?').run(token);
}

function ensureFirstSuperAdmin(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM super_admins').get().n;
  if (count > 0) return;
  // Lee credenciales del .env. Si no están, no crea nada — el user las
  // configura más tarde y reinicia.
  const username = process.env.SUPER_ADMIN_USERNAME || '';
  const password = process.env.SUPER_ADMIN_PASSWORD || '';
  const name     = process.env.SUPER_ADMIN_NAME     || 'Super Admin';
  if (!username || !password) {
    console.warn('[super] No hay super-admin. Configura SUPER_ADMIN_USERNAME y SUPER_ADMIN_PASSWORD en .env y reinicia.');
    return;
  }
  const hash = hashPassword(password);
  db.prepare(
    'INSERT INTO super_admins (username, password_hash, name) VALUES (?, ?, ?)'
  ).run(username.trim(), hash, name);
  console.log(`[super] Super-admin inicial creado: ${username}`);
}

// ─── Tenants CRUD ───

function listTenants(db) {
  // Devuelve cada tenant con stats agregadas (counts) para el panel.
  const tenants = db.prepare('SELECT * FROM tenants ORDER BY id').all();
  return tenants.map(t => {
    const stats = {
      contacts:      db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?').get(t.id).n,
      conversations: db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?').get(t.id).n,
      messages:      db.prepare('SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?').get(t.id).n,
      bots:          db.prepare('SELECT COUNT(*) AS n FROM salsbots WHERE tenant_id = ?').get(t.id).n,
      integrations:  db.prepare("SELECT COUNT(*) AS n FROM integrations WHERE tenant_id = ? AND status = 'connected'").get(t.id).n,
      advisors:      db.prepare('SELECT COUNT(*) AS n FROM advisors WHERE tenant_id = ? AND active = 1').get(t.id).n,
      lastMessageAt: db.prepare('SELECT MAX(last_message_at) AS m FROM conversations WHERE tenant_id = ?').get(t.id).m || null,
    };
    return {
      id: t.id,
      slug: t.slug,
      displayName: t.display_name,
      status: t.status,
      plan: t.plan,
      meta: (() => { try { return JSON.parse(t.meta_json || '{}'); } catch { return {}; } })(),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      stats,
    };
  });
}

function getTenant(db, id) {
  const t = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  if (!t) return null;
  return {
    id: t.id,
    slug: t.slug,
    displayName: t.display_name,
    status: t.status,
    plan: t.plan,
    meta: (() => { try { return JSON.parse(t.meta_json || '{}'); } catch { return {}; } })(),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// Crea un tenant nuevo + su primer advisor admin.
// Devuelve { tenant, adminCredentials: { username, password } } — el password
// se muestra UNA vez al super-admin para que se lo dé al cliente.
function createTenant(db, { slug, displayName, plan = 'free', adminName, adminUsername, adminEmail, adminPassword }) {
  if (!slug || !slug.trim()) throw new Error('Slug requerido');
  if (!displayName || !displayName.trim()) throw new Error('Nombre del tenant requerido');
  if (!adminUsername || !adminUsername.trim()) throw new Error('Username del admin requerido');

  const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(cleanSlug)) {
    throw new Error('Slug inválido (solo letras/números/guiones, 2-40 chars, no empieza con guión)');
  }

  // Verificar que el slug no exista
  if (db.prepare('SELECT id FROM tenants WHERE slug = ?').get(cleanSlug)) {
    throw new Error(`Ya existe un tenant con slug "${cleanSlug}"`);
  }

  // Generar password si no vino — el super-admin lo verá una vez
  const finalPassword = adminPassword && adminPassword.length >= 6
    ? adminPassword
    : crypto.randomBytes(8).toString('base64').replace(/[+/=]/g, '').slice(0, 12);

  const advisorService = require('../advisors/service');

  let createdTenantId, createdAdvisor;
  const trx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO tenants (slug, display_name, status, plan)
      VALUES (?, ?, 'trial', ?)
    `).run(cleanSlug, displayName.trim(), plan);
    createdTenantId = r.lastInsertRowid;

    // Crear advisor admin para el nuevo tenant
    createdAdvisor = advisorService.create(db, createdTenantId, {
      name: adminName?.trim() || displayName.trim(),
      username: adminUsername.trim(),
      email: adminEmail?.trim() || null,
      password: finalPassword,
      role: 'admin',
      permissions: { write: true, delete: true, view_reports: true, manage_advisors: true },
    });
  });
  trx();

  return {
    tenant: getTenant(db, createdTenantId),
    adminCredentials: {
      username: createdAdvisor.username,
      password: finalPassword,
    },
  };
}

function updateTenant(db, id, { displayName, status, plan, meta }) {
  const row = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id);
  if (!row) throw new Error('Tenant no encontrado');

  const allowedStatus = ['active', 'suspended', 'trial', 'cancelled'];
  if (status && !allowedStatus.includes(status)) {
    throw new Error(`Estado inválido. Permitidos: ${allowedStatus.join(', ')}`);
  }

  const fields = [];
  const params = [];
  if (displayName !== undefined) { fields.push('display_name = ?'); params.push(displayName.trim() || row.display_name); }
  if (status !== undefined)      { fields.push('status = ?');       params.push(status); }
  if (plan !== undefined)        { fields.push('plan = ?');         params.push(plan); }
  if (meta !== undefined)        { fields.push('meta_json = ?');    params.push(JSON.stringify(meta || {})); }
  if (!fields.length) return getTenant(db, id);
  fields.push('updated_at = unixepoch()');
  params.push(id);
  db.prepare(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`).run(...params);

  // Invalidar cache del auth middleware si cambió status
  try {
    const { invalidateTenantCache } = require('../../middleware/auth');
    invalidateTenantCache(id);
  } catch (_) {}

  return getTenant(db, id);
}

// Borrado lógico: solo cancela. El borrado físico (con cascada de datos)
// requeriría una operación destructiva — se deja para Fase futura con confirmación
// extra (ej. tipear el slug del tenant).
function cancelTenant(db, id) {
  return updateTenant(db, id, { status: 'cancelled' });
}

// Genera un token de sesión de advisor regular para el admin del tenant
// destino, de modo que el super-admin pueda "entrar como" ese tenant
// usando la UI normal. Se emite un token de corta duración (1 hora).
function impersonate(db, tenantId, superAdminId) {
  const tenant = db.prepare('SELECT id, slug, display_name FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error('Tenant no encontrado');

  // Buscar un advisor admin activo del tenant (preferentemente el más antiguo,
  // que suele ser el creador). Si no hay, error — el super-admin debe crear uno.
  const admin = db.prepare(`
    SELECT id, name, username, email, role, permissions
      FROM advisors
     WHERE tenant_id = ? AND active = 1 AND role = 'admin'
     ORDER BY id ASC
     LIMIT 1
  `).get(tenantId);
  if (!admin) throw new Error('Este tenant no tiene un admin activo. Crea uno primero.');

  const advisorService = require('../advisors/service');
  const token = advisorService.createSession(db, admin.id);

  // Reducir el TTL de la sesión impersonada a 1 hora (default es 30 días).
  // Esto la hace "tocar y soltar" — el super-admin no debe quedarse logueado
  // como tenant indefinidamente.
  const oneHour = Math.floor(Date.now() / 1000) + 3600;
  db.prepare('UPDATE advisor_sessions SET expires_at = ? WHERE token = ?').run(oneHour, token);

  // Audit log: quedar registro de quién impersonó a quién y cuándo.
  console.log(`[super] super-admin ${superAdminId} impersonó tenant ${tenant.slug} como advisor ${admin.username}`);

  return {
    token,
    tenant: { id: tenant.id, slug: tenant.slug, displayName: tenant.display_name },
    advisor: { id: admin.id, name: admin.name, username: admin.username, role: admin.role, permissions: JSON.parse(admin.permissions || '{}'), tenantId },
    expiresAt: oneHour,
  };
}

module.exports = {
  login, createSession, getSession, deleteSession, ensureFirstSuperAdmin,
  listTenants, getTenant, createTenant, updateTenant, cancelTenant, impersonate,
};
