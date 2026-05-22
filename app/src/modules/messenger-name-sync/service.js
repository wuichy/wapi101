'use strict';

// Poller periódico que sincroniza nombres de contactos Messenger/Instagram
// que quedaron con placeholder ("Contacto Messenger 4003", "Contacto Instagram XXXX").
//
// Por qué este poller existe:
//   Meta bloqueó el endpoint /{psid}?fields=name desde 2023 (requiere App Review
//   de pages_user_locale o similar permission). Workaround: el endpoint
//   /me/conversations?fields=participants SÍ devuelve nombres sin necesitar
//   esos permisos. Iteramos las convos recientes de cada page y armamos un
//   map { psid → name } que usamos para resolver placeholders.
//
// Frecuencia: cada 30 min. Cada poll trae las últimas 100 conversations de
// cada page, lo cual cubre actividad reciente. Si hay PSIDs con placeholder
// que NO aparezcan en las últimas 100 conversations (raro, sería actividad
// vieja sin webhook), se quedan placeholder hasta que el cliente vuelva a
// escribir.
//
// Costo en rate limit de Meta: 1 call por integration messenger connected
// cada 30 min = 48 calls/día por page. Muy lejos del límite (200/hora/page).

const { decryptJson } = require('../../security/crypto');
const { isPlaceholderName } = require('../conversations/service');

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const STARTUP_DELAY_MS = 60 * 1000;       // 1 min después del boot
const MAX_PAGES_PER_INTEGRATION = 5;      // 5 × 100 = 500 conversations por poll

let _pollerHandle = null;

async function _fetchConversationsForToken(token, integrationId) {
  // /me/conversations?fields=participants,id&limit=100
  // Devuelve hasta 100 convos. Si hay más, paginar con paging.next.
  const psidToName = new Map();
  let url = `https://graph.facebook.com/v18.0/me/conversations?fields=participants,id&limit=100&access_token=${encodeURIComponent(token)}`;
  let pages = 0;
  while (url && pages < MAX_PAGES_PER_INTEGRATION) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    } catch (err) {
      console.warn(`[messenger-name-sync] integ=${integrationId} fetch fail: ${err.message}`);
      break;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[messenger-name-sync] integ=${integrationId} graph ${res.status}: ${txt.slice(0, 200)}`);
      break;
    }
    const j = await res.json().catch(() => null);
    if (!j || !Array.isArray(j.data)) break;
    for (const convo of j.data) {
      for (const p of (convo.participants?.data || [])) {
        if (p.id && p.name) psidToName.set(String(p.id), p.name);
      }
    }
    url = j.paging?.next || null;
    pages++;
  }
  return psidToName;
}

function _placeholderContacts(db, integrationId, provider) {
  // Listar contactos con placeholder + el external_id de su conversación
  // para esa integration específica.
  return db.prepare(`
    SELECT DISTINCT
      c.id          AS contact_id,
      c.first_name,
      c.last_name,
      c.tenant_id,
      conv.external_id
    FROM contacts c
    JOIN conversations conv ON conv.contact_id = c.id
    WHERE conv.integration_id = ?
      AND conv.provider = ?
      AND conv.external_id IS NOT NULL
  `).all(integrationId, provider);
}

async function _pollOnce(db) {
  const start = Date.now();
  // Listar integrations connected de messenger e instagram
  const integs = db.prepare(`
    SELECT id, tenant_id, external_id, credentials_enc, provider
    FROM integrations
    WHERE provider IN ('messenger', 'instagram')
      AND status = 'connected'
  `).all();

  let totalChecked = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const integ of integs) {
    let creds;
    try {
      creds = integ.credentials_enc ? (decryptJson(integ.credentials_enc) || {}) : {};
    } catch (e) {
      totalErrors++;
      continue;
    }
    const token = creds.pageAccessToken || creds.accessToken;
    if (!token) continue;

    // Listar candidatos placeholder ANTES de pegarle a Meta (si no hay,
    // no gastamos rate limit en esa integration)
    const candidates = _placeholderContacts(db, integ.id, integ.provider);
    const needFix = candidates.filter(c => {
      const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
      return isPlaceholderName(fullName);
    });
    if (!needFix.length) continue;

    // Pedir nombres a Meta
    const psidMap = await _fetchConversationsForToken(token, integ.id);
    if (!psidMap.size) {
      totalErrors++;
      continue;
    }

    for (const c of needFix) {
      totalChecked++;
      const realName = psidMap.get(String(c.external_id));
      if (!realName) continue;
      try {
        const parts = realName.trim().split(/\s+/);
        const first = parts[0] || realName;
        const last  = parts.slice(1).join(' ') || null;
        db.prepare('UPDATE contacts SET first_name = ?, last_name = ?, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?')
          .run(first, last, c.contact_id, c.tenant_id);
        totalUpdated++;
        console.log(`[messenger-name-sync] integ=${integ.id} contact=${c.contact_id} → "${realName}"`);
      } catch (err) {
        totalErrors++;
      }
    }
  }

  const dur = Date.now() - start;
  if (totalChecked || totalUpdated || totalErrors) {
    console.log(`[messenger-name-sync] poll done in ${dur}ms — checked=${totalChecked} updated=${totalUpdated} errors=${totalErrors}`);
  }
}

function startPoller(db) {
  if (_pollerHandle) {
    console.warn('[messenger-name-sync] poller ya está corriendo');
    return;
  }
  console.log(`[messenger-name-sync] poller arrancado — primera corrida en ${STARTUP_DELAY_MS / 1000}s, después cada ${POLL_INTERVAL_MS / 60000}min`);

  // Primera corrida después de un delay (para que el server termine de bootear)
  setTimeout(() => {
    _pollOnce(db).catch(err => console.error('[messenger-name-sync] poll error:', err.message));
    // Luego cada N min
    _pollerHandle = setInterval(() => {
      _pollOnce(db).catch(err => console.error('[messenger-name-sync] poll error:', err.message));
    }, POLL_INTERVAL_MS);
  }, STARTUP_DELAY_MS);
}

function stopPoller() {
  if (_pollerHandle) {
    clearInterval(_pollerHandle);
    _pollerHandle = null;
  }
}

module.exports = { startPoller, stopPoller, _pollOnce };
