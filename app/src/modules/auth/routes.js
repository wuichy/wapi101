// OAuth handlers para Meta (Facebook, Instagram, Messenger, WhatsApp Lite) y TikTok.
// Flujo:
//   1. Frontend abre popup → /auth/{provider}/start
//   2. Backend redirige a URL OAuth del proveedor con state random
//   3. Proveedor redirige a /auth/{provider}/callback?code=...&state=...
//   4. Backend valida state, intercambia code → tokens, guarda integración
//   5. Página HTML cierra el popup y envía postMessage al padre

const express = require('express');
const crypto = require('crypto');
const integrationService = require('../integrations/service');

const META_VERSION = process.env.META_GRAPH_VERSION || 'v22.0';

// Eventos disponibles para outgoing webhooks
const AVAILABLE_EVENTS = [
  { key: 'message.received',       label: 'Mensaje recibido' },
  { key: 'message.sent',           label: 'Mensaje enviado' },
  { key: 'contact.created',        label: 'Contacto creado' },
  { key: 'contact.updated',        label: 'Contacto actualizado' },
  { key: 'expedient.created',      label: 'Expediente creado' },
  { key: 'expedient.stage_changed',label: 'Expediente cambió de etapa' },
  { key: 'expedient.closed',       label: 'Expediente cerrado' },
];

function makeState() {
  return crypto.randomBytes(20).toString('hex');
}

function oauthError(res, message) {
  return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f1923;color:#fff;}
.box{text-align:center;padding:32px;background:#1a2535;border-radius:12px;max-width:380px;}
.icon{font-size:40px;margin-bottom:16px;color:#ef4444;}h2{margin:0 0 8px;font-size:18px;}p{color:#94a3b8;margin:8px 0 24px;font-size:14px;}
button{background:#1e3a5f;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;font-size:14px;}</style></head>
<body><div class="box"><div class="icon">✕</div><h2>Error al conectar</h2>
<p>${message}</p><button onclick="window.close()">Cerrar</button></div></body></html>`);
}

function oauthSuccess(res, integrationId, displayName) {
  return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f1923;color:#fff;}
.box{text-align:center;padding:32px;background:#1a2535;border-radius:12px;max-width:380px;}
.icon{font-size:40px;margin-bottom:16px;color:#10b981;}h2{margin:0 0 8px;font-size:18px;}p{color:#94a3b8;margin:8px 0;}
</style></head><body>
<div class="box"><div class="icon">✓</div><h2>¡Conectado!</h2>
<p>${displayName}</p><p style="font-size:13px">Cerrando...</p></div>
<script>
try {
  window.opener && window.opener.postMessage({ type:'oauth_success', integrationId: ${integrationId} }, '*');
} catch(e){}
setTimeout(() => window.close(), 1200);
</script></body></html>`);
}

module.exports = function createAuthRouter(db) {
  const router = express.Router();

  // ─── Meta (Facebook, Instagram, Messenger, WhatsApp Lite) ───
  // Para multi-tenant: el state debe ser pre-creado por POST /api/auth/oauth/prepare
  // (con auth) que stashea el tenant_id. Si llega sin state válido (legacy o
  // request suelto), genera uno con tenant 1 como fallback safe.
  router.get('/meta/start', (req, res) => {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return oauthError(res, 'No están configuradas las credenciales de Meta (META_APP_ID / META_APP_SECRET en el archivo .env).');
    }

    let state, provider;
    if (req.query.state) {
      const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(req.query.state);
      if (!stateRow) return oauthError(res, 'Sesión OAuth inválida o expirada. Inténtalo de nuevo desde el CRM.');
      state = stateRow.state;
      provider = stateRow.provider;
    } else {
      // Fallback legacy: sin state pre-creado, asume tenant 1
      provider = req.query.provider || 'messenger';
      state = makeState();
      db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
      db.prepare("INSERT INTO oauth_states (state, provider, tenant_id) VALUES (?, ?, 1)").run(state, provider);
    }

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/meta/callback`);

    // Instagram usa Instagram Business Login (endpoint separado de Facebook, app ID distinto)
    if (provider === 'instagram') {
      const igAppId = process.env.META_IG_APP_ID || appId;
      const igScope = encodeURIComponent('instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights');
      const igUrl = `https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=${igAppId}&redirect_uri=${redirectUri}&response_type=code&scope=${igScope}&state=${state}`;
      return res.redirect(igUrl);
    }

    const scopeMap = {
      messenger:      'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata,pages_manage_engagement',
      facebook:       'pages_show_list,pages_read_engagement',
      'whatsapp-lite':'whatsapp_business_management,whatsapp_business_messaging',
    };
    const scope = encodeURIComponent(scopeMap[provider] || scopeMap.messenger);
    const oauthUrl = `https://www.facebook.com/${META_VERSION}/dialog/oauth?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&state=${state}&response_type=code`;
    res.redirect(oauthUrl);
  });

  router.get('/meta/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) return oauthError(res, error_description || error);
    if (!code || !state) return oauthError(res, 'Respuesta inválida de Facebook.');

    const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
    if (!stateRow) return oauthError(res, 'Estado OAuth inválido o expirado. Inténtalo de nuevo.');
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    const provider = stateRow.provider;
    const tenantId = stateRow.tenant_id || 1;
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/meta/callback`);

    try {
      let integration;

      // Instagram Business Login usa endpoint distinto a Facebook, con credenciales de app IG separada
      if (provider === 'instagram') {
        const igAppId = process.env.META_IG_APP_ID || appId;
        const igAppSecret = process.env.META_IG_APP_SECRET || appSecret;
        const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: igAppId,
            client_secret: igAppSecret,
            grant_type: 'authorization_code',
            redirect_uri: decodeURIComponent(redirectUri),
            code,
          }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || tokenData.error_message || tokenData.error) {
          throw new Error(tokenData.error_message || tokenData.error?.message || 'Error obteniendo token de Instagram');
        }
        const shortToken = tokenData.access_token;
        const igUserId = String(tokenData.user_id || '');

        // Long-lived token (60 días)
        const llRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${igAppSecret}&access_token=${shortToken}`);
        const llData = await llRes.json();
        const accessToken = llData.access_token || shortToken;

        // Datos de la cuenta
        const meRes = await fetch(`https://graph.instagram.com/me?fields=id,username,name&access_token=${accessToken}`);
        const meData = await meRes.json();
        const finalIgId = String(meData.id || igUserId);

        const creds = { igUserId: finalIgId, accessToken, appSecret, appId };
        integration = await integrationService.connectRaw(db, tenantId, provider, creds, {
          displayName: meData.username ? `@${meData.username}` : meData.name || `IG ${finalIgId}`,
          externalId: finalIgId,
        });
        return oauthSuccess(res, integration.id, integration.displayName);
      }

      // 1. Intercambiar code → short-lived token (Facebook Login)
      const tokenRes = await fetch(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${redirectUri}&code=${code}`);
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error?.message || 'Error obteniendo token');

      // 2. Long-lived token
      const llRes = await fetch(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
      const llData = await llRes.json();
      const userToken = llData.access_token || tokenData.access_token;

      if (provider === 'messenger' || provider === 'facebook') {
        // 3a. Obtener páginas del usuario
        const pagesRes = await fetch(`https://graph.facebook.com/${META_VERSION}/me/accounts?access_token=${userToken}&fields=id,name,access_token,category`);
        const pagesData = await pagesRes.json();
        const pages = pagesData.data || [];
        if (!pages.length) throw new Error('No se encontraron Páginas de Facebook en esta cuenta.');

        const page = pages[0]; // Primera página - en el futuro mostrar selector
        const creds = {
          pageId: page.id,
          pageAccessToken: page.access_token,
          appSecret,
          appId,
        };
        integration = await integrationService.connectRaw(db, tenantId, provider, creds, {
          displayName: page.name,
          externalId: page.id,
        });

      } else if (provider === 'whatsapp-lite') {
        // 3c. Obtener WABA y números de WhatsApp
        const wabaRes = await fetch(`https://graph.facebook.com/${META_VERSION}/me/businesses?access_token=${userToken}&fields=id,name`);
        const wabaData = await wabaRes.json();
        const creds = { systemUserToken: userToken, appId, appSecret };
        const bizName = wabaData.data?.[0]?.name || 'WhatsApp Business';
        integration = await integrationService.connectRaw(db, tenantId, provider, creds, {
          displayName: bizName,
          externalId: wabaData.data?.[0]?.id || `wl-${Date.now()}`,
        });
      }

      return oauthSuccess(res, integration.id, integration.displayName);
    } catch (err) {
      console.error(`[auth meta/${provider}]`, err.message);
      return oauthError(res, err.message);
    }
  });

  // ─── TikTok ───
  router.get('/tiktok/start', (req, res) => {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      return oauthError(res, 'No están configuradas las credenciales de TikTok (TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET en .env).');
    }

    let state;
    if (req.query.state) {
      const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(req.query.state);
      if (!stateRow) return oauthError(res, 'Sesión OAuth inválida o expirada. Inténtalo de nuevo desde el CRM.');
      state = stateRow.state;
    } else {
      // Fallback legacy: tenant 1
      state = makeState();
      db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
      db.prepare("INSERT INTO oauth_states (state, provider, tenant_id) VALUES (?, 'tiktok', 1)").run(state);
    }

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/tiktok/callback`);
    const scope = encodeURIComponent('user.info.basic,user.info.profile,video.list');
    const url = `https://www.tiktok.com/v2/auth/authorize?client_key=${clientKey}&response_type=code&scope=${scope}&redirect_uri=${redirectUri}&state=${state}`;
    res.redirect(url);
  });

  router.get('/tiktok/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) return oauthError(res, error_description || error);
    if (!code || !state) return oauthError(res, 'Respuesta inválida de TikTok.');

    const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
    if (!stateRow) return oauthError(res, 'Estado OAuth inválido o expirado.');
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    const tenantId = stateRow.tenant_id || 1;
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = `${baseUrl}/auth/tiktok/callback`;

    try {
      const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri })
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = await userRes.json();
      const user = userData.data?.user || {};

      const creds = {
        clientKey,
        clientSecret,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        openId: user.open_id || tokenData.open_id,
      };
      const integration = await integrationService.connectRaw(db, tenantId, 'tiktok', creds, {
        displayName: user.display_name ? `@${user.display_name}` : `TikTok ${user.open_id || ''}`,
        externalId: user.open_id || tokenData.open_id,
      });
      return oauthSuccess(res, integration.id, integration.displayName);
    } catch (err) {
      console.error('[auth tiktok]', err.message);
      return oauthError(res, err.message);
    }
  });

  // ─── Threads ───
  router.get('/threads/start', (req, res) => {
    const appId = process.env.META_THREADS_APP_ID;
    const appSecret = process.env.META_THREADS_APP_SECRET;
    if (!appId || !appSecret) {
      return oauthError(res, 'No están configuradas las credenciales de Threads (META_THREADS_APP_ID / META_THREADS_APP_SECRET en .env).');
    }

    let state;
    if (req.query.state) {
      const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(req.query.state);
      if (!stateRow) return oauthError(res, 'Sesión OAuth inválida o expirada. Inténtalo de nuevo desde el CRM.');
      state = stateRow.state;
    } else {
      state = makeState();
      db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
      db.prepare("INSERT INTO oauth_states (state, provider, tenant_id) VALUES (?, 'threads', 1)").run(state);
    }

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/threads/callback`);
    const scope = encodeURIComponent('threads_basic,threads_manage_replies');
    const url = `https://www.threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${redirectUri}&scope=${scope}&response_type=code&state=${state}`;
    res.redirect(url);
  });

  router.get('/threads/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) return oauthError(res, error_description || error);
    if (!code || !state) return oauthError(res, 'Respuesta inválida de Threads.');

    const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
    if (!stateRow) return oauthError(res, 'Estado OAuth inválido o expirado.');
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    const tenantId = stateRow.tenant_id || 1;
    const appId = process.env.META_THREADS_APP_ID;
    const appSecret = process.env.META_THREADS_APP_SECRET;
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = `${baseUrl}/auth/threads/callback`;

    try {
      // 1. Short-lived token
      const tokenRes = await fetch('https://graph.threads.net/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error?.message || 'Error obteniendo token de Threads');

      // 2. Long-lived token (60 días)
      const llRes = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${tokenData.access_token}`);
      const llData = await llRes.json();
      const accessToken = llData.access_token || tokenData.access_token;

      // 3. Info del usuario
      const meRes = await fetch(`https://graph.threads.net/me?fields=id,username,name&access_token=${accessToken}`);
      const meData = await meRes.json();
      const userId = String(meData.id || tokenData.user_id || '');

      const integration = await integrationService.connectRaw(db, tenantId, 'threads', { accessToken, appSecret, appId, threadsUserId: userId }, {
        displayName: meData.username ? `@${meData.username}` : meData.name || `Threads ${userId}`,
        externalId: userId,
      });
      return oauthSuccess(res, integration.id, integration.displayName);
    } catch (err) {
      console.error('[auth threads]', err.message);
      return oauthError(res, err.message);
    }
  });

  // ─── Google (Gmail OAuth2) ───
  // Scopes: email + profile + gmail.send + mail.google.com (IMAP para leer)
  router.get('/google/start', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return oauthError(res, 'No están configuradas las credenciales de Google (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env).');
    }

    let state;
    if (req.query.state) {
      const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(req.query.state);
      if (!stateRow) return oauthError(res, 'Sesión OAuth inválida o expirada. Inténtalo de nuevo desde el CRM.');
      state = stateRow.state;
    } else {
      state = makeState();
      db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
      db.prepare("INSERT INTO oauth_states (state, provider, tenant_id) VALUES (?, 'gmail', 1)").run(state);
    }

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/google/callback`);
    // Pedimos acceso a: perfil básico + envío de emails (Gmail API) + IMAP
    const scope = encodeURIComponent([
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.send',
      'https://mail.google.com/',
    ].join(' '));

    const url = `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&state=${state}` +
      `&access_type=offline` +
      `&prompt=consent`;   // siempre forzar consent para obtener refresh_token

    res.redirect(url);
  });

  router.get('/google/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    if (error) return oauthError(res, error_description || error);
    if (!code || !state) return oauthError(res, 'Respuesta inválida de Google.');

    const stateRow = db.prepare("SELECT * FROM oauth_states WHERE state = ?").get(state);
    if (!stateRow) return oauthError(res, 'Estado OAuth inválido o expirado. Inténtalo de nuevo.');
    db.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);

    const tenantId = stateRow.tenant_id || 1;
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = `${baseUrl}/auth/google/callback`;

    try {
      // 1. Intercambiar code → tokens
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          grant_type:    'authorization_code',
          redirect_uri:  redirectUri,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        throw new Error(tokenData.error_description || tokenData.error || 'Error obteniendo tokens de Google');
      }
      if (!tokenData.refresh_token) {
        throw new Error('Google no devolvió refresh_token. Revoca el acceso en myaccount.google.com/permissions y vuelve a conectar.');
      }

      // 2. Info del usuario
      const userRes = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const userData = await userRes.json();
      if (!userRes.ok || userData.error) {
        throw new Error(userData.error?.message || 'Error obteniendo perfil de Google');
      }

      const creds = {
        email:        userData.email,
        name:         userData.name || userData.email,
        refreshToken: tokenData.refresh_token,
      };
      const integration = await integrationService.connectRaw(db, tenantId, 'gmail', creds, {
        displayName: userData.email,
        externalId:  userData.email,
      });
      return oauthSuccess(res, integration.id, integration.displayName);
    } catch (err) {
      console.error('[auth google]', err.message);
      return oauthError(res, err.message);
    }
  });

  // Listado de eventos disponibles para outgoing webhooks
  router.get('/events', (_req, res) => {
    res.json({ events: AVAILABLE_EVENTS });
  });

  return router;
};

module.exports.AVAILABLE_EVENTS = AVAILABLE_EVENTS;
