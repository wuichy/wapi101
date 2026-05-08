'use strict';

// Sync de fotos de perfil de contactos desde Meta (Messenger + Instagram).
//
// Por proveedor:
//   - messenger:  GET /{psid}?fields=name,profile_pic   con page_access_token
//   - instagram:  GET /{ig_user_id}?fields=username,profile_picture_url con token
//   - whatsapp-lite (Baileys): ya tiene su propia ruta en bootstrap.js
//   - whatsapp (Cloud API): NO HAY — Meta no expone fotos de users por privacidad
//
// Reglas:
//   - Fire-and-forget: nunca debe bloquear el procesamiento del webhook
//   - Cooldown: 7 días entre refreshes para no quemar rate-limit
//   - URL de FB CDN viene firmada y expira (~24h) — re-fetcheamos al expirar.
//     Por ahora no detectamos expiración, solo refresco semanal.

const customerSvc = require('./service');

const REFRESH_INTERVAL_SECS = 7 * 86400; // 7 días

function _shouldRefresh(db, contactId) {
  const c = db.prepare('SELECT avatar_url, avatar_updated_at FROM contacts WHERE id = ?').get(contactId);
  if (!c) return false;
  if (!c.avatar_url) return true;
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - REFRESH_INTERVAL_SECS;
  return !c.avatar_updated_at || c.avatar_updated_at < sevenDaysAgo;
}

function _accessTokenFor(integration) {
  try {
    const creds = typeof integration.credentials === 'string'
      ? JSON.parse(integration.credentials || '{}')
      : (integration.credentials || {});
    // Messenger usa 'pageAccessToken', Instagram y otros usan 'accessToken'
    return creds.pageAccessToken || creds.accessToken || null;
  } catch {
    return null;
  }
}

async function _fetchMessengerAvatar(psid, token) {
  const r = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(psid)}?fields=profile_pic&access_token=${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.profile_pic || null;
}

async function _fetchInstagramAvatar(igUserId, token) {
  const r = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(igUserId)}?fields=profile_picture_url&access_token=${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.profile_picture_url || null;
}

// Fetch fire-and-forget. No retorna nada útil al caller. Si falla,
// solo se loggea — no propaga.
function syncAvatarAsync(db, tenantId, contactId, provider, externalId, integration) {
  if (!contactId || !provider || !externalId || !integration) return;
  if (!_shouldRefresh(db, contactId)) return;
  const token = _accessTokenFor(integration);
  if (!token) return;

  (async () => {
    try {
      let url = null;
      if      (provider === 'messenger') url = await _fetchMessengerAvatar(externalId, token);
      else if (provider === 'instagram') url = await _fetchInstagramAvatar(externalId, token);
      if (url) {
        customerSvc.setAvatar(db, tenantId, contactId, url);
        console.log(`[avatar ${provider}] sync ok contact=${contactId}`);
      }
    } catch (err) {
      console.warn(`[avatar ${provider}] error contact=${contactId}: ${err.message}`);
    }
  })();
}

module.exports = { syncAvatarAsync };
