const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const path = require('path');
const config = require('./lib/config');
const store = require('./lib/store');
const kommo = require('./lib/kommo');
const auth = require('./lib/auth');
const push = require('./lib/push');

const app = express();

const uploadsDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── Módulo WooCommerce → Kommo ─────────────────────────────────────
// Mount ANTES del express.json global para que el verify HMAC del
// módulo capture el rawBody correctamente. Las rutas /wc/* son
// públicas (el webhook valida con HMAC, no con auth de sesión).
// Aislado: si este módulo falla, /wc/* devuelve error pero el chat
// principal sigue funcionando intacto.
app.use('/wc', require('./reelance-hub-woocommerce-kommo'));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Login endpoints (public — auth middleware lets them through)
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  if (!auth.isAuthEnabled()) {
    return res.status(500).json({ error: 'La autenticación no está configurada.' });
  }

  const submitted = req.body?.password || '';
  if (!auth.passwordMatches(submitted)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }

  const cookie = auth.signSession({ user: 'admin' });
  res.setHeader('Set-Cookie', auth.buildSessionCookie(cookie));
  res.json({ ok: true });
});

app.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', auth.buildLogoutCookie());
  res.json({ ok: true });
});

// Auth gate for everything below
app.use(auth.requireAuth);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// ── Preview HTML con OpenGraph para que WhatsApp muestre miniatura del archivo ──
// Cuando un agente manda una imagen, en lugar de pasar la URL cruda al cliente
// (que llega como kommo.cc/K/... texto), pasamos esta URL HTML que WhatsApp
// fetchea y descubre meta og:image → muestra preview con la imagen inline.
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg']);

app.get('/preview/:filename', (req, res) => {
  const safe = path.basename(String(req.params.filename || ''));
  const filePath = path.join(uploadsDir, safe);
  if (!safe || !fs.existsSync(filePath)) {
    return res.status(404).send('Archivo no encontrado');
  }
  const ext = path.extname(safe).toLowerCase();
  const isImage = IMAGE_EXTS.has(ext);
  const baseUrl = config.appBaseUrl.replace(/\/$/, '');
  const fileUrl = `${baseUrl}/uploads/${encodeURIComponent(safe)}`;
  const selfUrl = `${baseUrl}/preview/${encodeURIComponent(safe)}`;
  // Nombre original sin el ID UUID que prepende saveAttachmentFromDataUrl
  const displayName = safe.replace(/^[a-f0-9]{12,}-/, '');
  const titulo = isImage ? '📷 Imagen' : '📎 Archivo';
  const desc   = `${displayName} — Reelance Hub`;

  const ogImage = isImage ? `
    <meta property="og:image" content="${fileUrl}" />
    <meta property="og:image:secure_url" content="${fileUrl}" />
    <meta property="og:image:type" content="image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="1200" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${fileUrl}" />` : `
    <meta name="twitter:card" content="summary" />`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${titulo}</title>
<meta property="og:type" content="${isImage ? 'image' : 'website'}" />
<meta property="og:title" content="${titulo}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${selfUrl}" />
<meta property="og:site_name" content="Reelance Hub" />${ogImage}
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{max-width:560px;width:100%;background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.08);overflow:hidden}
  .card-body{padding:24px}
  .file{display:block;width:100%;border-radius:10px}
  h1{font-size:18px;margin:0 0 6px;font-weight:600}
  p{margin:0;color:#666;font-size:14px}
  .btn{display:inline-block;margin-top:16px;padding:12px 24px;background:#007aff;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px}
</style>
</head>
<body>
  <div class="card">
    ${isImage ? `<img class="file" src="${fileUrl}" alt="${displayName}" />` : ''}
    <div class="card-body">
      <h1>${titulo}</h1>
      <p>${displayName}</p>
      ${!isImage ? `<a class="btn" href="${fileUrl}" download>Descargar</a>` : ''}
    </div>
  </div>
</body>
</html>`;

  res.set('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(html);
});

function sanitizeFilename(name) {
  return String(name || 'archivo')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-80) || 'archivo';
}

function saveAttachmentFromDataUrl(attachment) {
  if (!attachment?.dataUrl) {
    return null;
  }

  const match = String(attachment.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  const buffer = Buffer.from(match[2], 'base64');
  const safeName = sanitizeFilename(attachment.name);
  const id = crypto.randomBytes(6).toString('hex');
  const filename = `${id}-${safeName}`;
  fs.writeFileSync(path.join(uploadsDir, filename), buffer);

  return {
    filename,
    url: `${config.appBaseUrl.replace(/\/$/, '')}/uploads/${filename}`,
    name: attachment.name || safeName,
    type: attachment.type || match[1] || 'application/octet-stream'
  };
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeEntityType(value) {
  if (value === 1 || value === '1' || value === 'contact') {
    return 'contact';
  }

  return 'lead';
}

function appendUniqueId(values, value) {
  const normalized = String(value || '').trim();
  const unique = new Set(Array.isArray(values) ? values.map((item) => String(item)) : []);

  if (normalized) {
    unique.add(normalized);
  }

  return Array.from(unique);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || null;
}

function isPhoneField(field) {
  const code = String(field?.field_code || field?.code || '').trim().toUpperCase();
  const name = String(field?.field_name || field?.name || '').trim().toLowerCase();
  const type = String(field?.type || '').trim().toLowerCase();

  if (code === 'PHONE') {
    return true;
  }

  if (type === 'multitext' && name.includes('phone')) {
    return true;
  }

  return ['phone', 'telefono', 'teléfono', 'mobile', 'movil', 'móvil', 'whatsapp']
    .some((token) => name.includes(token));
}

function extractContactPhones(contact, fieldIndex = new Map()) {
  const directPhones = [
    contact?.phone,
    contact?.phone_number,
    contact?.mobile,
    contact?.mobile_phone
  ]
    .map(normalizePhone)
    .filter(Boolean);
  const fields = [
    ...(Array.isArray(contact?.custom_fields_values) ? contact.custom_fields_values : []),
    ...(Array.isArray(contact?.custom_fields) ? contact.custom_fields : [])
  ];
  const phones = [...directPhones];

  for (const field of fields) {
    const fieldId = String(field?.field_id || field?.id || '').trim();
    const resolvedField = (fieldId && fieldIndex.get(fieldId)) || field;

    if (!isPhoneField(resolvedField)) {
      continue;
    }

    for (const item of Array.isArray(field.values) ? field.values : []) {
      const rawValue = item && typeof item === 'object'
        ? (item.value ?? item.enum_value ?? item.text ?? item.phone)
        : item;
      const value = normalizePhone(rawValue);

      if (value) {
        phones.push(value);
      }
    }
  }

  return Array.from(new Set(phones));
}

const contactEnrichmentInFlight = new Set();
const chatSyncDebounce = new Map();

function detectKommoMessageDirection(msg) {
  if (msg.type === 'outgoing') return 'outgoing';
  if (msg.type === 'incoming') return 'incoming';
  const authorType = String(msg.author?.type || '').toLowerCase();
  if (['user', 'bot', 'employee', 'operator'].includes(authorType)) return 'outgoing';
  return 'incoming';
}

async function syncChatMessages(chatId, canonicalChatId) {
  const now = Date.now();
  const lastFetch = chatSyncDebounce.get(chatId) || 0;
  if (now - lastFetch < 10000) return;
  chatSyncDebounce.set(chatId, now);

  try {
    const payload = await kommo.fetchChatMessages(chatId);
    const messages = payload?._embedded?.messages || [];

    for (const msg of messages) {
      if (!msg.id) continue;
      const text = msg.body?.text || msg.content?.text || msg.text || null;
      if (!text) continue;

      store.addMessageToChat(canonicalChatId || chatId, {
        id: msg.id,
        text,
        timestamp: Number(msg.created_at || 0) * 1000 || Date.now(),
        direction: detectKommoMessageDirection(msg),
        deliveryStatus: 'ok'
      });
    }
  } catch (err) {
    // Ignorar errores de sincronización silenciosamente
  }
}
const contactPhoneFieldCache = {
  expiresAt: 0,
  byId: new Map()
};

function buildContactPhoneFieldIndex(payload) {
  const items =
    payload?._embedded?.custom_fields ||
    payload?._embedded?.fields ||
    payload?._embedded?.contacts_custom_fields ||
    [];
  const index = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    if (item?.id && isPhoneField(item)) {
      index.set(String(item.id), item);
    }
  }

  return index;
}

async function getContactPhoneFieldIndex() {
  const now = Date.now();

  if (contactPhoneFieldCache.byId.size && contactPhoneFieldCache.expiresAt > now) {
    return contactPhoneFieldCache.byId;
  }

  try {
    const payload = await kommo.listContactFields();
    const byId = buildContactPhoneFieldIndex(payload);

    if (byId.size) {
      contactPhoneFieldCache.byId = byId;
      contactPhoneFieldCache.expiresAt = now + (5 * 60 * 1000);
      return byId;
    }
  } catch (error) {
    // Ignore metadata lookup failures and fall back to direct field parsing.
  }

  return contactPhoneFieldCache.byId;
}

function buildPendingReplyKeys(chat) {
  const entityType = normalizeEntityType(chat.entityType);
  const entityIds = appendUniqueId(chat.entityIds, chat.entityId);
  const contactIds = appendUniqueId(chat.contactIds, chat.contactId);
  const keys = [];

  for (const entityId of entityIds) {
    const key = store.buildPendingReplyKey(entityType, entityId);

    if (key) {
      keys.push(key);
    }
  }

  for (const contactId of contactIds) {
    const key = store.buildPendingReplyKey('contact', contactId);

    if (key) {
      keys.push(key);
    }
  }

  return Array.from(new Set(keys));
}

function pushLaunchCandidate(candidates, entityType, entityId) {
  const normalizedType = normalizeEntityType(entityType);
  const normalizedId = String(entityId || '').trim();

  if (!normalizedId) {
    return;
  }

  const duplicate = candidates.some((item) => (
    item.entityType === normalizedType &&
    item.entityId === normalizedId
  ));

  if (!duplicate) {
    candidates.push({
      entityType: normalizedType,
      entityId: normalizedId
    });
  }
}

function buildLaunchCandidates(chat) {
  const candidates = [];

  pushLaunchCandidate(candidates, chat.entityType, chat.entityId);

  for (const entityId of Array.isArray(chat.entityIds) ? chat.entityIds : []) {
    pushLaunchCandidate(candidates, chat.entityType, entityId);
  }

  pushLaunchCandidate(candidates, 'contact', chat.contactId);

  for (const contactId of Array.isArray(chat.contactIds) ? chat.contactIds : []) {
    pushLaunchCandidate(candidates, 'contact', contactId);
  }

  return candidates;
}

function summarizeLaunchError(error) {
  const status = error.response?.status || null;
  const data = error.response?.data;

  if (typeof data === 'string' && data.trim()) {
    return {
      status,
      message: data.trim(),
      data
    };
  }

  if (data && typeof data === 'object') {
    const title = data.title || data.detail || data.error || null;

    return {
      status,
      message: title || error.message || 'Error desconocido al contactar Kommo.',
      data
    };
  }

  return {
    status,
    message: error.message || 'Error desconocido al contactar Kommo.',
    data: null
  };
}

function detectMessageDirection(rawMessage, chatWebhookMessage) {
  if (rawMessage?.type === 'outgoing') {
    return 'outgoing';
  }

  if (rawMessage?.type === 'incoming') {
    return 'incoming';
  }

  if (chatWebhookMessage?.message?.type === 'outgoing') {
    return 'outgoing';
  }

  if (chatWebhookMessage?.message?.type === 'incoming') {
    return 'incoming';
  }

  const senderType = String(chatWebhookMessage?.sender?.type || '').toLowerCase();

  if (['employee', 'bot', 'internal', 'amojo', 'operator'].includes(senderType)) {
    return 'outgoing';
  }

  return 'incoming';
}

async function enrichChatTitle(chatId, contactId) {
  if (!contactId) {
    return;
  }

  const normalizedContactId = String(contactId);

  if (contactEnrichmentInFlight.has(normalizedContactId)) {
    return;
  }

  contactEnrichmentInFlight.add(normalizedContactId);

  try {
    const [contact, phoneFieldIndex] = await Promise.all([
      kommo.fetchContact(normalizedContactId),
      getContactPhoneFieldIndex()
    ]);

    if (!contact) {
      return;
    }

    const phoneNumbers = extractContactPhones(contact, phoneFieldIndex);
    const canonicalChatId = store.consolidateChats({
      chatId,
      contactId: normalizedContactId,
      phoneNumbers
    }) || chatId;

    store.upsertChat(canonicalChatId, (chat) => {
      chat.title = contact.name || chat.title;
      chat.phoneNumbers = Array.from(new Set([...(chat.phoneNumbers || []), ...phoneNumbers]));
      chat.subtitle = 'Contacto sincronizado';
      return chat;
    });
  } finally {
    contactEnrichmentInFlight.delete(normalizedContactId);
  }
}

async function backfillMissingPhones(chats, limit = 8) {
  const pending = chats
    .filter((chat) => chat.contactId && !(chat.phoneNumbers || []).length)
    .slice(0, limit);

  if (!pending.length) {
    return;
  }

  await Promise.allSettled(
    pending.map((chat) => enrichChatTitle(chat.chatId, chat.contactId))
  );
}

// Cache de pipelines/statuses (Kommo)
const PIPELINES_TTL_MS = 60 * 60 * 1000; // 1 hora
let pipelinesCache = { data: {}, fetchedAt: 0 };

async function getPipelinesMap() {
  const now = Date.now();
  if (pipelinesCache.fetchedAt + PIPELINES_TTL_MS > now && Object.keys(pipelinesCache.data).length) {
    return pipelinesCache.data;
  }
  try {
    const data = await kommo.fetchPipelinesMap();
    pipelinesCache = { data, fetchedAt: now };
    return data;
  } catch (_e) {
    return pipelinesCache.data || {};
  }
}

async function backfillLeadTags(chats, limit = 6) {
  const TAG_TTL = 5 * 60 * 1000;
  const now = Date.now();
  const pending = chats
    .filter((chat) => {
      if (!chat.entityId) return false;
      if (normalizeEntityType(chat.entityType) !== 'lead') return false;
      if ((chat.leadInfoFetchedAt || chat.tagsFetchedAt || 0) + TAG_TTL > now) return false;
      return true;
    })
    .slice(0, limit);

  if (!pending.length) {
    return;
  }

  await Promise.allSettled(
    pending.map(async (chat) => {
      try {
        const detail = await kommo.fetchLeadDetail(chat.entityId);
        store.setChatLeadInfo(chat.chatId, detail);
      } catch (_e) { /* ignore */ }
    })
  );
}

// Anota pipelineName/statusName en cada chat usando el cache de pipelines
function decorateChatsWithPipelineNames(chats, pipelinesMap) {
  if (!pipelinesMap || !Object.keys(pipelinesMap).length) return chats;
  return chats.map((chat) => {
    const pid = chat.pipelineId;
    const sid = chat.statusId;
    if (!pid) return chat;
    const pipeline = pipelinesMap[pid];
    if (!pipeline) return chat;
    return {
      ...chat,
      pipelineName: pipeline.name || null,
      statusName: (sid && pipeline.statuses[sid]) || null
    };
  });
}

function registerWebhookMessage(payload) {
  const rawMessage = payload?.message?.add?.[0];
  const rawTalk = payload?.talk?.add?.[0] || payload?.talk?.update?.[0];
  const chatWebhookMessage = payload?.message && !payload?.message?.add ? payload.message : null;

  if (!rawMessage && !rawTalk && !chatWebhookMessage) {
    return;
  }

  const chatId = rawMessage?.chat_id || rawTalk?.chat_id || chatWebhookMessage?.conversation?.id;

  if (!chatId) {
    return;
  }

  const normalizedText =
    rawMessage?.text ||
    chatWebhookMessage?.message?.text ||
    chatWebhookMessage?.message?.media ||
    '[Mensaje sin texto]';

  const normalizedTimestamp =
    (chatWebhookMessage?.msec_timestamp && Number(chatWebhookMessage.msec_timestamp)) ||
    (chatWebhookMessage?.timestamp && Number(chatWebhookMessage.timestamp) * 1000) ||
    Number(rawMessage?.created_at || Math.floor(Date.now() / 1000)) * 1000;

  const normalizedAuthorName =
    chatWebhookMessage?.sender?.name ||
    chatWebhookMessage?.receiver?.name ||
    rawMessage?.author?.name ||
    null;

  const normalizedOrigin =
    rawMessage?.origin ||
    rawTalk?.origin ||
    chatWebhookMessage?.source?.external_id ||
    chatWebhookMessage?.conversation?.client_id ||
    chatWebhookMessage?.message?.type ||
    null;
  const normalizedContactId =
    rawMessage?.contact_id ||
    rawTalk?.contact_id ||
    chatWebhookMessage?.contact?.id ||
    null;
  const normalizedEntityId =
    rawMessage?.entity_id ||
    rawMessage?.element_id ||
    rawTalk?.entity_id ||
    rawTalk?.element_id ||
    chatWebhookMessage?.conversation?.entity_id ||
    null;
  const normalizedEntityTypeValue =
    rawMessage?.entity_type ||
    rawTalk?.entity_type ||
    chatWebhookMessage?.conversation?.entity_type ||
    null;
  const canonicalChatId = store.consolidateChats({
    chatId,
    talkId: rawMessage?.talk_id || rawTalk?.talk_id || null,
    contactId: normalizedContactId,
    entityId: normalizedEntityId
  }) || chatId;

  store.upsertChat(canonicalChatId, (chat) => {
    chat.chatId = canonicalChatId;
    chat.chatIds = appendUniqueId(chat.chatIds, chatId);
    chat.contactId = normalizedContactId || chat.contactId;
    chat.contactIds = appendUniqueId(chat.contactIds, normalizedContactId || chat.contactId);
    chat.talkId = rawMessage?.talk_id || rawTalk?.talk_id || chat.talkId;
    chat.talkIds = appendUniqueId(chat.talkIds, rawMessage?.talk_id || rawTalk?.talk_id || chat.talkId);
    chat.entityId = normalizedEntityId || chat.entityId;
    chat.entityIds = appendUniqueId(chat.entityIds, normalizedEntityId || chat.entityId);
    chat.entityType = normalizedEntityTypeValue || chat.entityType;
    chat.origin = normalizedOrigin || chat.origin;
    chat.title = normalizedAuthorName || chat.title;
    chat.subtitle = chat.contactId ? `Contacto #${chat.contactId}` : chat.subtitle;
    return chat;
  });

  if (rawMessage || chatWebhookMessage) {
    const direction = detectMessageDirection(rawMessage, chatWebhookMessage);
    const wasAdded = store.addMessageToChat(canonicalChatId, {
      id: rawMessage?.id || chatWebhookMessage?.message?.id || `${chatId}-${normalizedTimestamp}`,
      text: normalizedText,
      timestamp: normalizedTimestamp,
      direction,
      deliveryStatus: 'recibido'
    });

    // Disparar push solo si el mensaje fue realmente nuevo (no duplicado)
    // y solo para incoming. El tag 'chat-${id}' colapsa pushes consecutivos
    // del mismo chat para evitar acumulación en pantalla.
    if (wasAdded && direction === 'incoming') {
      const senderName = normalizedAuthorName || 'Cliente';
      push.sendToAll({
        title: senderName,
        body: normalizedText.slice(0, 140),
        tag: `chat-${canonicalChatId}`,
        chatId: canonicalChatId,
        url: '/'
      }).catch((err) => {
        console.error('Push send error:', err.message);
      });
    }
  }

  if (normalizedContactId) {
    enrichChatTitle(canonicalChatId, normalizedContactId).catch(() => {});
  }

  // syncChatMessages está desactivado: el endpoint /api/v4/chats/{id}/messages
  // no existe en Kommo (solo está disponible vía amojo custom channels).
  // Confiamos en los webhooks add_message + nuestro log-outgoing para tener
  // la historia completa.
}

app.get('/auth/kommo/url', asyncHandler(async (_req, res) => {
  res.json({ url: kommo.buildAuthUrl() });
}));

app.get('/auth/kommo/callback', asyncHandler(async (req, res) => {
  const { code, state, referer, error } = req.query;
  const saved = store.readState().oauth.state;

  if (error) {
    throw new Error(`Kommo devolvió un error de autorización: ${error}`);
  }

  if (!code) {
    throw new Error('Kommo no devolvió el code de OAuth.');
  }

  if (!state || state !== saved) {
    throw new Error('El estado de OAuth no coincide. Intenta conectar de nuevo.');
  }

  await kommo.exchangeCodeForTokens({ code, referer });
  await kommo.fetchAccountInfo();
  res.redirect('/');
}));

// ─────────────────────────────────────────────────────────────
// /healthz — endpoint público para monitoreo externo (UptimeRobot, etc.)
// Devuelve 200 si el server responde; 503 si Kommo está desconectado.
// Sin auth para que servicios externos puedan pingearlo.
// ─────────────────────────────────────────────────────────────
const healthzStats = { hits: 0, last: null, byUserAgent: {} };

app.get('/healthz', (req, res) => {
  try {
    const ua = String(req.headers['user-agent'] || '').slice(0, 80);
    healthzStats.hits += 1;
    healthzStats.last = Date.now();
    healthzStats.byUserAgent[ua] = (healthzStats.byUserAgent[ua] || 0) + 1;

    const state = store.readState();
    const kommoOk = Boolean(state.kommo?.tokens?.access_token);
    if (!kommoOk) {
      return res.status(503).json({ ok: false, reason: 'kommo_disconnected' });
    }
    res.status(200).json({ ok: true, version: config.appVersion, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, reason: 'state_read_error', message: err.message });
  }
});

// Endpoint de inspección (auth) — para verificar quién pinguea /healthz
app.get('/api/debug/healthz-stats', (_req, res) => {
  res.json({
    ...healthzStats,
    lastHumanReadable: healthzStats.last ? new Date(healthzStats.last).toLocaleString('es-MX') : null
  });
});

app.get('/api/status', (_req, res) => {
  const state = store.readState();

  res.json({
    connected: Boolean(state.kommo.tokens?.access_token),
    version: config.appVersion,
    subdomain: state.kommo.subdomain || config.kommo.subdomain || null,
    account: state.kommo.account,
    lastError: state.kommo.lastError || null,
    salesbotReady: Boolean(config.kommo.salesbotId),
    configuredSalesbotId: config.kommo.salesbotId,
    detectedSalesbotId: state.kommo.detectedSalesbotId || null,
    configuredSourceId: config.kommo.sourceId || null
  });
});

app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: config.push.publicKey || null });
});

app.post('/api/push/subscribe', asyncHandler(async (req, res) => {
  const sub = req.body?.subscription || req.body;
  if (!sub?.endpoint) {
    return res.status(400).json({ error: 'La suscripción debe incluir endpoint y keys.' });
  }
  push.addSubscription({
    endpoint: sub.endpoint,
    keys: sub.keys,
    userAgent: req.headers['user-agent'] || null
  });
  res.json({ ok: true });
}));

app.post('/api/push/unsubscribe', asyncHandler(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    return res.status(400).json({ error: 'Falta el endpoint.' });
  }
  push.removeSubscription(endpoint);
  res.json({ ok: true });
}));

app.post('/api/push/test', asyncHandler(async (_req, res) => {
  const result = await push.sendToAll({
    title: 'Reelance Hub',
    body: 'Test de notificación push.',
    url: '/'
  });
  res.json(result);
}));

app.get('/api/chats', asyncHandler(async (_req, res) => {
  const chats = store.getChatList();
  const [pipelinesMap] = await Promise.all([
    getPipelinesMap(),
    backfillMissingPhones(chats),
    backfillLeadTags(chats)
  ]);

  const fresh = store.getChatList();
  res.json({
    chats: decorateChatsWithPipelineNames(fresh, pipelinesMap)
  });
}));

app.post('/api/chats/:chatId/read', (req, res) => {
  store.markChatRead(req.params.chatId);
  res.status(204).send();
});

app.post('/api/chats/:chatId/unread', (req, res) => {
  store.markChatUnread(req.params.chatId);
  res.status(204).send();
});

app.post('/api/chats/:chatId/pin', (req, res) => {
  store.setChatPinned(req.params.chatId, true);
  res.status(204).send();
});

app.delete('/api/chats/:chatId/pin', (req, res) => {
  store.setChatPinned(req.params.chatId, false);
  res.status(204).send();
});

app.delete('/api/chats/:chatId', (req, res) => {
  store.deleteChat(req.params.chatId);
  res.status(204).send();
});

const activeSends = new Set();

app.post('/api/chats/:chatId/messages', asyncHandler(async (req, res) => {
  const { chatId } = req.params;

  if (activeSends.has(chatId)) {
    return res.status(429).json({ error: 'Ya hay un mensaje en proceso de envío para esta conversación. Espera un momento.' });
  }

  activeSends.add(chatId);

  try {
    return await handleSendMessage(req, res, chatId);
  } finally {
    activeSends.delete(chatId);
  }
}));

async function handleSendMessage(req, res, chatId) {
  const rawText = String(req.body?.text || '').trim();
  const attachmentInput = req.body?.attachment && typeof req.body.attachment === 'object'
    ? req.body.attachment
    : null;
  const state = store.readState();
  const chat = state.chats[chatId];

  if (!chat) {
    return res.status(404).json({ error: 'No encontré esa conversación.' });
  }

  if (!rawText && !attachmentInput) {
    return res.status(400).json({ error: 'Escribe un mensaje o adjunta un archivo antes de enviarlo.' });
  }

  if (!chat.entityId) {
    return res.status(400).json({ error: 'Esta conversación todavía no tiene entidad de Kommo asociada.' });
  }

  let savedAttachment = null;
  if (attachmentInput) {
    try {
      savedAttachment = saveAttachmentFromDataUrl(attachmentInput);
    } catch (error) {
      return res.status(400).json({ error: `No pude guardar el adjunto: ${error.message}` });
    }

    if (!savedAttachment) {
      return res.status(400).json({ error: 'El adjunto vino sin contenido válido.' });
    }

    // ── Pre-upload a Kommo DESACTIVADO temporalmente ──
    // El endpoint /api/v4/chat/uploads no existe (404) y el Drive API requiere
    // cookies de sesión (no acepta OAuth Bearer). Pendiente de respuesta de soporte.
    // Mientras: usamos /preview/:filename con OG tags para que WhatsApp muestre
    // miniatura del archivo automáticamente.
    /*
    try {
      const localPath = path.join(uploadsDir, savedAttachment.filename);
      const fileBuffer = fs.readFileSync(localPath);
      const kommoFile = await kommo.uploadChatFile(fileBuffer, savedAttachment.name, savedAttachment.type, chat.chatId || null);
      if (kommoFile?.uuid) savedAttachment.kommoUuid = kommoFile.uuid;
    } catch (uploadErr) {
      console.error('Kommo upload error:', uploadErr.message);
    }
    */
  }

  // URL de preview HTML — WhatsApp fetchea la página y descubre og:image.
  // Si llega como link en un mensaje de texto, muestra miniatura inline.
  const previewUrl = savedAttachment
    ? `${config.appBaseUrl.replace(/\/$/, '')}/preview/${encodeURIComponent(savedAttachment.filename)}`
    : null;

  // displayText: lo que aparece en la app local (URL cruda directa al archivo)
  const displayText = savedAttachment
    ? (rawText ? `${rawText}\n${savedAttachment.url}` : savedAttachment.url)
    : rawText;

  // replyText: lo que se manda al cliente vía WhatsApp.
  // Para adjuntos: caption + preview URL en línea separada (WhatsApp expande la URL).
  // Para texto puro: solo el texto.
  const replyText = savedAttachment
    ? (rawText ? `${rawText}\n${previewUrl}` : previewUrl)
    : (rawText || '');

  // Siempre 'text' por ahora — el bot manda show type:"text" con la URL del preview
  // y WhatsApp se encarga del resto vía OG tags.
  const replyType = 'text';

  store.pushSalesbotDebug({
    type: 'send_message_prepared',
    chatId,
    rawTextLength: rawText.length,
    rawTextPreview: rawText.slice(0, 60),
    hasAttachment: Boolean(savedAttachment),
    attachmentName: savedAttachment?.name || null,
    previewUrl: previewUrl || null,
    replyType,
    finalTextPreview: replyText.slice(0, 120),
    finalTextLength: replyText.length
  });

  const localMessageId = `local-${Date.now()}`;

  store.addMessageToChat(chatId, {
    id: localMessageId,
    text: displayText,
    timestamp: Date.now(),
    direction: 'outgoing',
    deliveryStatus: config.kommo.salesbotId ? 'en cola' : 'pendiente de bot',
    status: 'pending',
    attachment: savedAttachment
      ? { name: savedAttachment.name, type: savedAttachment.type, url: savedAttachment.url }
      : null
  });

  store.queuePendingReply(buildPendingReplyKeys(chat), {
    text: replyText,
    attachmentUrl: savedAttachment?.url || null,
    attachmentUuid: savedAttachment?.kommoUuid || null, // UUID de Kommo para media real
    attachmentType: replyType,
    chatId,
    contactId: chat.contactId || null,
    entityId: chat.entityId,
    entityType: normalizeEntityType(chat.entityType),
    queuedAt: Date.now(),
    localMessageId
  });

  if (config.kommo.salesbotId) {
    const launchCandidates = buildLaunchCandidates(chat);
    const launchErrors = [];
    let deliveredCandidate = null;

    for (const candidate of launchCandidates) {
      store.pushSalesbotDebug({
        type: 'launch_attempt',
        chatId,
        entityId: candidate.entityId,
        entityType: candidate.entityType,
        salesbotId: config.kommo.salesbotId
      });

      try {
        await kommo.launchSalesbot(candidate.entityId, candidate.entityType);
        deliveredCandidate = candidate;
        store.pushSalesbotDebug({
          type: 'launch_success',
          chatId,
          entityId: candidate.entityId,
          entityType: candidate.entityType,
          salesbotId: config.kommo.salesbotId
        });
        break;
      } catch (error) {
        const summary = summarizeLaunchError(error);

        launchErrors.push({
          ...candidate,
          ...summary
        });
        store.pushSalesbotDebug({
          type: 'launch_error',
          chatId,
          entityId: candidate.entityId,
          entityType: candidate.entityType,
          salesbotId: config.kommo.salesbotId,
          error: summary
        });
      }
    }

    if (!deliveredCandidate) {
      const primaryError = launchErrors[0] || null;

      store.pushSalesbotDebug({
        type: 'launch_failed_all_candidates',
        chatId,
        salesbotId: config.kommo.salesbotId,
        attempts: launchErrors
      });
      return res.status(502).json({
        error: 'Guardé tu mensaje en la app, pero Kommo no pudo arrancar el Salesbot para enviarlo.',
        detail: primaryError?.message || 'Kommo rechazó todos los intentos de envío.',
        attempts: launchErrors
      });
    }

    store.upsertChat(chatId, (currentChat) => {
      currentChat.entityId = deliveredCandidate.entityType === 'lead'
        ? deliveredCandidate.entityId
        : currentChat.entityId;
      currentChat.entityType = deliveredCandidate.entityType === 'lead'
        ? deliveredCandidate.entityType
        : currentChat.entityType;
      currentChat.contactId = deliveredCandidate.entityType === 'contact'
        ? deliveredCandidate.entityId
        : currentChat.contactId;
      currentChat.entityIds = appendUniqueId(currentChat.entityIds, currentChat.entityId);
      currentChat.contactIds = appendUniqueId(currentChat.contactIds, currentChat.contactId);
      return currentChat;
    });
  }

  res.status(202).json({
    ok: true,
    mode: config.kommo.salesbotId ? 'salesbot' : 'queued'
  });
}

// Endpoint público para que los salesbots de Kommo registren mensajes salientes
// que ellos mandaron por WhatsApp (vía send_message nativo). Así esos mensajes
// también aparecen en Reelance Hub.
app.post('/webhooks/kommo/log-outgoing', (req, res) => {
  const returnUrl = req.body?.return_url || null;

  res.status(200).json({ ok: true }); // responder rápido, procesar async

  // CRÍTICO: widget_request pausa el bot hasta que se llame return_url.
  // Sin esta llamada el bot queda atascado en este bloque para siempre,
  // bloqueando el timer y todos los pasos siguientes.
  if (returnUrl) {
    kommo.callReturnUrl(returnUrl, {})
      .then(() => store.pushSalesbotDebug({ type: 'log_outgoing_return_url_ok' }))
      .catch((err) => {
        store.pushSalesbotDebug({ type: 'log_outgoing_return_url_error', message: err.message });
        console.error('Error log-outgoing return_url:', err.message);
      });
  } else {
    store.pushSalesbotDebug({ type: 'log_outgoing_no_return_url' });
  }

  setImmediate(() => {
    try {
      // Kommo envía los placeholders resueltos dentro de body.data, NO en body directamente.
      // Por compatibilidad probamos ambos: primero data.*, luego top-level.
      const data = req.body?.data || {};
      const text = String(data.text || data.message || req.body?.text || req.body?.message || '').trim();
      const leadId = (data.lead_id || req.body?.lead_id) ? String(data.lead_id || req.body.lead_id).trim() : null;
      const contactId = (data.contact_id || req.body?.contact_id) ? String(data.contact_id || req.body.contact_id).trim() : null;

      store.pushSalesbotDebug({
        type: 'log_outgoing_received',
        leadId,
        contactId,
        textLength: text.length,
        hasReturnUrl: Boolean(returnUrl),
        rawBodyKeys: Object.keys(req.body || {}),
        rawDataKeys: Object.keys(data)
      });

      if (!text) {
        store.pushSalesbotDebug({ type: 'log_outgoing_skipped', reason: 'no_text' });
        return;
      }

      if (!leadId && !contactId) {
        store.pushSalesbotDebug({ type: 'log_outgoing_skipped', reason: 'no_entity' });
        return;
      }

      const canonicalChatId = store.consolidateChats({
        entityId: leadId,
        contactId
      });

      if (!canonicalChatId) {
        store.pushSalesbotDebug({
          type: 'log_outgoing_no_chat',
          leadId,
          contactId
        });
        return;
      }

      const messageId = `salesbot-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const wasAdded = store.addMessageToChat(canonicalChatId, {
        id: messageId,
        text,
        timestamp: Date.now(),
        direction: 'outgoing',
        deliveryStatus: 'enviado por salesbot',
        status: 'sent'
      });

      store.pushSalesbotDebug({
        type: 'log_outgoing_done',
        chatId: canonicalChatId,
        wasAdded
      });
    } catch (error) {
      console.error('Error en log-outgoing:', error.message);
      store.pushSalesbotDebug({
        type: 'log_outgoing_error',
        message: error.message
      });
    }
  });
});

app.post('/webhooks/kommo', (req, res) => {
  res.status(200).send('ok');

  setImmediate(() => {
    try {
      store.pushWebhookDebug(req.body);
      registerWebhookMessage(req.body);
    } catch (error) {
      store.pushWebhookDebug({
        type: 'processing_error',
        message: error.message,
        body: req.body
      });
      console.error('Error procesando webhook de Kommo:', error.message);
    }
  });
});

app.get('/api/debug/webhooks', (_req, res) => {
  const state = store.readState();
  res.json({
    items: state.webhookDebug || []
  });
});

app.get('/api/debug/chat-messages/:chatId', asyncHandler(async (req, res) => {
  const { chatId } = req.params;
  const endpoints = [
    `/api/v4/chats/${chatId}/messages`,
    `/api/v4/chats/messages?chat_id=${chatId}`,
    `/api/v4/talks?chat_id=${chatId}&with=messages`,
    `/api/v4/chats?id=${chatId}&with=messages`
  ];
  const results = {};

  for (const path of endpoints) {
    try {
      results[path] = { ok: true, data: await kommo.apiRequest('get', path) };
    } catch (err) {
      results[path] = { ok: false, status: err.response?.status, error: err.message };
    }
  }

  res.json(results);
}));

app.get('/api/kommo/sources', asyncHandler(async (_req, res) => {
  const payload = await kommo.listSources();
  const items = payload?._embedded?.sources || [];

  res.json({
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      origin_code: item.origin_code,
      default: item.default,
      external_id: item.external_id
    }))
  });
}));

app.post('/api/kommo/salesbot/handoff', asyncHandler(async (req, res) => {
  const { token, return_url: returnUrl } = req.body || {};
  const requestedSourceId = req.body?.data?.source_id || null;

  store.pushSalesbotDebug({
    type: 'handoff_request',
    hasToken: Boolean(token),
    hasReturnUrl: Boolean(returnUrl),
    requestedSourceId,
    body: req.body
  });

  if (!token || !returnUrl) {
    return res.status(400).json({ error: 'Faltan token o return_url.' });
  }

  if (config.kommo.clientSecret && !kommo.verifyJwt(token, config.kommo.clientSecret)) {
    store.pushSalesbotDebug({
      type: 'handoff_jwt_bypass',
      note: 'JWT no validado, continuando en modo desarrollo local'
    });
  }

  const payload = kommo.parseJwtPayload(token);
  const entityType = normalizeEntityType(payload.entity_type);
  const pendingReply = store.consumePendingReply(entityType, payload.entity_id);
  const targetUrl = new URL(returnUrl);
  const pathMatch = targetUrl.pathname.match(/\/api\/v4\/[^/]+\/(\d+)\/continue\/\d+/);

  if (pathMatch?.[1]) {
    store.setDetectedSalesbotId(pathMatch[1]);
  }

  store.pushSalesbotDebug({
    type: 'handoff_continue',
    detectedSalesbotId: pathMatch?.[1] ? Number(pathMatch[1]) : null,
    requestedSourceId,
    entityId: payload.entity_id,
    entityType
  });
  const responsePayload = {
    data: {
      // reply_text nunca vacío (Kommo envía literal "{{json.reply_text}}" si está vacío)
      reply_text: pendingReply
        ? (pendingReply.text || pendingReply.attachmentUrl || '—')
        : '',
      // reply_url: UUID de Kommo si se pre-subió (media real), si no la URL pública
      reply_url:  pendingReply
        ? (pendingReply.attachmentUuid || pendingReply.attachmentUrl || '')
        : '',
      reply_type: pendingReply ? (pendingReply.attachmentType || 'text') : '',
      has_reply:  pendingReply ? '1' : '0'
    }
  };

  store.pushSalesbotDebug({
    type: 'handoff_response_prepared',
    delivered: Boolean(pendingReply),
    detectedSalesbotId: pathMatch?.[1] ? Number(pathMatch[1]) : null,
    responsePayload
  });

  if (pendingReply) {
    store.upsertChat(pendingReply.chatId, (chat) => {
      chat.messages = chat.messages.map((item) => {
        if (item.id === pendingReply.localMessageId) {
          return { ...item, deliveryStatus: 'entregado al bot', status: 'sent' };
        }

        return item;
      });

      return chat;
    });
  }

  // Responder 200 inmediatamente (el salesbot queda pausado esperando callReturnUrl)
  res.status(200).json({ ok: true });

  // Llamar return_url para que Kommo avance al paso send_message
  kommo.callReturnUrl(returnUrl, { data: responsePayload.data })
    .then(() => {
      store.pushSalesbotDebug({
        type: 'handoff_complete',
        delivered: Boolean(pendingReply),
        chatId: pendingReply?.chatId || null
      });
    })
    .catch((err) => {
      store.pushSalesbotDebug({
        type: 'handoff_return_url_error',
        message: err.message,
        status: err.response?.status || null,
        responseData: err.response?.data || null,
        returnUrl,
        chatId: pendingReply?.chatId || null
      });
      console.error('Error return_url:', err.message, err.response?.data);
    });
}));

app.get('/api/kommo/salesbot-id', (_req, res) => {
  const state = store.readState();
  res.json({
    configuredSalesbotId: config.kommo.salesbotId || null,
    detectedSalesbotId: state.kommo.detectedSalesbotId || null
  });
});

app.get('/api/debug/salesbot', (_req, res) => {
  const state = store.readState();
  res.json({
    items: state.salesbotDebug || []
  });
});

// Probe 3: confirmar/descartar drive auth + sources/channels disponibles
app.get('/api/debug/probe-final', asyncHandler(async (_req, res) => {
  const FormData = require('form-data');
  const { Buffer } = require('buffer');
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    'base64'
  );

  const baseUrl = kommo.getBaseUrl();
  const token = await kommo.getValidAccessToken();

  // 1. amojo_id correcto (probar con cada parámetro individualmente)
  const amojoTests = [];
  for (const w of ['amojo_id', 'amojo_rights_id', 'users_groups', 'task_types', 'datetime_settings']) {
    try {
      const r = await axios.get(`${baseUrl}/api/v4/account?with=${w}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 4000,
        validateStatus: () => true
      });
      amojoTests.push({
        with: w,
        status: r.status,
        amojoIdInBody: r.data?.amojo_id || null,
        bodyKeys: r.status === 200 ? Object.keys(r.data || {}).slice(0, 15) : null
      });
    } catch (e) {
      amojoTests.push({ with: w, error: e.message });
    }
  }

  // 2. Drive auth: probar 4 métodos en drive-01
  const driveAuthTests = [];
  const driveUrl = 'https://drive-01.kommo.com/api/v4/uploads';
  const authVariants = [
    { name: 'Bearer',         headers: { Authorization: `Bearer ${token}` } },
    { name: 'X-Auth-Token',   headers: { 'X-Auth-Token': token } },
    { name: 'No auth',        headers: {} },
    { name: 'Bearer + amojo', headers: { Authorization: `Bearer ${token}`, 'X-Account-ID': 'ventasreelancemx' } }
  ];
  for (const a of authVariants) {
    try {
      const form = new FormData();
      form.append('file', tinyPng, { filename: 'p.png', contentType: 'image/png' });
      const r = await axios.post(driveUrl, form, {
        headers: { ...form.getHeaders(), ...a.headers },
        timeout: 4000,
        validateStatus: () => true
      });
      driveAuthTests.push({
        auth: a.name,
        status: r.status,
        body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 200),
        responseHeaders: {
          'www-authenticate': r.headers['www-authenticate'] || null,
          'x-error-code': r.headers['x-error-code'] || null
        }
      });
    } catch (err) {
      driveAuthTests.push({ auth: a.name, error: err.message });
    }
  }

  // 3. Sources de chat disponibles (canales WhatsApp activos)
  let sources = null;
  try {
    const r = await axios.get(`${baseUrl}/api/v4/sources`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 4000,
      validateStatus: () => true
    });
    sources = { status: r.status, body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 1000) : String(r.data).slice(0, 500) };
  } catch (e) {
    sources = { error: e.message };
  }

  res.json({ amojoTests, driveAuthTests, sources });
}));

// Probe 2: encontrar drive shard + amojo_id correctos
app.get('/api/debug/probe-drive', asyncHandler(async (_req, res) => {
  const FormData = require('form-data');
  const { Buffer } = require('buffer');

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    'base64'
  );

  const baseUrl = kommo.getBaseUrl();
  const token = await kommo.getValidAccessToken();

  // 1. Obtener amojo_id correctamente con ?with
  let accountWithAmojo = null;
  try {
    accountWithAmojo = await kommo.apiRequest('get', '/api/v4/account?with=amojo_id,amojo_rights_id,version');
  } catch (e) {
    accountWithAmojo = { error: e.message };
  }

  // 2. Probar todos los shards de drive (01-10) con varios paths
  const drivePaths = ['/v1.0/files', '/api/v4/uploads', '/upload', '/v1/files', '/files/upload'];
  const driveResults = [];
  for (let shard = 1; shard <= 10; shard++) {
    const shardStr = String(shard).padStart(2, '0');
    for (const driveP of drivePaths) {
      const url = `https://drive-${shardStr}.kommo.com${driveP}`;
      try {
        const form = new FormData();
        form.append('file', tinyPng, { filename: 'probe.png', contentType: 'image/png' });
        const r = await axios.post(url, form, {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
          timeout: 4000,
          validateStatus: () => true
        });
        // Solo guardamos si NO es 404 (404 = path no existe en este shard)
        if (r.status !== 404) {
          driveResults.push({
            url,
            status: r.status,
            body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 200)
          });
        }
      } catch (err) {
        if (err.response?.status && err.response.status !== 404) {
          driveResults.push({
            url,
            status: err.response.status,
            body: err.response.data ? JSON.stringify(err.response.data).slice(0, 300) : null
          });
        }
        // ENOTFOUND, ECONNREFUSED → shard no existe, ignorar
      }
    }
  }

  // 3. Probar POST a /api/v4/chats/{chatId}/messages (chat real del state)
  const state = store.readState();
  const sampleChat = Object.values(state.chats || {})
    .find((c) => c?.chatId && c.chatId.includes('-'));
  const chatMessageProbes = [];
  if (sampleChat?.chatId) {
    const probes = [
      {
        name: 'POST /api/v4/chats/{id}/messages text',
        url: `${baseUrl}/api/v4/chats/${sampleChat.chatId}/messages`,
        body: { type: 'text', text: 'probe' }
      },
      {
        name: 'POST /api/v4/chats/messages',
        url: `${baseUrl}/api/v4/chats/messages`,
        body: { chat_id: sampleChat.chatId, type: 'text', text: 'probe' }
      }
    ];
    for (const p of probes) {
      try {
        const r = await axios.post(p.url, p.body, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 4000,
          validateStatus: () => true
        });
        chatMessageProbes.push({
          name: p.name,
          url: p.url,
          status: r.status,
          body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 200)
        });
      } catch (err) {
        chatMessageProbes.push({
          name: p.name,
          url: p.url,
          status: err.response?.status || null,
          error: err.message,
          body: err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : null
        });
      }
    }
  }

  res.json({
    accountWithAmojo,
    sampleChatId: sampleChat?.chatId || null,
    driveResultsNon404: driveResults,
    chatMessageProbes
  });
}));

// Diagnóstico: prueba múltiples endpoints de Kommo para encontrar el correcto
// para subida de archivos. Devuelve el status HTTP de cada uno.
app.get('/api/debug/probe-uploads', asyncHandler(async (_req, res) => {
  const FormData = require('form-data');
  const { Buffer } = require('buffer');

  // PNG mínimo (1x1 transparente) para no enviar archivos reales
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
    'base64'
  );

  const baseUrl = kommo.getBaseUrl();
  const token = await kommo.getValidAccessToken();

  const subdomain = baseUrl.replace(/^https?:\/\//, '').replace(/\.kommo\.com.*$/, '');
  const accountInfo = await kommo.fetchAccountInfo().catch((e) => ({ error: e.message }));
  const amojoId = accountInfo?.amojo_id || null;

  const candidates = [
    { name: 'v4 chat/uploads',           url: `${baseUrl}/api/v4/chat/uploads` },
    { name: 'v4 chats/uploads',          url: `${baseUrl}/api/v4/chats/uploads` },
    { name: 'v4 uploads',                url: `${baseUrl}/api/v4/uploads` },
    { name: 'v4 chat/upload',            url: `${baseUrl}/api/v4/chat/upload` },
    { name: 'v4 files',                  url: `${baseUrl}/api/v4/files` },
    { name: 'v4 _DRIVE_/uploads',        url: `${baseUrl}/api/v4/account/_DRIVE_/uploads` },
    { name: 'amojo /v2/origin/uploads',  url: `https://amojo.kommo.com/v2/origin/${amojoId || 'X'}/uploads`, skipAuth: true },
    { name: 'drive shard uploads',       url: `https://drive-04.kommo.com/api/v4/uploads` }
  ];

  const results = [];
  for (const c of candidates) {
    try {
      const form = new FormData();
      form.append('file', tinyPng, { filename: 'probe.png', contentType: 'image/png' });
      const headers = { ...form.getHeaders() };
      if (!c.skipAuth) headers.Authorization = `Bearer ${token}`;
      const r = await axios.post(c.url, form, { headers, timeout: 8000, validateStatus: () => true });
      results.push({
        name: c.name,
        url: c.url,
        status: r.status,
        body: typeof r.data === 'object' ? JSON.stringify(r.data).slice(0, 300) : String(r.data).slice(0, 300)
      });
    } catch (err) {
      results.push({
        name: c.name,
        url: c.url,
        error: err.message,
        status: err.response?.status || null,
        body: err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : null
      });
    }
  }

  res.json({
    subdomain,
    amojoId,
    accountInfoError: accountInfo?.error || null,
    results
  });
}));

app.get('/api/quick-replies', (_req, res) => {
  res.json({
    items: store.getQuickReplies()
  });
});

app.post('/api/quick-replies', (req, res) => {
  const id = String(req.body?.id || `qr-${Date.now()}`);
  const name = String(req.body?.name || '').trim();
  const text = String(req.body?.text || '');
  const attachment = req.body?.attachment && typeof req.body.attachment === 'object'
    ? {
        name: String(req.body.attachment.name || '').trim(),
        type: String(req.body.attachment.type || '').trim(),
        dataUrl: String(req.body.attachment.dataUrl || '')
      }
    : null;

  if (!name) {
    return res.status(400).json({ error: 'La respuesta rápida necesita un nombre.' });
  }

  const normalizedName = name.toLocaleLowerCase('es');
  const conflict = store.getQuickReplies().find(
    (item) => item.id !== id && item.name.toLocaleLowerCase('es') === normalizedName
  );

  if (conflict) {
    return res.status(409).json({ error: `Ya existe una respuesta rápida con el título "${conflict.name}". Elige otro título.` });
  }

  store.upsertQuickReply({
    id,
    name,
    text,
    attachment
  });

  res.status(201).json({
    ok: true,
    item: store.getQuickReplies().find((item) => item.id === id) || null
  });
});

app.delete('/api/quick-replies/:id', (req, res) => {
  store.deleteQuickReply(req.params.id);
  res.status(204).send();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: error.message || 'Ocurrió un error inesperado.'
  });
});

app.listen(config.port, () => {
  console.log(`Reelance Hub activo en ${config.appBaseUrl}`);
});
