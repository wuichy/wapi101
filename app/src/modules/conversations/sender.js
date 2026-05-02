// Shared send helpers used by both conversations/routes.js and bot/engine.js
const { decryptJson } = require('../../security/crypto');

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

async function sendWhatsApp(db, convo, text) {
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
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data.messages?.[0]?.id || null;
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

function getIntegrationCreds(db, integrationId) {
  if (!integrationId) return null;
  const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(integrationId);
  if (!row?.credentials_enc) return null;
  return decryptJson(row.credentials_enc) || null;
}

module.exports = { sendMessage, sendWhatsApp, sendWhatsAppLite, sendMessenger, sendInstagram, sendTelegram, getIntegrationCreds };
