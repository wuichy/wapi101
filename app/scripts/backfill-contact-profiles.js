'use strict';

// Backfill de nombre + foto de perfil para contactos de Messenger e Instagram
// cuyo first_name quedó como placeholder (porque el token estaba caducado al
// recibir el mensaje, o se hicieron antes de tener `placeholderContactName`).
//
// Uso:
//   node scripts/backfill-contact-profiles.js [--tenant=1] [--dry-run] [--limit=50]
//
// Requiere que la integración del provider correspondiente esté CONECTADA con
// token válido. Si el token sigue caducado, Graph API regresará 401 y el script
// solo se saltará a ese contacto.

const path = require('path');
const Database = require('better-sqlite3');
const { decryptJson } = require(path.join(__dirname, '..', 'src', 'security', 'crypto'));

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : (args.includes(`--${name}`) ? true : def);
};

const TENANT  = Number(flag('tenant', 1));
const LIMIT   = Number(flag('limit', 500));
const DRY_RUN = !!flag('dry-run', false);

const DB_PATH = process.env.WAPI101_DB || '/root/.wapi101/data/wapi101.sqlite';
const db = new Database(DB_PATH);

function isPlaceholder(name) {
  if (!name) return true;
  return /^(Usuario\s|Contacto\s(Messenger|Instagram|WhatsApp|Telegram|TikTok|Gmail|Outlook|iCloud|Yahoo))/i.test(name)
      || name === 'Contacto'
      || name === 'Desconocido';
}

function tokenFor(integration) {
  if (!integration?.credentials_enc) return null;
  try {
    const creds = decryptJson(integration.credentials_enc) || {};
    return creds.pageAccessToken || creds.accessToken || null;
  } catch {
    return null;
  }
}

async function fetchMessengerProfile(psid, token) {
  const url = `https://graph.facebook.com/v22.0/${encodeURIComponent(psid)}?fields=first_name,last_name,name,profile_pic&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.error) {
    return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
  }
  return { ok: true, first_name: d?.first_name || null, last_name: d?.last_name || null, name: d?.name || null, profile_pic: d?.profile_pic || null };
}

async function fetchInstagramProfile(igUserId, token) {
  const url = `https://graph.facebook.com/v22.0/${encodeURIComponent(igUserId)}?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url);
  const d = await r.json().catch(() => null);
  if (!r.ok || d?.error) {
    return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
  }
  const name = d?.name || d?.username || null;
  const parts = (name || '').split(/\s+/).filter(Boolean);
  return { ok: true, first_name: parts[0] || d?.username || null, last_name: parts.slice(1).join(' ') || null, name, profile_pic: d?.profile_picture_url || null };
}

(async () => {
  // 1. Cargar candidatos: contactos del tenant con placeholder + su provider/externalId via conversación
  const rows = db.prepare(`
    SELECT c.id AS contact_id, c.first_name, c.last_name, c.avatar_url,
           conv.provider, conv.external_id, conv.integration_id
    FROM contacts c
    JOIN conversations conv ON conv.contact_id = c.id
    WHERE c.tenant_id = ?
      AND conv.provider IN ('messenger','instagram')
    LIMIT ?
  `).all(TENANT, LIMIT * 4); // overfetch porque filtramos por placeholder en JS

  const candidates = rows.filter(r => isPlaceholder(r.first_name)).slice(0, LIMIT);

  console.log(`Encontrados ${candidates.length} contactos con placeholder (de ${rows.length} revisados).`);
  if (DRY_RUN) console.log('-- DRY RUN: no se escribe nada --');

  // 2. Cachear integraciones por id (1 query por integración, no por contacto)
  const integrations = new Map();
  function getIntegration(id) {
    if (integrations.has(id)) return integrations.get(id);
    const row = id ? db.prepare('SELECT id, provider, status, credentials_enc FROM integrations WHERE id = ?').get(id) : null;
    integrations.set(id, row);
    return row;
  }

  let updated = 0, skipped = 0, errored = 0;
  for (const c of candidates) {
    const integration = getIntegration(c.integration_id);
    const token = tokenFor(integration);
    if (!token) { skipped++; console.log(`  contact=${c.contact_id} skip (sin token)`); continue; }

    let profile;
    try {
      if (c.provider === 'messenger')      profile = await fetchMessengerProfile(c.external_id, token);
      else if (c.provider === 'instagram') profile = await fetchInstagramProfile(c.external_id, token);
      else                                 { skipped++; continue; }
    } catch (e) {
      errored++; console.log(`  contact=${c.contact_id} error fetch: ${e.message}`); continue;
    }

    if (!profile.ok) {
      errored++; console.log(`  contact=${c.contact_id} graph error: ${profile.error}`);
      continue;
    }

    const newFirst  = profile.first_name || c.first_name;
    const newLast   = profile.last_name  || c.last_name || null;
    const newAvatar = profile.profile_pic || null;

    if (DRY_RUN) {
      console.log(`  [dry] contact=${c.contact_id} ${c.first_name} → ${newFirst} ${newLast || ''} ${newAvatar ? '(+avatar)' : ''}`);
      updated++;
      continue;
    }

    db.prepare(`
      UPDATE contacts
      SET first_name = ?, last_name = ?,
          avatar_url = COALESCE(?, avatar_url),
          avatar_updated_at = CASE WHEN ? IS NOT NULL THEN unixepoch() ELSE avatar_updated_at END,
          updated_at = unixepoch()
      WHERE id = ? AND tenant_id = ?
    `).run(newFirst, newLast, newAvatar, newAvatar, c.contact_id, TENANT);
    updated++;
    console.log(`  contact=${c.contact_id} ${c.first_name} → ${newFirst} ${newLast || ''} ${newAvatar ? '(+avatar)' : ''}`);

    // ritmo amable con Graph API (~5 req/seg)
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nResumen: ${updated} actualizados · ${skipped} skip · ${errored} errores`);
  db.close();
})().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
