// OAuth 2.0 — HTTP endpoints
// ============================================================================
// Endpoints estándar RFC 6749:
//   GET  /oauth/authorize  — pantalla de consent (requiere login advisor)
//   POST /oauth/authorize  — handle consent (Aceptar/Rechazar)
//   POST /oauth/token      — exchange code o refresh_token
//   POST /oauth/revoke     — revoke token

'use strict';

const express = require('express');
const oauthSvc = require('./service');
const advisorSvc = require('../advisors/service');

function _extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  // Fallback a cookie rh_token para el flow del browser
  const c = (req.headers.cookie || '').match(/(?:^|;\s*)rh_token=([^;]+)/);
  return c ? decodeURIComponent(c[1]) : null;
}

function _decodeBasicAuth(req) {
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch { return null; }
}

module.exports = function createOAuthRouter(db) {
  const router = express.Router();
  // /oauth/token usa application/x-www-form-urlencoded estándar OAuth
  router.use(express.urlencoded({ extended: false }));
  router.use(express.json({ limit: '256kb' }));

  // ─── GET /oauth/authorize ────────────────────────────────────────────
  // Renderiza la pantalla de consent. Requiere que el caller esté logueado
  // como advisor (tenemos su token en cookie/header). Si no, redirige a /login.
  router.get('/authorize', (req, res) => {
    const { client_id, redirect_uri, response_type, scope, state } = req.query;
    if (response_type !== 'code') {
      return res.status(400).send('Only response_type=code is supported');
    }
    if (!client_id || !redirect_uri) {
      return res.status(400).send('client_id and redirect_uri required');
    }
    const app = oauthSvc.getAppForConsent(db, client_id);
    if (!app) return res.status(404).send('App not found');
    if (app.status === 'suspended') return res.status(403).send('App suspended');
    if (!app.redirectUris.includes(redirect_uri)) {
      return res.status(400).send('redirect_uri not registered for this app');
    }

    // Verificar advisor logueado
    const token = _extractToken(req);
    const advisor = token ? advisorSvc.getSession(db, token) : null;
    if (!advisor) {
      // Redirigir a login con return_to
      const returnTo = encodeURIComponent(req.originalUrl);
      return res.redirect(`/login?return_to=${returnTo}`);
    }

    // Calcular intersección scopes pedidos ∩ scopes solicitados en URL (si vienen)
    const requestedScopes = (scope ? String(scope).split(/[ +]/).filter(Boolean) : app.scopesRequested);
    const finalScopes = requestedScopes.filter(s => app.scopesRequested.includes(s));

    // Renderizar consent screen (HTML simple inline)
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(_renderConsent({ app, advisor, redirect_uri, state, scopes: finalScopes }));
  });

  // ─── POST /oauth/authorize ──────────────────────────────────────────
  // Handle del submit del form: si decision=allow, emite code y redirige.
  router.post('/authorize', (req, res) => {
    const { client_id, redirect_uri, state, scopes, decision } = req.body || {};
    const token = _extractToken(req);
    const advisor = token ? advisorSvc.getSession(db, token) : null;
    if (!advisor) return res.status(401).send('Not authenticated');

    const app = oauthSvc.getAppForConsent(db, client_id);
    if (!app) return res.status(404).send('App not found');
    if (!app.redirectUris.includes(redirect_uri)) {
      return res.status(400).send('redirect_uri mismatch');
    }

    if (decision !== 'allow') {
      const u = new URL(redirect_uri);
      u.searchParams.set('error', 'access_denied');
      if (state) u.searchParams.set('state', state);
      return res.redirect(u.toString());
    }

    const scopeArr = Array.isArray(scopes) ? scopes : (typeof scopes === 'string' ? scopes.split(',').filter(Boolean) : []);
    const valid = scopeArr.filter(s => app.scopesRequested.includes(s));

    const { code } = oauthSvc.issueCode(db, {
      appId:       app.id,
      tenantId:    advisor.tenantId,
      advisorId:   advisor.id,
      redirectUri: redirect_uri,
      scopes:      valid,
      state,
    });

    const u = new URL(redirect_uri);
    u.searchParams.set('code', code);
    if (state) u.searchParams.set('state', state);
    res.redirect(u.toString());
  });

  // ─── POST /oauth/token ──────────────────────────────────────────────
  // Acepta:
  //   - grant_type=authorization_code (code + redirect_uri)
  //   - grant_type=refresh_token (refresh_token)
  // Auth: Basic con client_id:client_secret O en body.
  router.post('/token', (req, res) => {
    try {
      const basic = _decodeBasicAuth(req);
      const clientId     = basic?.user || req.body.client_id;
      const clientSecret = basic?.pass || req.body.client_secret;
      if (!clientId || !clientSecret) {
        return res.status(401).json({ error: 'invalid_client', error_description: 'client_id/secret required' });
      }

      const grantType = req.body.grant_type;
      if (grantType === 'authorization_code') {
        const { code, redirect_uri } = req.body;
        if (!code || !redirect_uri) {
          return res.status(400).json({ error: 'invalid_request' });
        }
        const tokens = oauthSvc.exchangeCodeForTokens(db, { clientId, clientSecret, code, redirectUri: redirect_uri });
        return res.json(tokens);
      }
      if (grantType === 'refresh_token') {
        const { refresh_token } = req.body;
        if (!refresh_token) return res.status(400).json({ error: 'invalid_request' });
        const tokens = oauthSvc.exchangeRefreshToken(db, { clientId, clientSecret, refreshToken: refresh_token });
        return res.json(tokens);
      }
      return res.status(400).json({ error: 'unsupported_grant_type' });
    } catch (err) {
      const code = err.message === 'invalid_client' ? 401 : 400;
      res.status(code).json({ error: err.message });
    }
  });

  // ─── POST /oauth/revoke ─────────────────────────────────────────────
  router.post('/revoke', (req, res) => {
    const token = req.body.token;
    if (token) oauthSvc.revokeToken(db, token);
    res.json({ ok: true });
  });

  return router;
};

// ── HTML del consent screen ────────────────────────────────────────────
function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _renderConsent({ app, advisor, redirect_uri, state, scopes }) {
  // Cargar labels de scopes desde el catálogo
  const devSvc = require('../developers/service');
  const scopeLabels = Object.fromEntries(devSvc.AVAILABLE_SCOPES.map(s => [s.key, s]));

  const scopeRows = scopes.map(s => {
    const info = scopeLabels[s] || { label: s, sensitive: false };
    return `
      <li class="scope-item ${info.sensitive ? 'is-sensitive' : ''}">
        <span class="scope-icon">${info.sensitive ? '⚠' : '✓'}</span>
        <div class="scope-text">
          <strong>${_esc(info.label)}</strong>
          <code>${_esc(s)}</code>
        </div>
      </li>`;
  }).join('') || '<li class="scope-item"><span class="scope-text">Sin permisos adicionales</span></li>';

  const hiddenScopes = scopes.map(s => `<input type="hidden" name="scopes" value="${_esc(s)}"/>`).join('');
  const ico = app.iconUrl ? `<img src="${_esc(app.iconUrl)}" alt="" />` : '🧩';

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Autorizar ${_esc(app.name)} — Wapi101</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;margin:0;background:#f3f4f6;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
  .card{background:#fff;border-radius:14px;max-width:480px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.08);overflow:hidden}
  .head{padding:24px 24px 16px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:14px}
  .head-ico{width:48px;height:48px;border-radius:12px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;overflow:hidden}
  .head-ico img{width:100%;height:100%;object-fit:cover}
  .head h1{margin:0;font-size:18px;line-height:1.3}
  .head .by{font-size:12px;color:#64748b;margin-top:2px}
  .body{padding:18px 24px 24px}
  .intro{font-size:14px;color:#334155;margin-bottom:16px}
  .scopes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
  .scope-item{display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;font-size:13px}
  .scope-item.is-sensitive{border-color:#fde68a;background:#fffbeb}
  .scope-icon{flex-shrink:0;font-size:14px;font-weight:700;color:#16a34a;line-height:1.5}
  .scope-item.is-sensitive .scope-icon{color:#b45309}
  .scope-text strong{display:block;font-weight:600}
  .scope-text code{font-size:11px;color:#64748b;background:#f1f5f9;padding:1px 5px;border-radius:4px}
  .meta{margin-top:16px;font-size:12px;color:#64748b;line-height:1.5}
  .meta a{color:#2563eb;text-decoration:none}
  .actions{display:flex;gap:10px;margin-top:20px}
  .btn{flex:1;padding:11px;border-radius:10px;border:0;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit}
  .btn-allow{background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff}
  .btn-allow:hover{filter:brightness(1.05)}
  .btn-deny{background:#f1f5f9;color:#475569}
  .btn-deny:hover{background:#e2e8f0}
  .footer{text-align:center;padding:14px;font-size:11px;color:#94a3b8;background:#f8fafc;border-top:1px solid #e5e7eb}
  .as-user{display:flex;align-items:center;gap:8px;font-size:12px;color:#64748b;background:#f8fafc;padding:8px 12px;border-radius:8px;margin-bottom:14px}
  .as-user b{color:#0f172a}
  .draft-warn{background:#fef3c7;color:#92400e;padding:10px 12px;border-radius:8px;font-size:12px;margin-bottom:14px;line-height:1.4}
</style>
</head><body>
<div class="card">
  <div class="head">
    <div class="head-ico">${app.iconUrl ? ico : '🧩'}</div>
    <div>
      <h1>${_esc(app.name)}</h1>
      <div class="by">de ${_esc(app.devCompany || app.devName)}</div>
    </div>
  </div>
  <div class="body">
    <div class="as-user">Sesión: <b>${_esc(advisor.name)}</b></div>
    ${app.status !== 'approved' ? `<div class="draft-warn">⚠ Esta app no ha sido aprobada por Wapi101 todavía. Solo prueba si confías en el desarrollador.</div>` : ''}
    <p class="intro"><strong>${_esc(app.name)}</strong> quiere acceso a tu cuenta Wapi101 con estos permisos:</p>
    <ul class="scopes">${scopeRows}</ul>
    <div class="meta">
      ${app.shortDescription ? `<p>${_esc(app.shortDescription)}</p>` : ''}
      ${app.homepageUrl ? `<a href="${_esc(app.homepageUrl)}" target="_blank">Sitio web</a> · ` : ''}
      ${app.privacyPolicyUrl ? `<a href="${_esc(app.privacyPolicyUrl)}" target="_blank">Política de privacidad</a>` : ''}
    </div>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${_esc(app.clientId)}"/>
      <input type="hidden" name="redirect_uri" value="${_esc(redirect_uri)}"/>
      <input type="hidden" name="state" value="${_esc(state || '')}"/>
      ${hiddenScopes}
      <div class="actions">
        <button type="submit" name="decision" value="deny"  class="btn btn-deny">Rechazar</button>
        <button type="submit" name="decision" value="allow" class="btn btn-allow">Autorizar</button>
      </div>
    </form>
  </div>
  <div class="footer">Powered by Wapi101 · <a href="/developers" style="color:inherit">Build your own app</a></div>
</div>
</body></html>`;
}

