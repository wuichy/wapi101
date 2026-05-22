'use strict';

// Sync de perfil (nombre + foto) de contactos desde Meta (Messenger + Instagram).
//
// Por proveedor:
//   - messenger:  GET /{psid}?fields=name,first_name,last_name,profile_pic con page_access_token
//   - instagram:  GET /{ig_user_id}?fields=username,name,profile_picture_url con token
//   - whatsapp-lite (Baileys): ya tiene su propia ruta en bootstrap.js
//   - whatsapp (Cloud API): NO HAY — Meta no expone fotos/nombres por privacidad
//
// Reglas:
//   - Fire-and-forget: nunca debe bloquear el procesamiento del webhook
//   - Cooldown: 7 días entre refreshes de avatar (rate-limit safe)
//   - El nombre se sincroniza siempre que el actual sea placeholder
//     ("Contacto Messenger 4003", "Usuario XXX", etc.). Si el usuario ya
//     editó el nombre manualmente, NO lo pisamos.
//   - URL de FB CDN viene firmada y expira (~24h) — re-fetcheamos al expirar.
//     Por ahora no detectamos expiración, solo refresco semanal.

const customerSvc = require('./service');
const { isPlaceholderName } = require('../conversations/service');

const REFRESH_INTERVAL_SECS = 7 * 86400; // 7 días

function _shouldRefresh(db, contactId) {
  const c = db.prepare('SELECT avatar_url, avatar_updated_at, name FROM contacts WHERE id = ?').get(contactId);
  if (!c) return { refresh: false };
  const needAvatar = !c.avatar_url || !c.avatar_updated_at ||
    c.avatar_updated_at < (Math.floor(Date.now() / 1000) - REFRESH_INTERVAL_SECS);
  const needName = isPlaceholderName(c.name);
  return { refresh: needAvatar || needName, needAvatar, needName, currentName: c.name };
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

async function _fetchMessengerProfile(psid, token) {
  // Graph API: pedimos nombre + foto en una sola call
  const fields = 'name,first_name,last_name,profile_pic';
  const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(psid)}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.warn(`[avatar messenger] graph ${r.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const d = await r.json().catch(() => null);
  if (!d) return null;
  // Componer nombre: name puede venir, o first+last
  const name = d.name
    || [d.first_name, d.last_name].filter(Boolean).join(' ').trim()
    || null;
  return { name, avatarUrl: d.profile_pic || null };
}

async function _fetchInstagramProfile(igUserId, token) {
  // IG expone username (no display name siempre)
  const fields = 'username,name,profile_picture_url';
  const url = `https://graph.facebook.com/v18.0/${encodeURIComponent(igUserId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.warn(`[avatar instagram] graph ${r.status}: ${txt.slice(0, 200)}`);
    return null;
  }
  const d = await r.json().catch(() => null);
  if (!d) return null;
  // Preferimos display name; fallback a username (@handle)
  const name = d.name || d.username || null;
  return { name, avatarUrl: d.profile_picture_url || null };
}

// Fetch fire-and-forget. No retorna nada útil al caller. Si falla,
// solo se loggea — no propaga.
function syncAvatarAsync(db, tenantId, contactId, provider, externalId, integration) {
  if (!contactId || !provider || !externalId || !integration) return;
  const check = _shouldRefresh(db, contactId);
  if (!check.refresh) return;
  const token = _accessTokenFor(integration);
  if (!token) return;

  (async () => {
    try {
      let profile = null;
      if      (provider === 'messenger') profile = await _fetchMessengerProfile(externalId, token);
      else if (provider === 'instagram') profile = await _fetchInstagramProfile(externalId, token);
      if (!profile) return;

      // Avatar
      if (profile.avatarUrl) {
        customerSvc.setAvatar(db, tenantId, contactId, profile.avatarUrl);
      }
      // Nombre: solo si el actual es placeholder y el real no es vacío
      if (profile.name && isPlaceholderName(check.currentName)) {
        try {
          db.prepare('UPDATE contacts SET name = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
            .run(profile.name, contactId, tenantId);
          // Reflejar también en conversations.contact_name si existe ese campo
          // y tiene placeholder. Esto evita que el chat liste "Contacto Messenger 4003"
          // hasta el próximo refresh.
          try {
            db.prepare(`UPDATE conversations SET contact_name = ?
                        WHERE contact_id = ? AND tenant_id = ?`)
              .run(profile.name, contactId, tenantId);
          } catch (_) {}
        } catch (err) {
          console.warn(`[avatar ${provider}] update name fail: ${err.message}`);
        }
      }
      console.log(`[profile ${provider}] sync ok contact=${contactId} name="${profile.name || '-'}" avatar=${profile.avatarUrl ? 'yes' : 'no'}`);
    } catch (err) {
      console.warn(`[profile ${provider}] error contact=${contactId}: ${err.message}`);
    }
  })();
}

module.exports = { syncAvatarAsync };
