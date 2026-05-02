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
  router.get('/meta/start', (req, res) => {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      return oauthError(res, 'No están configuradas las credenciales de Meta (META_APP_ID / META_APP_SECRET en el archivo .env).');
    }

    const provider = req.query.provider || 'messenger';
    const state = makeState();

    // Limpiar estados viejos (>1h) y guardar el nuevo
    db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
    db.prepare("INSERT INTO oauth_states (state, provider) VALUES (?, ?)").run(state, provider);

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/meta/callback`);

    const scopeMap = {
      messenger:      'pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata',
      instagram:      'instagram_basic,instagram_manage_messages,pages_show_list,pages_read_engagement',
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
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/meta/callback`);

    try {
      // 1. Intercambiar code → short-lived token
      const tokenRes = await fetch(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${redirectUri}&code=${code}`);
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) throw new Error(tokenData.error?.message || 'Error obteniendo token');

      // 2. Long-lived token
      const llRes = await fetch(`https://graph.facebook.com/${META_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${tokenData.access_token}`);
      const llData = await llRes.json();
      const userToken = llData.access_token || tokenData.access_token;

      let integration;

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
        integration = await integrationService.connectRaw(db, provider, creds, {
          displayName: page.name,
          externalId: page.id,
        });

      } else if (provider === 'instagram') {
        // 3b. Buscar cuenta de Instagram Business
        const pagesRes = await fetch(`https://graph.facebook.com/${META_VERSION}/me/accounts?access_token=${userToken}&fields=id,name,access_token,instagram_business_account`);
        const pagesData = await pagesRes.json();
        const pages = (pagesData.data || []).filter(p => p.instagram_business_account);
        if (!pages.length) throw new Error('No se encontró una cuenta de Instagram Business vinculada a esta cuenta de Facebook.');

        const page = pages[0];
        const igId = page.instagram_business_account.id;
        const igRes = await fetch(`https://graph.facebook.com/${META_VERSION}/${igId}?fields=username,name&access_token=${page.access_token}`);
        const igData = await igRes.json();
        const creds = {
          igUserId: igId,
          accessToken: page.access_token,
          appSecret,
          appId,
        };
        integration = await integrationService.connectRaw(db, provider, creds, {
          displayName: igData.username ? `@${igData.username}` : igData.name || `IG ${igId}`,
          externalId: igId,
        });

      } else if (provider === 'whatsapp-lite') {
        // 3c. Obtener WABA y números de WhatsApp
        const wabaRes = await fetch(`https://graph.facebook.com/${META_VERSION}/me/businesses?access_token=${userToken}&fields=id,name`);
        const wabaData = await wabaRes.json();
        const creds = { systemUserToken: userToken, appId, appSecret };
        const bizName = wabaData.data?.[0]?.name || 'WhatsApp Business';
        integration = await integrationService.connectRaw(db, provider, creds, {
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

    const state = makeState();
    db.prepare("DELETE FROM oauth_states WHERE created_at < unixepoch() - 3600").run();
    db.prepare("INSERT INTO oauth_states (state, provider) VALUES (?, ?)").run(state, 'tiktok');

    const baseUrl = (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    const redirectUri = encodeURIComponent(`${baseUrl}/auth/tiktok/callback`);
    const scope = encodeURIComponent('user.info.basic,video.list,video.upload');
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
      const integration = await integrationService.connectRaw(db, 'tiktok', creds, {
        displayName: user.display_name ? `@${user.display_name}` : `TikTok ${user.open_id || ''}`,
        externalId: user.open_id || tokenData.open_id,
      });
      return oauthSuccess(res, integration.id, integration.displayName);
    } catch (err) {
      console.error('[auth tiktok]', err.message);
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
