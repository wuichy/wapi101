const axios = require('axios');
const express = require('express');
const path = require('path');
const config = require('./lib/config');
const store = require('./lib/store');
const kommo = require('./lib/kommo');

const app = express();

app.use('/wc', require('./reelance-hub-woocommerce-kommo'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
    store.addMessageToChat(canonicalChatId, {
      id: rawMessage?.id || chatWebhookMessage?.message?.id || `${chatId}-${normalizedTimestamp}`,
      text: normalizedText,
      timestamp: normalizedTimestamp,
      direction: detectMessageDirection(rawMessage, chatWebhookMessage),
      deliveryStatus: 'recibido'
    });
  }

  if (normalizedContactId) {
    enrichChatTitle(canonicalChatId, normalizedContactId).catch(() => {});
  }

  if (chatId) {
    syncChatMessages(chatId, canonicalChatId).catch(() => {});
  }
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

app.get('/api/chats', asyncHandler(async (_req, res) => {
  const chats = store.getChatList();
  await backfillMissingPhones(chats);

  res.json({
    chats: store.getChatList()
  });
}));

app.post('/api/chats/:chatId/read', (req, res) => {
  store.markChatRead(req.params.chatId);
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
  const text = String(req.body?.text || '').trim();
  const state = store.readState();
  const chat = state.chats[chatId];

  if (!chat) {
    return res.status(404).json({ error: 'No encontré esa conversación.' });
  }

  if (!text) {
    return res.status(400).json({ error: 'Escribe un mensaje antes de enviarlo.' });
  }

  if (!chat.entityId) {
    return res.status(400).json({ error: 'Esta conversación todavía no tiene entidad de Kommo asociada.' });
  }

  const localMessageId = `local-${Date.now()}`;

  store.addMessageToChat(chatId, {
    id: localMessageId,
    text,
    timestamp: Date.now(),
    direction: 'outgoing',
    deliveryStatus: config.kommo.salesbotId ? 'en cola' : 'pendiente de bot'
  });

  store.queuePendingReply(buildPendingReplyKeys(chat), {
    text,
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
      reply_text: pendingReply?.text || '',
      has_reply: pendingReply ? '1' : '0',
      reply_channel_id: String(config.kommo.sourceId || requestedSourceId || '')
    },
    execute_handlers: []
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
          return { ...item, deliveryStatus: 'entregado al bot' };
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
