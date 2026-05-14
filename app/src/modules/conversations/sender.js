// Shared send helpers used by both conversations/routes.js and bot/engine.js
const { decryptJson } = require('../../security/crypto');
const { friendlyMetaError, isMetaAuthError } = require('../integrations/meta-errors');
const integrationsSvc = require('../integrations/service');

// Si el error es de auth (token caducado/inválido), marca la integración como
// disconnected para que el frontend muestre el aviso de reconectar.
// `errOrData` puede ser un Error (string en .message) o el objeto data.error de Meta.
function _maybeMarkAuthFailed(db, integrationId, errOrData, friendly) {
  if (!integrationId) return;
  if (!isMetaAuthError(errOrData)) return;
  try { integrationsSvc.markAuthFailed(db, integrationId, friendly || (errOrData?.message || String(errOrData))); } catch (_) {}
}

async function sendMessage(db, convo, text) {
  if (convo.provider === 'whatsapp')        return sendWhatsApp(db, convo, text);
  if (convo.provider === 'whatsapp-lite')   return sendWhatsAppLite(db, convo, text);
  if (convo.provider === 'messenger')       return sendMessenger(db, convo, text);
  if (convo.provider === 'instagram')       return sendInstagram(db, convo, text);
  if (convo.provider === 'telegram')        return sendTelegram(db, convo, text);
  if (convo.provider === 'email' || convo.provider === 'gmail' || convo.provider === 'outlook' || convo.provider === 'icloud_mail' || convo.provider === 'yahoo_mail') return sendEmail(db, convo, text);
  if (convo.provider === 'tiktok') return sendTikTokReply(db, convo, text);
  console.warn(`[sender] envío para provider ${convo.provider} no implementado`);
  return null;
}

// WhatsApp Lite: envío vía Baileys (sesión persistente del manager).
// No usa Cloud API; el manager mantiene un socket abierto por integración.
async function sendWhatsAppLite(db, convo, text) {
  if (!convo.integrationId) throw new Error('Conversación sin integración asociada');
  const manager = require('../integrations/whatsapp-web/manager');
  return manager.sendText(convo.integrationId, convo.externalId, text);
}

async function sendWhatsAppLiteMedia(db, convo, { buffer, mimetype, filename, caption, mediaType }) {
  if (!convo.integrationId) throw new Error('Conversación sin integración asociada');
  const manager = require('../integrations/whatsapp-web/manager');
  return manager.sendMedia(convo.integrationId, convo.externalId, { buffer, mimetype, filename, caption, mediaType });
}

function _getWAClientCreds(db, convo) {
  // Auto-heal: si la convo no tiene integration_id, buscar integración WA activa
  // del mismo tenant y vincularla al vuelo (igual que getIntegrationCreds para Messenger).
  if (!convo.integrationId && convo.id && convo.tenantId) {
    const integration = db.prepare(
      "SELECT id FROM integrations WHERE provider = 'whatsapp' AND tenant_id = ? AND status = 'connected' ORDER BY id DESC LIMIT 1"
    ).get(convo.tenantId);
    if (integration) {
      db.prepare('UPDATE conversations SET integration_id = ? WHERE id = ? AND tenant_id = ?')
        .run(integration.id, convo.id, convo.tenantId);
      convo.integrationId = integration.id;
      console.log(`[sender] wa auto-cured: convo ${convo.id} → integration ${integration.id}`);
    }
  }

  let phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  let accessToken   = process.env.WHATSAPP_ACCESS_TOKEN;
  if (convo.integrationId) {
    const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(convo.integrationId);
    if (row?.credentials_enc) {
      const creds = decryptJson(row.credentials_enc) || {};
      if (creds.phoneNumberId) phoneNumberId = creds.phoneNumberId;
      if (creds.accessToken)   accessToken   = creds.accessToken;
    }
  }
  if (!phoneNumberId || !accessToken) throw new Error('No hay credenciales de WhatsApp configuradas');
  return { phoneNumberId, accessToken };
}

async function sendWhatsApp(db, convo, text) {
  const { phoneNumberId, accessToken } = _getWAClientCreds(db, convo);
  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: convo.externalId,
      type: 'text',
      text: { body: text },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = friendlyMetaError(data.error) || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return data.messages?.[0]?.id || null;
}

// Envía un archivo (imagen/documento/video/audio) por WhatsApp Cloud API.
// Flujo de 2 pasos sin URL pública (Opción A: archivo nunca queda expuesto):
//   1) POST /<phone_number_id>/media (multipart) → media_id
//   2) POST /<phone_number_id>/messages con { type, <type>: { id, caption?, filename? } }
async function sendWhatsAppMedia(db, convo, { buffer, mimetype, filename, caption, mediaType }) {
  if (!buffer || !buffer.length) throw new Error('Archivo vacío');
  const { phoneNumberId, accessToken } = _getWAClientCreds(db, convo);
  const version = process.env.META_GRAPH_VERSION || 'v22.0';

  // Step 1 — subir a Meta /media (multipart). FormData nativo de Node 18+.
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', mimetype);
  // Blob requiere el filename para que Meta acepte ciertos tipos (PDF, etc.)
  const blob = new Blob([buffer], { type: mimetype });
  fd.append('file', blob, filename || 'file');
  const upRes = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: fd,
  });
  const upJson = await upRes.json().catch(() => ({}));
  if (!upRes.ok || !upJson.id) {
    const friendly = friendlyMetaError(upJson?.error) || `HTTP ${upRes.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, upJson?.error, friendly);
    throw new Error(`Subida de archivo: ${friendly}`);
  }
  const mediaId = upJson.id;

  // Step 2 — enviar mensaje referenciando el media_id
  const typeKey = mediaType; // image | document | video | audio
  const mediaPayload = { id: mediaId };
  if (caption && (typeKey === 'image' || typeKey === 'video' || typeKey === 'document')) {
    mediaPayload.caption = caption;
  }
  if (typeKey === 'document' && filename) mediaPayload.filename = filename;

  const sendRes = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: convo.externalId,
      type: typeKey,
      [typeKey]: mediaPayload,
    }),
  });
  const sendJson = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok || sendJson.error) {
    const msg = friendlyMetaError(sendJson?.error) || `HTTP ${sendRes.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, sendJson?.error, msg);
    throw new Error(msg);
  }
  return sendJson.messages?.[0]?.id || null;
}

// Resuelve el valor de un placeholder leyendo del contacto según contactField.
// Si el campo no aplica o no hay dato, usa manualValues[index] como fallback.
// Cuando autoFallback=true (caso típico: bot disparando template Manual), si no
// hay valor manual usa first_name del contacto en vez de devolver vacío. Esto
// evita que un bot reviente porque el placeholder Manual no tiene valor pre-cargado.
function _resolvePlaceholder(ph, contact, manualValues, idx, autoFallback = false) {
  if (ph?.contactField) {
    if (ph.contactField === 'first_name')  return contact?.first_name || '';
    if (ph.contactField === 'last_name')   return contact?.last_name || '';
    if (ph.contactField === 'full_name')   return [contact?.first_name, contact?.last_name].filter(Boolean).join(' ');
    if (ph.contactField === 'phone')       return contact?.phone || '';
    if (ph.contactField === 'email')       return contact?.email || '';
  }
  const manual = manualValues?.[idx];
  if (manual !== undefined && manual !== null && manual !== '') return manual;
  if (autoFallback) return contact?.first_name || '';
  return '';
}

// Envía una plantilla wa_api APROBADA al cliente.
//   templateId    → id en message_templates de la plantilla a enviar
//   manualValues  → array (index = placeholder N-1) con valores para los Manual
async function sendWhatsAppTemplate(db, convo, templateId, manualValues = [], { autoFallback = false } = {}) {
  const { phoneNumberId, accessToken } = _getWAClientCreds(db, convo);

  // Cargar plantilla con sus campos parseados (buttons, bodyPlaceholders).
  // tenantId=null deja que el caller (sender.js, llamado desde el bot engine
  // o conversations) busque la plantilla globalmente; el filtro real ya pasó
  // por la conversación / contacto del mismo tenant.
  const tplSvc = require('../templates/service');
  const tpl = tplSvc.getById(db, null, Number(templateId));
  if (!tpl) throw new Error('Plantilla no encontrada');
  if (tpl.type !== 'wa_api') throw new Error('Solo plantillas WhatsApp API se envían como template');
  if (tpl.waStatus !== 'approved') throw new Error(`Plantilla no aprobada por Meta (status: ${tpl.waStatus})`);

  // Cargar el contacto para sustituir variables mapeadas.
  const contact = db.prepare('SELECT id, first_name, last_name, phone, email FROM contacts WHERE id = ?').get(convo.contactId || convo.contact_id);

  const components = [];

  // HEADER con media — necesitamos un link público (preferimos headerMediaUrl
  // que generamos al subir el archivo). Si no hay, error.
  if (tpl.headerType === 'IMAGE' || tpl.headerType === 'VIDEO' || tpl.headerType === 'DOCUMENT') {
    if (!tpl.headerMediaUrl) {
      throw new Error('Plantilla con header media pero sin URL pública guardada — re-sube el archivo');
    }
    const fmtKey = tpl.headerType.toLowerCase(); // image | video | document
    const param = { type: fmtKey };
    param[fmtKey] = { link: tpl.headerMediaUrl };
    components.push({ type: 'header', parameters: [param] });
  }

  // BODY — si tiene {{N}}, sustituir.
  const bodyText = tpl.body || '';
  const varNums = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  if (varNums.length) {
    const max = Math.max(...varNums);
    const params = [];
    for (let i = 0; i < max; i++) {
      const ph = Array.isArray(tpl.bodyPlaceholders) ? tpl.bodyPlaceholders[i] : null;
      const value = _resolvePlaceholder(ph, contact, manualValues, i, autoFallback);
      if (!value) {
        throw new Error(`Falta el valor para placeholder {{${i + 1}}} (${ph?.label || 'sin nombre'}). ${ph?.contactField ? 'El contacto no tiene ese campo.' : 'Es Manual — provee el valor al enviar.'}`);
      }
      params.push({ type: 'text', text: String(value) });
    }
    components.push({ type: 'body', parameters: params });
  }

  // BUTTONS — si la plantilla tiene URL buttons con variables {{N}} habría que
  // pasar parameters. Por ahora soportamos botones sin variables (fijos), así
  // que no se incluyen en components al enviar (Meta usa los del template).

  const payload = {
    messaging_product: 'whatsapp',
    to: convo.externalId,
    type: 'template',
    template: {
      name: tpl.name,
      language: { code: tpl.language || 'es_MX' },
      components,
    },
  };

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = friendlyMetaError(data.error) || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return { externalId: data.messages?.[0]?.id || null, renderedBody: bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const ph = tpl.bodyPlaceholders?.[Number(n) - 1];
    return _resolvePlaceholder(ph, contact, manualValues, Number(n) - 1, autoFallback);
  }) };
}

async function sendMessenger(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.pageAccessToken;
  if (!token) throw new Error('No hay Page Access Token de Messenger configurado');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: convo.externalId }, message: { text } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return data.message_id || null;
}

// Messenger acepta media como URL pública (vía attachment.payload.url).
// type: 'image' | 'video' | 'audio' | 'file'
async function sendMessengerMedia(db, convo, { publicUrl, mediaType }) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.pageAccessToken;
  if (!token) throw new Error('No hay Page Access Token de Messenger configurado');
  if (!publicUrl) throw new Error('Messenger requiere URL pública del archivo');

  const fbType = mediaType === 'document' ? 'file' : mediaType;
  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: convo.externalId },
      message: { attachment: { type: fbType, payload: { url: publicUrl, is_reusable: false } } },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return data.message_id || null;
}

async function sendInstagram(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.accessToken;
  if (!token) throw new Error('No hay Access Token de Instagram configurado');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: convo.externalId }, message: { text } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return data.message_id || null;
}

// Instagram solo soporta image / video / audio (NO file/document).
async function sendInstagramMedia(db, convo, { publicUrl, mediaType }) {
  if (mediaType === 'document') throw new Error('Instagram no permite enviar documentos. Solo imágenes, videos y audios.');
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.accessToken;
  if (!token) throw new Error('No hay Access Token de Instagram configurado');
  if (!publicUrl) throw new Error('Instagram requiere URL pública del archivo');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient: { id: convo.externalId },
      message: { attachment: { type: mediaType, payload: { url: publicUrl } } },
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    _maybeMarkAuthFailed(db, convo.integrationId, data.error, msg);
    throw new Error(msg);
  }
  return data.message_id || null;
}

async function sendTelegram(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.botToken;
  if (!token) throw new Error('No hay Bot Token de Telegram configurado');

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: convo.externalId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return String(data.result?.message_id || '') || null;
}

// Telegram envía media como multipart al endpoint correspondiente
// (sendPhoto/sendVideo/sendAudio/sendDocument). Soporta hasta 50MB.
async function sendTelegramMedia(db, convo, { buffer, mimetype, filename, caption, mediaType }) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  const token = creds?.botToken;
  if (!token) throw new Error('No hay Bot Token de Telegram configurado');
  if (!buffer || !buffer.length) throw new Error('Archivo vacío');

  const endpoints = { image: 'sendPhoto', video: 'sendVideo', audio: 'sendAudio', document: 'sendDocument' };
  const fields   = { image: 'photo',     video: 'video',     audio: 'audio',     document: 'document' };
  const endpoint = endpoints[mediaType];
  const field = fields[mediaType];
  if (!endpoint) throw new Error(`Tipo de media ${mediaType} no soportado en Telegram`);

  const fd = new FormData();
  fd.append('chat_id', String(convo.externalId));
  if (caption) fd.append('caption', caption);
  const blob = new Blob([buffer], { type: mimetype });
  fd.append(field, blob, filename || 'file');

  const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
    method: 'POST',
    body: fd,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return String(data.result?.message_id || '') || null;
}

async function sendEmail(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId, convo);
  if (!creds) throw new Error('No hay credenciales en la integración de email');
  const nodemailer = require('nodemailer');
  let transporter;
  if (creds.refreshToken) {
    let accessToken;
    const row = db.prepare('SELECT provider FROM conversations WHERE id = ?').get(convo.id);
    if (row?.provider === 'outlook') {
      const outlookProv = require('../integrations/providers/outlook');
      accessToken = await outlookProv.refreshMicrosoftToken(creds.refreshToken);
      transporter = nodemailer.createTransport({
        host: 'smtp.office365.com', port: 587, secure: false,
        auth: { type: 'OAuth2', user: creds.email, accessToken },
      });
    } else {
      const gmailProv = require('../integrations/providers/gmail');
      accessToken = await gmailProv.refreshGoogleToken(creds.refreshToken);
      transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { type: 'OAuth2', user: creds.email, accessToken },
      });
    }
  } else {
    if (!creds.smtpHost || !creds.username || !creds.password) {
      throw new Error('Faltan credenciales SMTP en la integración de email');
    }
    const port = Number(creds.smtpPort) || 587;
    transporter = nodemailer.createTransport({
      host: creds.smtpHost, port, secure: port === 465,
      auth: { user: creds.username, pass: creds.password },
    });
  }
  const toEmail = convo.external_id || convo.externalId;
  const fromEmail = creds.email || creds.fromEmail || creds.username;
  const fromName  = creds.fromName || creds.name || 'Wapi101';
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: toEmail,
    subject: 'Re: tu mensaje',
    text,
  });
  return info.messageId || null;
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

async function sendTikTokReply(db, convo, text) {
  if (!convo.integrationId) throw new Error('Conversación sin integración TikTok');
  const row = db.prepare('SELECT * FROM integrations WHERE id = ?').get(convo.integrationId);
  if (!row) throw new Error('Integración TikTok no encontrada');
  const creds = decryptJson(row.credentials_enc);
  if (!creds?.accessToken) throw new Error('TikTok sin access_token');

  // Obtener el último mensaje entrante para recuperar commentId y videoId
  const lastIn = db.prepare(
    "SELECT meta_json FROM messages WHERE conversation_id = ? AND direction = 'incoming' ORDER BY id DESC LIMIT 1"
  ).get(convo.id);
  let meta = {};
  try { if (lastIn?.meta_json) meta = JSON.parse(lastIn.meta_json); } catch {}

  const { commentId, videoId } = meta;
  if (!commentId || !videoId) throw new Error('No se encontró el comentario TikTok al que responder');

  const res = await fetch('https://open.tiktokapis.com/v2/video/comment/reply/create/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ video_id: videoId, parent_comment_id: commentId, text }),
  });
  const data = await res.json();
  if (data.error?.code) throw new Error(`TikTok reply error: ${data.error.message}`);
  return { externalId: data.data?.comment_id };
}

function getIntegrationCreds(db, integrationId, convo = null) {
  // Auto-heal: si la convo no tiene integration_id (huérfana), buscamos una
  // integración activa del mismo provider+tenant y la vinculamos al vuelo.
  // Solo se dispara cuando el código YA iba a fallar — sin convo o sin datos
  // suficientes regresa null como antes (no introduce nuevos error paths).
  if (!integrationId && convo?.id && convo?.provider && convo?.tenantId) {
    const integration = db.prepare(
      "SELECT id FROM integrations WHERE provider = ? AND tenant_id = ? AND status = 'connected' ORDER BY id DESC LIMIT 1"
    ).get(convo.provider, convo.tenantId);
    if (integration) {
      db.prepare('UPDATE conversations SET integration_id = ? WHERE id = ? AND tenant_id = ?')
        .run(integration.id, convo.id, convo.tenantId);
      integrationId = integration.id;
      convo.integrationId = integration.id; // mutate para callers
      console.log(`[sender] auto-cured: convo ${convo.id} (${convo.provider}) → integration ${integration.id}`);
    }
  }
  if (!integrationId) return null;
  const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(integrationId);
  if (!row?.credentials_enc) return null;
  return decryptJson(row.credentials_enc) || null;
}

module.exports = { sendMessage, sendWhatsApp, sendWhatsAppMedia, sendWhatsAppTemplate, sendWhatsAppLite, sendWhatsAppLiteMedia, sendMessenger, sendMessengerMedia, sendInstagram, sendInstagramMedia, sendTelegram, sendTelegramMedia, getIntegrationCreds };
