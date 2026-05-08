// TikTok comment poller — cada POLL_INTERVAL revisa los últimos N videos de
// cada integración TikTok conectada y convierte comentarios nuevos en mensajes del CRM.
//
// Flujo:
//   1. GET /v2/video/list/ → obtiene últimos VIDEOS_TO_CHECK videos del usuario
//   2. POST /v2/video/comment/list/ por cada video → obtiene comentarios nuevos
//   3. Crea contacto + conversación + mensaje en el CRM (idempotente via external_id)
//   4. Persiste el último comment_id procesado por video en tiktok_video_state

const { decryptJson, encryptJson } = require('../../security/crypto');

const POLL_INTERVAL  = 5 * 60 * 1000; // 5 minutos
const VIDEOS_TO_CHECK = 10;            // últimos N videos a revisar
const COMMENTS_PER_VIDEO = 50;

let _db    = null;
let _timer = null;

function start(db) {
  _db = db;
  poll();
  _timer = setInterval(poll, POLL_INTERVAL);
  console.log('[tiktok-poller] iniciado (intervalo 5 min)');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function poll() {
  if (!_db) return;
  const rows = _db.prepare(
    "SELECT * FROM integrations WHERE provider = 'tiktok' AND status = 'connected'"
  ).all();
  for (const row of rows) {
    try { await pollOne(row); }
    catch (err) { console.error(`[tiktok-poller] error en integración ${row.id}:`, err.message); }
  }
}

// ─── Token helpers ──────────────────────────────────────────────────────────

async function refreshAccessToken(row) {
  const creds = decryptJson(row.credentials_enc);
  if (!creds?.refreshToken) return null;
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key:    creds.clientKey    || process.env.TIKTOK_CLIENT_KEY,
        client_secret: creds.clientSecret || process.env.TIKTOK_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: creds.refreshToken,
      }),
    });
    const data = await res.json();
    if (data.error || !data.access_token) return null;
    const newCreds = {
      ...creds,
      accessToken:  data.access_token,
      refreshToken: data.refresh_token || creds.refreshToken,
    };
    _db.prepare('UPDATE integrations SET credentials_enc = ? WHERE id = ?')
       .run(encryptJson(newCreds), row.id);
    return data.access_token;
  } catch { return null; }
}

async function apiFetch(url, accessToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) return { _expired: true };
  return res.json();
}

// ─── Core poll ──────────────────────────────────────────────────────────────

async function pollOne(row) {
  const creds = decryptJson(row.credentials_enc);
  if (!creds?.accessToken) return;
  let token = creds.accessToken;

  // 1. Lista de videos del usuario
  const videosUrl = 'https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,comment_count';
  let videosData = await apiFetch(videosUrl, token);

  if (videosData?._expired) {
    token = await refreshAccessToken(row);
    if (!token) return;
    videosData = await apiFetch(videosUrl, token);
  }

  if (videosData?.error?.code || !videosData?.data?.videos) {
    if (videosData?.error) console.error('[tiktok-poller] error videos:', videosData.error.message);
    return;
  }

  const videos = videosData.data.videos || [];
  if (!videos.length) return;

  const convoSvc = require('../conversations/service');

  for (const video of videos.slice(0, VIDEOS_TO_CHECK)) {
    try {
      await pollVideoComments(row, video, token, convoSvc);
    } catch (err) {
      console.error(`[tiktok-poller] error comentarios video ${video.id}:`, err.message);
    }
  }
}

async function pollVideoComments(row, video, token, convoSvc) {
  const stateRow = _db.prepare(
    'SELECT last_comment_id FROM tiktok_video_state WHERE integration_id = ? AND video_id = ?'
  ).get(row.id, video.id);
  const lastCommentId = stateRow?.last_comment_id || null;

  const commentsData = await apiFetch(
    'https://open.tiktokapis.com/v2/video/comment/list/?fields=id,text,like_count,reply_count,parent_comment_id,create_time,username',
    token,
    { method: 'POST', body: JSON.stringify({ video_id: video.id, max_count: COMMENTS_PER_VIDEO, sort_field: 'time', sort_order: 'desc' }) }
  );

  if (commentsData?.error?.code) {
    // 40003 = scope no habilitado — log amigable
    if (commentsData.error.code === 40003 || String(commentsData.error.code).includes('scope')) {
      console.warn('[tiktok-poller] scope video.comment.read no habilitado en la app TikTok. Ver docs para solicitarlo.');
    }
    return;
  }

  const comments = commentsData?.data?.comments || [];
  if (!comments.length) return;

  let newLastId = lastCommentId;
  let hasNew = false;
  const tenantId = row.tenant_id;
  const videoTitle = video.title || `Video ${video.id}`;

  for (const comment of comments) {
    // Solo comentarios raíz (sin parent) — las respuestas se registran solo si son nuevas
    if (lastCommentId && String(comment.id) <= String(lastCommentId)) continue;
    if (!comment.text?.trim()) continue;

    hasNew = true;
    if (!newLastId || String(comment.id) > String(newLastId)) newLastId = String(comment.id);

    const username = comment.username || 'tiktok_user';

    // Buscar o crear contacto por username
    let contact = _db.prepare(
      "SELECT * FROM contacts WHERE tenant_id = ? AND first_name = ? LIMIT 1"
    ).get(tenantId, username);
    if (!contact) {
      const r = _db.prepare(
        'INSERT INTO contacts (tenant_id, first_name, email) VALUES (?, ?, ?)'
      ).run(tenantId, username, null);
      contact = _db.prepare('SELECT * FROM contacts WHERE id = ?').get(r.lastInsertRowid);
    }

    // Una conversación por cuenta TikTok (agrupamos todos sus comentarios)
    const externalId = `tiktok-user-${row.id}-${username}`;
    const convo = convoSvc.findOrCreate(_db, tenantId, {
      provider:      'tiktok',
      externalId,
      integrationId: row.id,
      contactPhone:  null,
      contactName:   username,
      contactId:     contact?.id,
    });

    if (!convo.contact_id && contact?.id) {
      _db.prepare('UPDATE conversations SET contact_id = ? WHERE id = ?').run(contact.id, convo.id);
    }

    const isReply = !!comment.parent_comment_id;
    const body = isReply
      ? `↩️ @${username} en "${videoTitle}": ${comment.text.trim()}`
      : `💬 @${username} en "${videoTitle}": ${comment.text.trim()}`;

    // Guardar commentId y videoId en meta_json para poder responder
    const meta = JSON.stringify({ commentId: String(comment.id), videoId: video.id, videoTitle });

    // addMessage extendido: inserta meta_json si la columna existe
    const msgId = `tiktok-comment-${comment.id}`;
    const existing = _db.prepare(
      'SELECT id FROM messages WHERE provider = ? AND external_id = ? AND tenant_id = ?'
    ).get('tiktok', msgId, tenantId);
    if (!existing) {
      const ts = comment.create_time || Math.floor(Date.now() / 1000);
      _db.prepare(`
        INSERT INTO messages (tenant_id, conversation_id, external_id, direction, provider, body, status, created_at, meta_json)
        VALUES (?, ?, ?, 'incoming', 'tiktok', ?, 'delivered', ?, ?)
      `).run(tenantId, convo.id, msgId, body, ts, meta);
      _db.prepare(`
        UPDATE conversations
        SET last_message = ?, last_message_at = ?, unread_count = unread_count + 1, last_incoming_at = ?
        WHERE id = ? AND tenant_id = ?
      `).run(body.slice(0, 200), ts, ts, convo.id, tenantId);
    }
  }

  if (hasNew && newLastId) {
    _db.prepare(`
      INSERT INTO tiktok_video_state (integration_id, video_id, last_comment_id, updated_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(integration_id, video_id) DO UPDATE
        SET last_comment_id = excluded.last_comment_id, updated_at = excluded.updated_at
    `).run(row.id, video.id, newLastId);
  }
}

module.exports = { start, stop };
