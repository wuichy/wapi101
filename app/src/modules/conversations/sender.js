// Shared send helpers used by both conversations/routes.js and bot/engine.js
const { decryptJson } = require('../../security/crypto');
const { friendlyMetaError } = require('../integrations/meta-errors');

async function sendMessage(db, convo, text) {
  if (convo.provider === 'whatsapp')        return sendWhatsApp(db, convo, text);
  if (convo.provider === 'whatsapp-lite')   return sendWhatsAppLite(db, convo, text);
  if (convo.provider === 'messenger')       return sendMessenger(db, convo, text);
  if (convo.provider === 'instagram')       return sendInstagram(db, convo, text);
  if (convo.provider === 'telegram')        return sendTelegram(db, convo, text);
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
  if (!res.ok || data.error) throw new Error(friendlyMetaError(data.error) || `HTTP ${res.status}`);
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
    throw new Error(`Subida de archivo: ${friendlyMetaError(upJson?.error) || `HTTP ${upRes.status}`}`);
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
    throw new Error(friendlyMetaError(sendJson?.error) || `HTTP ${sendRes.status}`);
  }
  return sendJson.messages?.[0]?.id || null;
}

// Resuelve el valor de un placeholder leyendo del contacto según contactField.
// Si el campo no aplica o no hay dato, usa manualValues[index] como fallback.
function _resolvePlaceholder(ph, contact, manualValues, idx) {
  if (ph?.contactField) {
    if (ph.contactField === 'first_name')  return contact?.first_name || '';
    if (ph.contactField === 'last_name')   return contact?.last_name || '';
    if (ph.contactField === 'full_name')   return [contact?.first_name, contact?.last_name].filter(Boolean).join(' ');
    if (ph.contactField === 'phone')       return contact?.phone || '';
    if (ph.contactField === 'email')       return contact?.email || '';
  }
  // Manual o fallback
  return manualValues?.[idx] ?? '';
}

// Envía una plantilla wa_api APROBADA al cliente.
//   templateId    → id en message_templates de la plantilla a enviar
//   manualValues  → array (index = placeholder N-1) con valores para los Manual
async function sendWhatsAppTemplate(db, convo, templateId, manualValues = []) {
  const { phoneNumberId, accessToken } = _getWAClientCreds(db, convo);

  // Cargar plantilla con sus campos parseados (buttons, bodyPlaceholders).
  const tplSvc = require('../templates/service');
  const tpl = tplSvc.getById(db, Number(templateId));
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
      const value = _resolvePlaceholder(ph, contact, manualValues, i);
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
    throw new Error(friendlyMetaError(data.error) || `HTTP ${res.status}`);
  }
  return { externalId: data.messages?.[0]?.id || null, renderedBody: bodyText.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const ph = tpl.bodyPlaceholders?.[Number(n) - 1];
    return _resolvePlaceholder(ph, contact, manualValues, Number(n) - 1);
  }) };
}

async function sendMessenger(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId);
  const token = creds?.pageAccessToken;
  if (!token) throw new Error('No hay Page Access Token de Messenger configurado');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: convo.externalId }, message: { text } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.message_id || null;
}

// Messenger acepta media como URL pública (vía attachment.payload.url).
// type: 'image' | 'video' | 'audio' | 'file'
async function sendMessengerMedia(db, convo, { publicUrl, mediaType }) {
  const creds = getIntegrationCreds(db, convo.integrationId);
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
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.message_id || null;
}

async function sendInstagram(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId);
  const token = creds?.accessToken;
  if (!token) throw new Error('No hay Access Token de Instagram configurado');

  const version = process.env.META_GRAPH_VERSION || 'v22.0';
  const res = await fetch(`https://graph.facebook.com/${version}/me/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recipient: { id: convo.externalId }, message: { text } }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.message_id || null;
}

// Instagram solo soporta image / video / audio (NO file/document).
async function sendInstagramMedia(db, convo, { publicUrl, mediaType }) {
  if (mediaType === 'document') throw new Error('Instagram no permite enviar documentos. Solo imágenes, videos y audios.');
  const creds = getIntegrationCreds(db, convo.integrationId);
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
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.message_id || null;
}

async function sendTelegram(db, convo, text) {
  const creds = getIntegrationCreds(db, convo.integrationId);
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
  const creds = getIntegrationCreds(db, convo.integrationId);
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

function getIntegrationCreds(db, integrationId) {
  if (!integrationId) return null;
  const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(integrationId);
  if (!row?.credentials_enc) return null;
  return decryptJson(row.credentials_enc) || null;
}

module.exports = { sendMessage, sendWhatsApp, sendWhatsAppMedia, sendWhatsAppTemplate, sendWhatsAppLite, sendWhatsAppLiteMedia, sendMessenger, sendMessengerMedia, sendInstagram, sendInstagramMedia, sendTelegram, sendTelegramMedia, getIntegrationCreds };
