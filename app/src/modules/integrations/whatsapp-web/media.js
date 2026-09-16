// ── Descarga de fotos, audios, videos y documentos que llegan por WhatsApp Lite ──
//
// 🐛 16-sep-2026: el puente Lite NUNCA descargaba la media. extractIncomingBody
// (manager.js) solo ponía el placeholder ("🖼️ Imagen") y la burbuja se quedaba
// con el ícono pero sin imagen. Medido: 71 imágenes en 30 días por Lite, CERO
// guardadas — mientras la API sí las guardaba (webhooks.js,
// _downloadAndStoreWhatsAppMedia). No era cosa de iPhone: le pasaba a toda la
// media que entraba por Lite.
//
// Mismo patrón que la API: el mensaje se guarda primero (la burbuja aparece al
// instante con su placeholder), la media se baja en SEGUNDO PLANO, se escribe
// en data/uploads/chat-media/in-<msgId>-<ts>.<ext> y se actualiza media_url.
// El chat refresca cada 5 s, así que la imagen aparece sola.
//
// La EXTENSIÓN importa: app.js decide cómo pintarla por la extensión del
// archivo (jpg/png/webp/gif → <img>, mp4/3gp/mov/webm → <video>,
// mp3/ogg/m4a/aac/opus/wav → <audio>, pdf/doc/xls/ppt/txt → documento).
//
// Si algo falla, el POR QUÉ queda en messages.error_reason y en el log; el
// mensaje nunca se pierde (conserva su placeholder).

const path = require('path');
const fs = require('fs');

const DOWNLOADABLE = new Set(['image', 'video', 'audio', 'voice', 'document', 'sticker']);
const MAX_BYTES = 25 * 1024 * 1024;

// Contenedores que envuelven el contenido real (mismos que extractIncomingBody).
const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2',
  'viewOnceMessageV2Extension', 'documentWithCaptionMessage'];

const KINDS = {
  imageMessage: 'image', videoMessage: 'video', audioMessage: 'audio',
  documentMessage: 'document', stickerMessage: 'sticker',
};

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
};

function unwrap(message) {
  let m = message;
  for (let i = 0; i < 6 && m; i++) {
    const w = WRAPPERS.find((k) => m[k]?.message);
    if (!w) break;
    m = m[w].message;
  }
  return m;
}

// { kind, mimetype, fileName, fileLength } del adjunto, o null si no trae media.
function mediaInfo(message) {
  const m = unwrap(message);
  if (!m) return null;
  for (const [key, kind] of Object.entries(KINDS)) {
    const c = m[key];
    if (c) {
      return {
        kind,
        mimetype: c.mimetype || '',
        fileName: c.fileName || null,
        fileLength: Number(c.fileLength) || 0,
      };
    }
  }
  return null;
}

function extFor({ mimetype, fileName, kind }) {
  // Un documento conserva la extensión con la que lo mandaron (Factura.PDF → pdf).
  if (kind === 'document' && fileName) {
    const m = String(fileName).match(/\.([a-z0-9]{1,6})$/i);
    if (m) return m[1].toLowerCase();
  }
  const base = String(mimetype || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base];
  if (kind === 'sticker') return 'webp';
  if (kind === 'image') return 'jpg';
  if (kind === 'audio' || kind === 'voice') return 'ogg';
  if (kind === 'video') return 'mp4';
  return 'bin';
}

function _mb(bytes) { return (bytes / 1048576).toFixed(1); }

async function downloadAndStore({ db, msgId, rawMessage, download, uploadsDir, log = console }) {
  const info = mediaInfo(rawMessage?.message);
  if (!info) return { ok: false, reason: 'sin media' };

  const fail = (reason) => {
    try { db.prepare('UPDATE messages SET error_reason = ? WHERE id = ?').run(String(reason).slice(0, 300), msgId); } catch (_) {}
    try { log.warn(`[wa-web media] msg #${msgId}: ${reason}`); } catch (_) {}
    return { ok: false, reason };
  };

  if (info.fileLength > MAX_BYTES) {
    return fail(`archivo muy grande (${_mb(info.fileLength)} MB, tope 25 MB) — ábrelo en el celular`);
  }

  let buffer;
  try {
    buffer = await download(rawMessage);
  } catch (err) {
    return fail(`descarga falló: ${err?.message || err}`);
  }
  if (!buffer || !buffer.length) return fail('descarga vacía');
  if (buffer.length > MAX_BYTES) return fail(`archivo muy grande (${_mb(buffer.length)} MB, tope 25 MB)`);

  try {
    const root = uploadsDir || path.resolve(process.env.UPLOADS_DIR || './data/uploads');
    const dir = path.join(root, 'chat-media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const name = `in-${msgId}-${Date.now()}.${extFor(info)}`;
    fs.writeFileSync(path.join(dir, name), buffer);
    const url = `/uploads/chat-media/${name}`;
    db.prepare('UPDATE messages SET media_url = ?, error_reason = NULL WHERE id = ?').run(url, msgId);
    try { log.log(`[wa-web media] msg #${msgId} → ${url} (${(buffer.length / 1024).toFixed(1)} KB)`); } catch (_) {}
    return { ok: true, url };
  } catch (err) {
    return fail(`no se pudo guardar: ${err?.message || err}`);
  }
}

module.exports = { DOWNLOADABLE, MAX_BYTES, unwrap, mediaInfo, extFor, downloadAndStore };
