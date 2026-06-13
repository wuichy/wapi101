// OAuth 2.0 Server — Service
// ============================================================================
// Implementa el flow authorization_code estándar + refresh_token rotation.
//
// Flow:
//   1) App redirige cliente a /oauth/authorize?client_id=X&redirect_uri=...&scope=...&state=...
//   2) Cliente (logueado como advisor de su tenant) ve pantalla de consent
//      con permisos pedidos. Acepta.
//   3) Wapi101 genera un `code` y redirige a redirect_uri?code=X&state=Y
//   4) App canjea code por tokens vía POST /oauth/token (Basic auth con client_id:secret)
//   5) Recibe { access_token (TTL 1h), refresh_token (TTL 90d), scope, expires_in }
//   6) Usa access_token en Authorization: Bearer X para llamar /api/*

'use strict';

const crypto = require('crypto');
const devService = require('../developers/service');

const CODE_TTL_SECS    = 10 * 60;       // 10 min
const ACCESS_TTL_SECS  = 60 * 60;       // 1 hora
const REFRESH_TTL_SECS = 90 * 24 * 3600; // 90 días

function generateOpaque(prefix = '') {
  return prefix + crypto.randomBytes(32).toString('hex');
}

// Hash de tokens opacos (sha256). Se guarda el HASH en app_oauth_tokens, nunca
// el token en claro. Dual-read en verify/exchange para no romper tokens legacy.
function _hashTok(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

// ─── Authorization (paso 3) ──────────────────────────────────────────────
// Llamado cuando el advisor (cliente) acepta el consent. Genera un code
// de 10 min que la app canjea por tokens.
function issueCode(db, { appId, tenantId, advisorId, redirectUri, scopes, state }) {
  const code = generateOpaque('wapi_code_');
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL_SECS;
  db.prepare(`
    INSERT INTO app_oauth_codes (code, app_id, tenant_id, advisor_id, redirect_uri, scopes, state, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, appId, tenantId, advisorId, redirectUri, JSON.stringify(scopes || []), state || null, expiresAt);
  return { code, expiresAt };
}

// ─── Token endpoint — exchange code → tokens ────────────────────────────
function exchangeCodeForTokens(db, { clientId, clientSecret, code, redirectUri }) {
  // 1. Validar app
  const app = db.prepare('SELECT * FROM apps WHERE client_id = ?').get(clientId);
  if (!app) throw new Error('invalid_client');
  if (app.status === 'suspended') throw new Error('app_suspended');
  if (!devService.verifyPassword(clientSecret, app.client_secret_hash)) {
    throw new Error('invalid_client');
  }

  // 2. Validar code
  const codeRow = db.prepare('SELECT * FROM app_oauth_codes WHERE code = ?').get(code);
  if (!codeRow) throw new Error('invalid_grant');
  if (codeRow.used) throw new Error('invalid_grant');
  if (codeRow.expires_at <= Math.floor(Date.now() / 1000)) throw new Error('invalid_grant');
  if (codeRow.app_id !== app.id) throw new Error('invalid_grant');
  if (codeRow.redirect_uri !== redirectUri) throw new Error('invalid_grant');

  // 3. Marcar code como usado
  db.prepare('UPDATE app_oauth_codes SET used = 1, used_at = unixepoch() WHERE code = ?').run(code);

  // 4. Find or create install
  let install = db.prepare('SELECT id FROM dev_app_installs WHERE app_id = ? AND tenant_id = ?')
    .get(app.id, codeRow.tenant_id);
  if (install && install.revoked_at) {
    // Re-activar instalación previamente revocada
    db.prepare('UPDATE dev_app_installs SET revoked_at = NULL, revoked_reason = NULL, installed_at = unixepoch(), scopes_granted = ? WHERE id = ?')
      .run(codeRow.scopes, install.id);
  } else if (!install) {
    const r = db.prepare(`
      INSERT INTO dev_app_installs (app_id, tenant_id, installed_by_advisor_id, scopes_granted)
      VALUES (?, ?, ?, ?)
    `).run(app.id, codeRow.tenant_id, codeRow.advisor_id, codeRow.scopes);
    install = { id: r.lastInsertRowid };
  }

  // 5. Emit tokens
  return _issueTokenPair(db, install.id, JSON.parse(codeRow.scopes || '[]'));
}

// ─── Refresh token ───────────────────────────────────────────────────────
// Rotate: invalida el viejo refresh, emite par nuevo. Práctica estándar.
function exchangeRefreshToken(db, { clientId, clientSecret, refreshToken }) {
  const app = db.prepare('SELECT * FROM apps WHERE client_id = ?').get(clientId);
  if (!app) throw new Error('invalid_client');
  if (app.status === 'suspended') throw new Error('app_suspended');
  if (!devService.verifyPassword(clientSecret, app.client_secret_hash)) {
    throw new Error('invalid_client');
  }

  const tokenRow = db.prepare('SELECT * FROM app_oauth_tokens WHERE refresh_token = ? OR refresh_token = ?').get(_hashTok(refreshToken), refreshToken);
  if (!tokenRow) throw new Error('invalid_grant');
  if (tokenRow.revoked_at) throw new Error('invalid_grant');
  if (tokenRow.refresh_expires_at <= Math.floor(Date.now() / 1000)) throw new Error('invalid_grant');

  // Verificar que el install no esté revocado y pertenezca a esta app
  const install = db.prepare('SELECT * FROM dev_app_installs WHERE id = ?').get(tokenRow.install_id);
  if (!install || install.revoked_at || install.app_id !== app.id) {
    throw new Error('invalid_grant');
  }

  // Rotación: invalidar el token actual
  db.prepare('UPDATE app_oauth_tokens SET revoked_at = unixepoch() WHERE token = ?').run(tokenRow.token);

  return _issueTokenPair(db, install.id, JSON.parse(tokenRow.scopes || '[]'));
}

// ─── Token validation (middleware-friendly) ─────────────────────────────
// Llamado desde el middleware que protege /api/* cuando se usa Bearer wapi_at_...
function verifyAccessToken(db, accessToken) {
  if (!accessToken) return null;
  const row = db.prepare(`
    SELECT t.*, i.app_id, i.tenant_id, i.installed_by_advisor_id, i.revoked_at AS install_revoked,
           a.status AS app_status, a.rate_limit_per_min, a.name AS app_name
      FROM app_oauth_tokens t
      JOIN dev_app_installs i ON i.id = t.install_id
      JOIN apps a ON a.id = i.app_id
     WHERE t.token = ? OR t.token = ?
  `).get(_hashTok(accessToken), accessToken);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.install_revoked) return null;
  if (row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  if (row.app_status === 'suspended') return null;
  // Toca last_used (best-effort) — usa el valor REAL de la fila (ya hasheado).
  try { db.prepare('UPDATE app_oauth_tokens SET last_used_at = unixepoch() WHERE token = ?').run(row.token); } catch {}
  return {
    tokenId:   row.token,
    installId: row.install_id,
    appId:     row.app_id,
    appName:   row.app_name,
    tenantId:  row.tenant_id,
    advisorId: row.installed_by_advisor_id,
    scopes:    JSON.parse(row.scopes || '[]'),
    rateLimit: row.rate_limit_per_min,
    expiresAt: row.expires_at,
  };
}

// ─── Revoke (uninstall / logout app) ────────────────────────────────────
function revokeToken(db, accessTokenOrRefresh) {
  const h = _hashTok(accessTokenOrRefresh);
  const stmt = db.prepare(`
    UPDATE app_oauth_tokens SET revoked_at = unixepoch()
     WHERE (token = ? OR refresh_token = ? OR token = ? OR refresh_token = ?) AND revoked_at IS NULL
  `);
  const r = stmt.run(h, h, accessTokenOrRefresh, accessTokenOrRefresh);
  return r.changes > 0;
}

function revokeInstall(db, installId, reason) {
  db.prepare('UPDATE dev_app_installs SET revoked_at = unixepoch(), revoked_reason = ? WHERE id = ? AND revoked_at IS NULL')
    .run(reason || null, installId);
  // Revocar todos los tokens activos de este install
  db.prepare('UPDATE app_oauth_tokens SET revoked_at = unixepoch() WHERE install_id = ? AND revoked_at IS NULL')
    .run(installId);
}

// ─── Helpers ────────────────────────────────────────────────────────────
function _issueTokenPair(db, installId, scopes) {
  const accessToken  = generateOpaque('wapi_at_');
  const refreshToken = generateOpaque('wapi_rt_');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt        = now + ACCESS_TTL_SECS;
  const refreshExpiresAt = now + REFRESH_TTL_SECS;
  // Guardar el HASH de ambos tokens, nunca en claro.
  db.prepare(`
    INSERT INTO app_oauth_tokens (token, refresh_token, install_id, scopes, expires_at, refresh_expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(_hashTok(accessToken), _hashTok(refreshToken), installId, JSON.stringify(scopes), expiresAt, refreshExpiresAt);
  return {
    access_token:  accessToken,
    refresh_token: refreshToken,
    token_type:    'Bearer',
    expires_in:    ACCESS_TTL_SECS,
    scope:         scopes.join(' '),
  };
}

// ─── App lookup público para pantalla de consent ────────────────────────
function getAppForConsent(db, clientId) {
  const app = db.prepare(`
    SELECT a.id, a.client_id, a.name, a.slug, a.short_description, a.description, a.icon_url,
           a.scopes_requested, a.redirect_uris, a.status, a.homepage_url, a.privacy_policy_url,
           d.name AS dev_name, d.company AS dev_company
      FROM apps a
      JOIN dev_accounts d ON d.id = a.dev_account_id
     WHERE a.client_id = ?
  `).get(clientId);
  if (!app) return null;
  return {
    id: app.id, clientId: app.client_id, name: app.name, slug: app.slug,
    shortDescription: app.short_description, description: app.description,
    iconUrl: app.icon_url,
    scopesRequested: JSON.parse(app.scopes_requested || '[]'),
    redirectUris:    JSON.parse(app.redirect_uris    || '[]'),
    status: app.status,
    homepageUrl: app.homepage_url, privacyPolicyUrl: app.privacy_policy_url,
    devName: app.dev_name, devCompany: app.dev_company,
  };
}

module.exports = {
  issueCode, exchangeCodeForTokens, exchangeRefreshToken,
  verifyAccessToken, revokeToken, revokeInstall, getAppForConsent,
  // constants
  CODE_TTL_SECS, ACCESS_TTL_SECS, REFRESH_TTL_SECS,
};
