// Developers Platform — Service
// ============================================================================
// Gestiona cuentas de developers (separadas de advisors/tenants) y CRUD de apps.
// Auth via sessions con token `dev_xxxxxx` (prefijo para diferenciar de otros).

'use strict';

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, dkLen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  try {
    const attempt = crypto.scryptSync(password, salt, SCRYPT_PARAMS.dkLen, SCRYPT_PARAMS).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(attempt, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

function generateToken(prefix = 'dev_') {
  return prefix + crypto.randomBytes(32).toString('hex');
}

function generateClientId() {
  return 'wapi_app_' + crypto.randomBytes(16).toString('hex');
}

function generateClientSecret() {
  // Secret crudo (lo mostramos UNA VEZ al dev al crear; en DB guardamos solo el hash).
  return 'wapi_sk_' + crypto.randomBytes(32).toString('hex');
}

function generateWebhookSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('hex');
}

function slugify(name) {
  return String(name).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ─── Dev account auth ─────────────────────────────────────────────────────
function createAccount(db, { email, password, name, company, country }) {
  if (!email || !password || !name) throw new Error('email, password y name son requeridos');
  if (password.length < 8) throw new Error('Password mínimo 8 caracteres');

  email = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM dev_accounts WHERE email = ?').get(email);
  if (existing) throw new Error('Este email ya está registrado');

  const password_hash = hashPassword(password);
  const res = db.prepare(`
    INSERT INTO dev_accounts (email, password_hash, name, company, country)
    VALUES (?, ?, ?, ?, ?)
  `).run(email, password_hash, name.trim(), company || null, country || null);

  return getAccountById(db, res.lastInsertRowid);
}

function login(db, emailOrName, password) {
  if (!emailOrName || !password) return { error: 'CREDENTIALS_REQUIRED' };
  const acc = db.prepare('SELECT * FROM dev_accounts WHERE email = ?')
    .get(String(emailOrName).trim().toLowerCase());
  if (!acc) return { error: 'INVALID_CREDS' };
  if (!acc.active) return { error: 'ACCOUNT_DISABLED' };
  if (!verifyPassword(password, acc.password_hash)) return { error: 'INVALID_CREDS' };
  return { account: _publicAccount(acc) };
}

function createSession(db, devAccountId, ip, userAgent) {
  const token = generateToken('dev_');
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 días
  db.prepare(`
    INSERT INTO dev_sessions (token, dev_account_id, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, devAccountId, expiresAt, ip || null, userAgent || null);
  db.prepare('UPDATE dev_accounts SET last_login_at = unixepoch(), last_login_ip = ? WHERE id = ?')
    .run(ip || null, devAccountId);
  return { token, expiresAt };
}

function getSession(db, token) {
  if (!token || !token.startsWith('dev_')) return null;
  const row = db.prepare(`
    SELECT s.dev_account_id, s.expires_at, a.id, a.email, a.name, a.company, a.country, a.active, a.email_verified
      FROM dev_sessions s
      JOIN dev_accounts a ON a.id = s.dev_account_id
     WHERE s.token = ? AND s.expires_at > unixepoch()
  `).get(token);
  if (!row || !row.active) return null;
  return {
    id: row.id, email: row.email, name: row.name, company: row.company,
    country: row.country, emailVerified: !!row.email_verified,
  };
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM dev_sessions WHERE token = ?').run(token);
}

function getAccountById(db, id) {
  const row = db.prepare('SELECT * FROM dev_accounts WHERE id = ?').get(id);
  return row ? _publicAccount(row) : null;
}

function _publicAccount(row) {
  return {
    id: row.id, email: row.email, name: row.name, company: row.company,
    country: row.country, emailVerified: !!row.email_verified,
    createdAt: row.created_at, lastLoginAt: row.last_login_at,
  };
}

// ─── Apps CRUD ────────────────────────────────────────────────────────────
function createApp(db, devAccountId, { name, shortDescription, category, redirectUris, scopesRequested, webhookUrl, webhookEvents }) {
  if (!name) throw new Error('name es requerido');
  if (webhookUrl) require('../../security/ssrf').assertSafeUrlShape(webhookUrl); // anti-SSRF
  const baseSlug = slugify(name);
  if (!baseSlug) throw new Error('name inválido');

  // Generar slug único agregando sufijo si choca
  let slug = baseSlug, i = 1;
  while (db.prepare('SELECT id FROM apps WHERE slug = ?').get(slug)) {
    slug = `${baseSlug}-${++i}`;
  }

  const clientId = generateClientId();
  const clientSecret = generateClientSecret();
  const clientSecretHash = hashPassword(clientSecret);
  const webhookSecret = webhookUrl ? generateWebhookSecret() : null;

  const res = db.prepare(`
    INSERT INTO apps (
      dev_account_id, name, slug, short_description, client_id, client_secret_hash,
      redirect_uris, scopes_requested, webhook_url, webhook_secret, webhook_events, category
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    devAccountId, name.trim(), slug, shortDescription || null,
    clientId, clientSecretHash,
    JSON.stringify(redirectUris || []),
    JSON.stringify(scopesRequested || []),
    webhookUrl || null,
    webhookSecret,
    JSON.stringify(webhookEvents || []),
    category || null,
  );

  // Devolvemos el client_secret EN CLARO solo esta única vez.
  return {
    ...getAppById(db, res.lastInsertRowid, devAccountId),
    clientSecret, // ONLY shown here, never again
    webhookSecret, // also one-shot for setup
  };
}

function listApps(db, devAccountId) {
  return db.prepare(`
    SELECT id, name, slug, short_description, icon_url, client_id, category, status,
           is_public, webhook_url, created_at, updated_at,
           (SELECT COUNT(*) FROM dev_app_installs WHERE app_id = apps.id AND revoked_at IS NULL) AS install_count
      FROM apps
     WHERE dev_account_id = ?
     ORDER BY created_at DESC
  `).all(devAccountId);
}

function getAppById(db, id, devAccountId) {
  const row = db.prepare(`
    SELECT id, dev_account_id, name, slug, short_description, description, icon_url,
           client_id, redirect_uris, scopes_requested, webhook_url, webhook_events,
           homepage_url, privacy_policy_url, category, status, is_public,
           rejection_reason, suspended_reason, rate_limit_per_min, created_at, updated_at,
           (SELECT COUNT(*) FROM dev_app_installs WHERE app_id = apps.id AND revoked_at IS NULL) AS install_count
      FROM apps WHERE id = ?
  `).get(id);
  if (!row) return null;
  // Verificación de ownership — si se pasa devAccountId, debe coincidir
  if (devAccountId && row.dev_account_id !== devAccountId) return null;
  return {
    ...row,
    redirect_uris: _safeJsonArray(row.redirect_uris),
    scopes_requested: _safeJsonArray(row.scopes_requested),
    webhook_events: _safeJsonArray(row.webhook_events),
  };
}

function updateApp(db, id, devAccountId, patch) {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND dev_account_id = ?').get(id, devAccountId);
  if (!app) throw new Error('App no encontrada');
  if (patch.webhook_url) require('../../security/ssrf').assertSafeUrlShape(patch.webhook_url); // anti-SSRF

  const fields = [];
  const params = [];
  const allowed = ['name', 'short_description', 'description', 'icon_url', 'redirect_uris',
                   'scopes_requested', 'webhook_url', 'webhook_events', 'homepage_url',
                   'privacy_policy_url', 'category'];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    let v = patch[k];
    if (['redirect_uris', 'scopes_requested', 'webhook_events'].includes(k)) v = JSON.stringify(v || []);
    fields.push(`${k} = ?`);
    params.push(v);
  }
  if (!fields.length) return getAppById(db, id, devAccountId);
  fields.push('updated_at = unixepoch()');
  params.push(id);
  db.prepare(`UPDATE apps SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getAppById(db, id, devAccountId);
}

function deleteApp(db, id, devAccountId) {
  const r = db.prepare('DELETE FROM apps WHERE id = ? AND dev_account_id = ?').run(id, devAccountId);
  return r.changes > 0;
}

function regenerateSecret(db, id, devAccountId) {
  const app = db.prepare('SELECT id FROM apps WHERE id = ? AND dev_account_id = ?').get(id, devAccountId);
  if (!app) throw new Error('App no encontrada');
  const newSecret = generateClientSecret();
  const hash = hashPassword(newSecret);
  db.prepare('UPDATE apps SET client_secret_hash = ?, updated_at = unixepoch() WHERE id = ?').run(hash, id);
  // También invalidar todos los tokens emitidos a esta app
  db.prepare(`
    UPDATE app_oauth_tokens SET revoked_at = unixepoch()
     WHERE install_id IN (SELECT id FROM dev_app_installs WHERE app_id = ?)
       AND revoked_at IS NULL
  `).run(id);
  return { clientSecret: newSecret };
}

function submitForReview(db, id, devAccountId) {
  const app = db.prepare('SELECT * FROM apps WHERE id = ? AND dev_account_id = ?').get(id, devAccountId);
  if (!app) throw new Error('App no encontrada');
  if (!['draft', 'rejected'].includes(app.status)) {
    throw new Error(`No se puede enviar a revisión desde estado "${app.status}"`);
  }
  // Validaciones mínimas
  if (!app.short_description) throw new Error('Falta short_description');
  if (!app.description) throw new Error('Falta description');
  if (!app.icon_url) throw new Error('Falta icon_url');
  if (!app.homepage_url) throw new Error('Falta homepage_url');
  if (!app.privacy_policy_url) throw new Error('Falta privacy_policy_url');
  const redirects = _safeJsonArray(app.redirect_uris);
  if (!redirects.length) throw new Error('Falta al menos un redirect_uri');

  db.prepare(`UPDATE apps SET status='in_review', rejection_reason=NULL, updated_at=unixepoch() WHERE id=?`).run(id);
  return getAppById(db, id, devAccountId);
}

// ─── Instalaciones (vista del dev) ────────────────────────────────────────
function listInstallsForApp(db, appId, devAccountId) {
  // Verifica ownership de la app
  const own = db.prepare('SELECT id FROM apps WHERE id = ? AND dev_account_id = ?').get(appId, devAccountId);
  if (!own) return [];
  return db.prepare(`
    SELECT i.id, i.tenant_id, i.installed_at, i.revoked_at, t.display_name AS tenant_name
      FROM dev_app_installs i
      LEFT JOIN tenants t ON t.id = i.tenant_id
     WHERE i.app_id = ?
     ORDER BY i.installed_at DESC
  `).all(appId);
}

// ─── Audit log (vista del dev) ────────────────────────────────────────────
function listAuditLog(db, appId, devAccountId, limit = 100) {
  const own = db.prepare('SELECT id FROM apps WHERE id = ? AND dev_account_id = ?').get(appId, devAccountId);
  if (!own) return [];
  return db.prepare(`
    SELECT id, install_id, tenant_id, method, path, status_code, duration_ms, error_msg, created_at
      FROM app_audit_log
     WHERE app_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(appId, Math.min(limit, 500));
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function _safeJsonArray(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// ─── Catálogo de scopes disponibles ───────────────────────────────────────
// Sirve para mostrar al dev al crear app, y al cliente al instalar.
const AVAILABLE_SCOPES = [
  { key: 'tenant:read',       label: 'Leer información básica del CRM', sensitive: false },
  { key: 'leads:read',        label: 'Leer leads',                       sensitive: false },
  { key: 'leads:write',       label: 'Crear y modificar leads',          sensitive: true  },
  { key: 'contacts:read',     label: 'Leer contactos',                   sensitive: false },
  { key: 'contacts:write',    label: 'Crear y modificar contactos',      sensitive: true  },
  { key: 'messages:read',     label: 'Leer mensajes y conversaciones',   sensitive: true  },
  { key: 'messages:send',     label: 'Enviar mensajes',                  sensitive: true  },
  { key: 'bots:read',         label: 'Leer bots configurados',           sensitive: false },
  { key: 'bots:write',        label: 'Crear y modificar bots',           sensitive: true  },
  { key: 'appointments:read', label: 'Leer citas',                       sensitive: false },
  { key: 'appointments:write',label: 'Crear y modificar citas',          sensitive: true  },
  { key: 'pipelines:read',    label: 'Leer pipelines y etapas',          sensitive: false },
  { key: 'webhooks',          label: 'Recibir eventos vía webhook',      sensitive: false },
];

const AVAILABLE_WEBHOOK_EVENTS = [
  'lead.created', 'lead.updated', 'lead.stage_changed', 'lead.deleted',
  'contact.created', 'contact.updated',
  'message.received', 'message.sent', 'message.failed',
  'appointment.created', 'appointment.cancelled', 'appointment.rescheduled',
  'bot.run.started', 'bot.run.completed', 'bot.run.failed',
];

module.exports = {
  // password / token helpers
  hashPassword, verifyPassword, generateToken, generateClientId, generateClientSecret,
  // accounts
  createAccount, login, createSession, getSession, deleteSession, getAccountById,
  // apps
  createApp, listApps, getAppById, updateApp, deleteApp, regenerateSecret, submitForReview,
  // installs / audit
  listInstallsForApp, listAuditLog,
  // catalogs
  AVAILABLE_SCOPES, AVAILABLE_WEBHOOK_EVENTS,
};
