// Gestor de sesiones de WhatsApp Web (vía Baileys).
// Cada integración 'whatsapp-lite' tiene una sesión persistente: socket abierto,
// QR mientras se conecta, auth state guardado en data/wa-sessions/<id>/.
//
// Este módulo es independiente del Cloud API: no usa graph.facebook.com.
// Mensajes entrantes llegan por evento `messages.upsert` (no por webhook HTTP).

const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// integrationId → { sock, status, qrDataUrl, qrRaw, phoneNumber, error, startedAt, lastConnAt }
const sessions = new Map();

// Extrae body + type de un mensaje entrante de Baileys. Cubre los tipos más
// comunes; cuando no hay texto, devuelve un placeholder visible (ej. "🖼️ Imagen")
// para que la burbuja no aparezca vacía mientras no descarguemos los adjuntos.
function extractIncomingBody(message) {
  if (!message) return { body: '', messageType: 'unknown' };

  // Algunos tipos envuelven el contenido real en un sub-mensaje
  if (message.ephemeralMessage?.message)            return extractIncomingBody(message.ephemeralMessage.message);
  if (message.viewOnceMessage?.message)             return extractIncomingBody(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2?.message)           return extractIncomingBody(message.viewOnceMessageV2.message);
  if (message.viewOnceMessageV2Extension?.message)  return extractIncomingBody(message.viewOnceMessageV2Extension.message);
  if (message.documentWithCaptionMessage?.message)  return extractIncomingBody(message.documentWithCaptionMessage.message);

  const messageType = Object.keys(message)[0] || 'unknown';

  // Texto puro
  if (message.conversation)              return { body: message.conversation, messageType: 'text' };
  if (message.extendedTextMessage?.text) return { body: message.extendedTextMessage.text, messageType: 'text' };

  // Media con caption opcional
  if (message.imageMessage)    return { body: message.imageMessage.caption    || '🖼️ Imagen',     messageType: 'image' };
  if (message.videoMessage)    return { body: message.videoMessage.caption    || '🎬 Video',      messageType: 'video' };
  if (message.documentMessage) {
    const cap = message.documentMessage.caption;
    const file = message.documentMessage.fileName || message.documentMessage.title || 'Documento';
    return { body: cap || `📄 ${file}`, messageType: 'document' };
  }
  if (message.audioMessage) {
    const isPtt = message.audioMessage.ptt;
    return { body: isPtt ? '🎙️ Mensaje de voz' : '🎵 Audio', messageType: isPtt ? 'voice' : 'audio' };
  }
  if (message.stickerMessage)  return { body: '🩰 Sticker',     messageType: 'sticker' };

  // Ubicaciones
  if (message.locationMessage) {
    const lat = message.locationMessage.degreesLatitude;
    const lng = message.locationMessage.degreesLongitude;
    const name = message.locationMessage.name || message.locationMessage.address || '';
    const coords = (lat != null && lng != null) ? ` (${lat.toFixed(5)}, ${lng.toFixed(5)})` : '';
    return { body: `📍 Ubicación${name ? ` · ${name}` : ''}${coords}`, messageType: 'location' };
  }
  if (message.liveLocationMessage) return { body: '📍 Ubicación en vivo', messageType: 'live_location' };

  // Contactos
  if (message.contactMessage) {
    const name = message.contactMessage.displayName || 'Contacto';
    return { body: `👤 ${name}`, messageType: 'contact' };
  }
  if (message.contactsArrayMessage) {
    const n = (message.contactsArrayMessage.contacts || []).length;
    return { body: `👤 ${n} contacto${n === 1 ? '' : 's'}`, messageType: 'contacts' };
  }

  // Botones / listas / templates (responses)
  if (message.buttonsResponseMessage)        return { body: message.buttonsResponseMessage.selectedDisplayText || message.buttonsResponseMessage.selectedButtonId || '🔘 Botón', messageType: 'button_reply' };
  if (message.listResponseMessage)           return { body: message.listResponseMessage.title || '📋 Lista', messageType: 'list_reply' };
  if (message.templateButtonReplyMessage)    return { body: message.templateButtonReplyMessage.selectedDisplayText || '🔘 Botón', messageType: 'template_reply' };
  if (message.interactiveResponseMessage)    return { body: '🔘 Respuesta interactiva', messageType: 'interactive_reply' };

  // Encuestas
  if (message.pollCreationMessage)   return { body: `📊 Encuesta: ${message.pollCreationMessage.name || ''}`.trim(), messageType: 'poll' };
  if (message.pollUpdateMessage)     return { body: '📊 Voto en encuesta', messageType: 'poll_vote' };

  // Reacciones
  if (message.reactionMessage) {
    const emoji = message.reactionMessage.text || '';
    return { body: emoji ? `Reaccionó: ${emoji}` : 'Quitó la reacción', messageType: 'reaction' };
  }

  // Sistemas / silenciables
  if (message.protocolMessage)              return { body: '', messageType: 'protocol' };          // edits, deletes, key changes
  if (message.senderKeyDistributionMessage) return { body: '', messageType: 'system_keys' };

  // Fallback: tipo desconocido
  return { body: `📩 Mensaje (${messageType})`, messageType };
}

// Callbacks globales (los registra el caller; no los hardcodeamos aquí para mantener desacoplado)
let onMessageCallback = null;
let onConnectedCallback = null;
let onDisconnectedCallback = null;

// Auth state de Baileys: vive junto a la DB (DB_PATH). Si DB está fuera de iCloud,
// las sesiones también, evitando corrupciones por sync.
const SESSIONS_ROOT = process.env.WA_SESSIONS_DIR
  || (process.env.DB_PATH ? path.join(path.dirname(process.env.DB_PATH), 'wa-sessions') : null)
  || path.resolve(__dirname, '../../../../data/wa-sessions');

function ensureSessionsRoot() {
  if (!fs.existsSync(SESSIONS_ROOT)) fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
}
function sessionDir(integrationId) {
  const dir = path.join(SESSIONS_ROOT, String(integrationId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function setHandlers({ onMessage, onConnected, onDisconnected }) {
  if (onMessage) onMessageCallback = onMessage;
  if (onConnected) onConnectedCallback = onConnected;
  if (onDisconnected) onDisconnectedCallback = onDisconnected;
}

async function startSession(integrationId, { reconnectAttempts = 0 } = {}) {
  ensureSessionsRoot();

  // Limpiar sesión previa si existe (sin borrar credenciales)
  const prev = sessions.get(integrationId);
  if (prev?.sock) {
    try { prev.sock.end(); } catch (_) {}
  }

  const dir = sessionDir(integrationId);
  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Wapi101 CRM', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  const session = {
    sock,
    status: 'connecting', // connecting | qr | connected | disconnected | error
    qrDataUrl: null,
    qrRaw: null,
    phoneNumber: null,
    pushName: null,
    error: null,
    startedAt: Date.now(),
    lastConnAt: null,
  };
  sessions.set(integrationId, session);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        session.qrRaw = qr;
        session.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        session.status = 'qr';
        console.log(`[wa-web ${integrationId}] QR disponible`);
      } catch (err) {
        console.error(`[wa-web ${integrationId}] error generando QR:`, err.message);
      }
    }

    if (connection === 'open') {
      session.status = 'connected';
      session.qrDataUrl = null;
      session.qrRaw = null;
      session.error = null;
      session.lastConnAt = Date.now();
      const userId = sock.user?.id || '';
      session.phoneNumber = userId.split(':')[0]?.split('@')[0] || null;
      session.pushName = sock.user?.name || null;
      console.log(`[wa-web ${integrationId}] conectado como ${session.phoneNumber}`);
      try { onConnectedCallback?.(integrationId, session); }
      catch (err) { console.error(`[wa-web ${integrationId}] onConnected error:`, err.message); }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const msg  = lastDisconnect?.error?.message || 'desconectado';
      const loggedOut = code === DisconnectReason.loggedOut;

      if (loggedOut) {
        session.status = 'disconnected';
        session.error = 'Sesión cerrada en el dispositivo';
        console.warn(`[wa-web ${integrationId}] sesión cerrada (logout)`);
        // Borrar archivos de auth — la próxima vez requerirá QR nuevo
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      } else {
        // Reconexión exponencial con tope
        const next = Math.min(reconnectAttempts + 1, 10);
        const delay = Math.min(2000 * Math.pow(1.5, reconnectAttempts), 60000);
        session.status = 'connecting';
        session.error = `Reconectando: ${msg}`;
        console.warn(`[wa-web ${integrationId}] desconectado (${msg}); reintento ${next} en ${Math.round(delay)}ms`);
        setTimeout(() => {
          startSession(integrationId, { reconnectAttempts: next })
            .catch((err) => console.error(`[wa-web ${integrationId}] reintento falló:`, err.message));
        }, delay);
      }

      try { onDisconnectedCallback?.(integrationId, { loggedOut, message: msg }); }
      catch (err) { console.error(`[wa-web ${integrationId}] onDisconnected error:`, err.message); }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // 'notify' = mensaje en tiempo real.
    // 'append' = mensajes que llegaron mientras el socket estaba reconectando
    //            (típico en el "Stream Errored" del primer auth). Los aceptamos
    //            solo si tienen timestamp < 10 min para no reenviar historial viejo.
    if (type !== 'notify' && type !== 'append') return;
    const nowSec = Math.floor(Date.now() / 1000);

    for (const msg of messages) {
      if (!msg?.message) continue;
      if (msg.key?.fromMe) continue;
      const remoteJid = msg.key?.remoteJid || '';
      // Ignorar grupos / broadcasts por ahora (solo 1-a-1)
      if (!remoteJid.endsWith('@s.whatsapp.net')) continue;

      // Para 'append', solo procesar mensajes de los últimos 10 minutos
      if (type === 'append') {
        const msgTime = Number(msg.messageTimestamp) || 0;
        if (nowSec - msgTime > 600) continue;
      }

      const phone = remoteJid.replace('@s.whatsapp.net', '');
      const { body, messageType } = extractIncomingBody(msg.message);

      // Saltar mensajes de sistema (revokes, key changes, etc.) que no deben
      // mostrarse como burbujas en el chat.
      if (messageType === 'protocol' || messageType === 'system_keys') continue;
      // Saltar recibos/status de entrega (IDs con prefijo 3A) que llegan sin cuerpo.
      if (!body) continue;

      try {
        onMessageCallback?.(integrationId, {
          externalId:    phone,                           // E.164 sin '+'
          messageId:     msg.key.id,
          body,
          pushName:      msg.pushName || null,
          timestamp:     Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000),
          messageType,
        });
      } catch (err) {
        console.error(`[wa-web ${integrationId}] onMessage error:`, err.message);
      }
    }
  });

  return session;
}

async function sendText(integrationId, externalId, text) {
  const session = sessions.get(integrationId);
  if (!session?.sock) throw new Error('Sesión de WhatsApp Web no inicializada');
  if (session.status !== 'connected') throw new Error(`WhatsApp Web no conectado (estado: ${session.status})`);

  // Normalizar a JID: si viene como '+5215555...' o '5215555...', convertir
  const num = String(externalId).replace(/[^0-9]/g, '');
  if (!num) throw new Error('Número inválido');
  const jid = `${num}@s.whatsapp.net`;

  const result = await session.sock.sendMessage(jid, { text });
  return result?.key?.id || null;
}

// Envía un archivo (imagen/documento/video/audio) por Baileys.
// mediaType: 'image' | 'document' | 'video' | 'audio'
async function sendMedia(integrationId, externalId, { buffer, mimetype, filename, caption, mediaType }) {
  const session = sessions.get(integrationId);
  if (!session?.sock) throw new Error('Sesión de WhatsApp Web no inicializada');
  if (session.status !== 'connected') throw new Error(`WhatsApp Web no conectado (estado: ${session.status})`);
  if (!buffer || !buffer.length) throw new Error('Archivo vacío');

  const num = String(externalId).replace(/[^0-9]/g, '');
  if (!num) throw new Error('Número inválido');
  const jid = `${num}@s.whatsapp.net`;

  let payload;
  if (mediaType === 'image')      payload = { image: buffer, caption: caption || '' };
  else if (mediaType === 'video') payload = { video: buffer, caption: caption || '', mimetype };
  else if (mediaType === 'audio') payload = { audio: buffer, mimetype: mimetype || 'audio/ogg' };
  else                            payload = { document: buffer, mimetype, fileName: filename || 'archivo', caption: caption || '' };

  const result = await session.sock.sendMessage(jid, payload);
  return result?.key?.id || null;
}

function getStatus(integrationId) {
  const s = sessions.get(integrationId);
  if (!s) return { status: 'not_started' };
  return {
    status:      s.status,
    qrDataUrl:   s.qrDataUrl,
    phoneNumber: s.phoneNumber,
    pushName:    s.pushName,
    error:       s.error,
    startedAt:   s.startedAt,
    lastConnAt:  s.lastConnAt,
  };
}

async function stopSession(integrationId, { logout = true, removeAuth = true } = {}) {
  const s = sessions.get(integrationId);
  if (s?.sock) {
    if (logout) { try { await s.sock.logout(); } catch (_) {} }
    try { s.sock.end(); } catch (_) {}
  }
  sessions.delete(integrationId);
  if (removeAuth) {
    const dir = sessionDir(integrationId);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

function listSessions() {
  const out = [];
  for (const [id, s] of sessions.entries()) {
    out.push({ integrationId: id, status: s.status, phoneNumber: s.phoneNumber });
  }
  return out;
}

// Restaura todas las sesiones marcadas como 'connected' en DB al boot.
// El caller pasa la lista de IDs (no acoplamos con DB aquí).
async function restoreAll(integrationIds) {
  for (const id of integrationIds) {
    try {
      // Si no existe carpeta de auth, no tiene sentido (requiere QR fresco)
      const dir = path.join(SESSIONS_ROOT, String(id));
      if (!fs.existsSync(dir) || fs.readdirSync(dir).length === 0) {
        console.warn(`[wa-web ${id}] no hay auth state — saltado en restore`);
        continue;
      }
      await startSession(id);
      console.log(`[wa-web ${id}] sesión restaurada`);
    } catch (err) {
      console.error(`[wa-web ${id}] no se pudo restaurar:`, err.message);
    }
  }
}

// Intenta obtener la foto de perfil de un contacto por su número.
// Devuelve la URL o null si no tiene foto / está bloqueado por privacidad.
async function getProfilePicUrl(integrationId, phone) {
  const s = sessions.get(integrationId);
  if (!s?.sock || s.status !== 'connected') return null;
  const jid = `${String(phone).replace(/\D/g, '')}@s.whatsapp.net`;
  try {
    return await s.sock.profilePictureUrl(jid, 'image') || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  setHandlers,
  startSession,
  sendText,
  sendMedia,
  getStatus,
  stopSession,
  listSessions,
  restoreAll,
  getProfilePicUrl,
};
