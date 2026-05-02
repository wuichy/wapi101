const fs = require('fs');
const path = require('path');
const config = require('./config');

const defaultState = {
  oauth: {
    state: null,
    requestedAt: null
  },
  kommo: {
    subdomain: '',
    tokens: null,
    account: null,
    detectedSalesbotId: null,
    lastError: null
  },
  chats: {},
  pendingReplies: {},
  webhookDebug: [],
  salesbotDebug: [],
  quickReplies: [],
  pushSubscriptions: []
};

function normalizeIdList(values) {
  const unique = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || '').trim();

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits || null;
}

function normalizePhoneList(values) {
  const unique = new Set();

  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizePhone(value);

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function shouldReplaceTitle(currentTitle, candidateTitle) {
  const current = String(currentTitle || '').trim();
  const candidate = String(candidateTitle || '').trim();

  if (!candidate) {
    return false;
  }

  if (!current) {
    return true;
  }

  if (/^Chat\s/i.test(current) && !/^Chat\s/i.test(candidate)) {
    return true;
  }

  return false;
}

function createDefaultChat(chatId) {
  return {
    chatId,
    chatIds: [chatId],
    contactId: null,
    contactIds: [],
    talkId: null,
    talkIds: [],
    entityId: null,
    entityIds: [],
    phoneNumbers: [],
    entityType: null,
    origin: null,
    title: `Chat ${chatId.slice(0, 6)}`,
    subtitle: 'Sin contacto',
    unreadCount: 0,
    lastMessageAt: Date.now(),
    messages: [],
    pinned: false,
    pinnedAt: null,
    tags: [],
    tagsFetchedAt: 0,
    pipelineId: null,
    statusId: null,
    leadInfoFetchedAt: 0
  };
}

function normalizeChat(chatId, chat) {
  const base = {
    ...createDefaultChat(chatId),
    ...(chat || {})
  };

  return {
    ...base,
    chatIds: normalizeIdList([
      ...(base.chatIds || []),
      chatId,
      base.chatId
    ]),
    contactId: base.contactId ? String(base.contactId) : null,
    contactIds: normalizeIdList([
      ...(base.contactIds || []),
      base.contactId
    ]),
    talkId: base.talkId ? String(base.talkId) : null,
    talkIds: normalizeIdList([
      ...(base.talkIds || []),
      base.talkId
    ]),
    entityId: base.entityId ? String(base.entityId) : null,
    entityIds: normalizeIdList([
      ...(base.entityIds || []),
      base.entityId
    ]),
    phoneNumbers: normalizePhoneList(base.phoneNumbers || []),
    messages: Array.isArray(base.messages) ? base.messages : []
  };
}

function buildPendingReplyKey(entityType, entityId) {
  const normalizedType = String(entityType || '').trim();
  const normalizedId = String(entityId || '').trim();

  if (!normalizedType || !normalizedId) {
    return null;
  }

  return `${normalizedType}:${normalizedId}`;
}

function normalizeQuickReply(item) {
  return {
    id: String(item?.id || ''),
    name: String(item?.name || '').trim(),
    text: String(item?.text || ''),
    attachment: item?.attachment && typeof item.attachment === 'object'
      ? {
          name: String(item.attachment.name || '').trim(),
          type: String(item.attachment.type || '').trim(),
          dataUrl: String(item.attachment.dataUrl || '')
        }
      : null,
    createdAt: Number(item?.createdAt || Date.now()),
    updatedAt: Number(item?.updatedAt || Date.now())
  };
}

function chatMatchesCriteria(chat, criteria = {}) {
  const contactId = criteria.contactId ? String(criteria.contactId) : null;
  const entityId = criteria.entityId ? String(criteria.entityId) : null;
  const talkId = criteria.talkId ? String(criteria.talkId) : null;
  const chatId = criteria.chatId ? String(criteria.chatId) : null;
  const phoneNumbers = normalizePhoneList(criteria.phoneNumbers || []);

  if (chatId && (chat.chatId === chatId || chat.chatIds.includes(chatId))) {
    return true;
  }

  if (talkId && (chat.talkId === talkId || chat.talkIds.includes(talkId))) {
    return true;
  }

  if (contactId && chat.contactIds.includes(contactId)) {
    return true;
  }

  if (entityId && chat.entityIds.includes(entityId)) {
    return true;
  }

  if (phoneNumbers.length && chat.phoneNumbers.some((phone) => phoneNumbers.includes(phone))) {
    return true;
  }

  return false;
}

function chooseCanonicalChat(entries) {
  return entries
    .slice()
    .sort((left, right) => {
      const messageCountDiff = (right.messages?.length || 0) - (left.messages?.length || 0);

      if (messageCountDiff) {
        return messageCountDiff;
      }

      const leftFirstTimestamp = left.messages?.[0]?.timestamp || left.lastMessageAt || Number.MAX_SAFE_INTEGER;
      const rightFirstTimestamp = right.messages?.[0]?.timestamp || right.lastMessageAt || Number.MAX_SAFE_INTEGER;

      if (leftFirstTimestamp !== rightFirstTimestamp) {
        return leftFirstTimestamp - rightFirstTimestamp;
      }

      return String(left.chatId).localeCompare(String(right.chatId));
    })[0];
}

function mergeChats(target, source) {
  target.chatIds = normalizeIdList([
    ...(target.chatIds || []),
    target.chatId,
    ...(source.chatIds || []),
    source.chatId
  ]);
  target.contactIds = normalizeIdList([
    ...(target.contactIds || []),
    target.contactId,
    ...(source.contactIds || []),
    source.contactId
  ]);
  target.talkIds = normalizeIdList([
    ...(target.talkIds || []),
    target.talkId,
    ...(source.talkIds || []),
    source.talkId
  ]);
  target.entityIds = normalizeIdList([
    ...(target.entityIds || []),
    target.entityId,
    ...(source.entityIds || []),
    source.entityId
  ]);
  target.phoneNumbers = normalizePhoneList([
    ...(target.phoneNumbers || []),
    ...(source.phoneNumbers || [])
  ]);
  target.contactId = target.contactId || source.contactId;
  target.talkId = target.talkId || source.talkId;
  target.entityId = target.entityId || source.entityId;
  target.entityType = target.entityType || source.entityType;
  target.origin = target.origin || source.origin;
  target.subtitle = target.subtitle === 'Sin contacto' ? source.subtitle : target.subtitle;

  if (shouldReplaceTitle(target.title, source.title)) {
    target.title = source.title;
  }

  const mergedMessages = [...(target.messages || []), ...(source.messages || [])];
  const seen = new Set();
  target.messages = mergedMessages
    .filter((message) => {
      const key = String(message.id || '');

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  target.lastMessageAt = Math.max(target.lastMessageAt || 0, source.lastMessageAt || 0);
  target.unreadCount = Math.max(target.unreadCount || 0, source.unreadCount || 0);

  return target;
}

function ensureFile() {
  const dir = path.dirname(config.storageFile);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(config.storageFile)) {
    fs.writeFileSync(config.storageFile, JSON.stringify(defaultState, null, 2));
  }
}

function readState() {
  ensureFile();

  try {
    const state = JSON.parse(fs.readFileSync(config.storageFile, 'utf8'));
    const chats = Object.fromEntries(
      Object.entries(state.chats || {}).map(([chatId, chat]) => [chatId, normalizeChat(chatId, chat)])
    );

    return {
      ...defaultState,
      ...state,
      oauth: { ...defaultState.oauth, ...(state.oauth || {}) },
      kommo: { ...defaultState.kommo, ...(state.kommo || {}) },
      chats,
      pendingReplies: state.pendingReplies || {},
      webhookDebug: state.webhookDebug || [],
      salesbotDebug: state.salesbotDebug || [],
      quickReplies: Array.isArray(state.quickReplies) ? state.quickReplies.map(normalizeQuickReply) : [],
      pushSubscriptions: Array.isArray(state.pushSubscriptions) ? state.pushSubscriptions : []
    };
  } catch (error) {
    return JSON.parse(JSON.stringify(defaultState));
  }
}

function writeState(state) {
  ensureFile();
  fs.writeFileSync(config.storageFile, JSON.stringify(state, null, 2));
}

function updateState(mutator) {
  const state = readState();
  mutator(state);
  writeState(state);
  return state;
}

function getChatList() {
  const state = readState();
  return Object.values(state.chats).sort((a, b) => {
    // Pinned chats always first
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    if (a.pinned && b.pinned) {
      return (b.pinnedAt || 0) - (a.pinnedAt || 0);
    }
    return b.lastMessageAt - a.lastMessageAt;
  });
}

function upsertChat(chatId, updater) {
  return updateState((state) => {
    const existing = normalizeChat(chatId, state.chats[chatId]);

    state.chats[chatId] = normalizeChat(chatId, updater(existing) || existing);
  });
}

function addMessageToChat(chatId, message) {
  let wasAdded = false;

  upsertChat(chatId, (chat) => {
    const duplicate = chat.messages.some((item) => item.id === message.id);

    if (duplicate) {
      return chat;
    }

    const messageId = String(message.id || '');

    if (message.direction === 'outgoing' && !messageId.startsWith('local-')) {
      const localIdx = chat.messages.findIndex(
        (item) =>
          String(item.id || '').startsWith('local-') &&
          item.direction === 'outgoing' &&
          item.text === message.text
      );

      if (localIdx >= 0) {
        chat.messages[localIdx] = {
          ...chat.messages[localIdx],
          id: message.id,
          deliveryStatus: 'enviado',
          status: 'sent'
        };
        return chat;
      }
    }

    // Dedup adicional para mensajes incoming: si en los últimos 30s ya hay un
    // mensaje con el mismo texto y dirección, asumimos que es el mismo evento
    // duplicado (Kommo a veces envía add_message y update_talk para lo mismo).
    if (message.direction === 'incoming' && message.text) {
      const recentDuplicate = chat.messages.some((item) =>
        item.direction === 'incoming' &&
        item.text === message.text &&
        Math.abs((item.timestamp || 0) - (message.timestamp || 0)) < 30000
      );
      if (recentDuplicate) {
        return chat;
      }
    }

    const normalizedStatus = message.status || (message.direction === 'outgoing' ? 'pending' : null);

    chat.messages.push({
      ...message,
      status: normalizedStatus
    });
    chat.messages.sort((a, b) => a.timestamp - b.timestamp);
    chat.lastMessageAt = message.timestamp;

    if (message.direction === 'incoming') {
      chat.unreadCount += 1;
    }

    wasAdded = true;
    return chat;
  });

  return wasAdded;
}

function updateMessageStatus(chatId, messageId, status) {
  return upsertChat(chatId, (chat) => {
    const idx = chat.messages.findIndex((item) => String(item.id) === String(messageId));

    if (idx < 0) {
      return chat;
    }

    chat.messages[idx] = {
      ...chat.messages[idx],
      status
    };
    return chat;
  });
}

function markChatRead(chatId) {
  return upsertChat(chatId, (chat) => {
    chat.unreadCount = 0;
    return chat;
  });
}

function markChatUnread(chatId) {
  return upsertChat(chatId, (chat) => {
    if (!chat.unreadCount || chat.unreadCount <= 0) {
      chat.unreadCount = 1;
    }
    return chat;
  });
}

function setChatPinned(chatId, pinned) {
  return upsertChat(chatId, (chat) => {
    chat.pinned = Boolean(pinned);
    chat.pinnedAt = pinned ? Date.now() : null;
    return chat;
  });
}

function setChatTags(chatId, tags) {
  return upsertChat(chatId, (chat) => {
    chat.tags = Array.isArray(tags) ? tags : [];
    chat.tagsFetchedAt = Date.now();
    return chat;
  });
}

function setChatLeadInfo(chatId, { tags, pipelineId, statusId }) {
  return upsertChat(chatId, (chat) => {
    if (Array.isArray(tags)) chat.tags = tags;
    chat.pipelineId = pipelineId != null ? Number(pipelineId) : null;
    chat.statusId = statusId != null ? Number(statusId) : null;
    const now = Date.now();
    chat.tagsFetchedAt = now;
    chat.leadInfoFetchedAt = now;
    return chat;
  });
}

function deleteChat(chatId) {
  return updateState((state) => {
    delete state.chats[chatId];

    for (const [key, payload] of Object.entries(state.pendingReplies || {})) {
      if (payload?.chatId === chatId) {
        delete state.pendingReplies[key];
      }
    }
  });
}

function queuePendingReply(replyKeys, payload) {
  const normalizedKeys = Array.from(new Set(
    (Array.isArray(replyKeys) ? replyKeys : [replyKeys]).filter(Boolean)
  ));

  if (!normalizedKeys.length) {
    return readState();
  }

  return updateState((state) => {
    const entry = {
      ...payload,
      replyKeys: normalizedKeys
    };

    for (const key of normalizedKeys) {
      state.pendingReplies[key] = entry;
    }
  });
}

function consolidateChats(criteria = {}) {
  const state = readState();
  const entries = Object.values(state.chats || {});
  const matchingChats = entries.filter((chat) => chatMatchesCriteria(chat, criteria));

  if (!matchingChats.length) {
    return criteria.chatId ? String(criteria.chatId) : null;
  }

  if (matchingChats.length === 1) {
    return matchingChats[0].chatId;
  }

  const canonical = chooseCanonicalChat(matchingChats);

  for (const chat of matchingChats) {
    if (chat.chatId === canonical.chatId) {
      continue;
    }

    mergeChats(canonical, chat);
    delete state.chats[chat.chatId];
  }

  state.chats[canonical.chatId] = normalizeChat(canonical.chatId, canonical);
  writeState(state);
  return canonical.chatId;
}

function consumePendingReply(entityType, entityId) {
  const key = buildPendingReplyKey(entityType, entityId);

  if (!key) {
    return null;
  }

  const state = readState();
  const payload = state.pendingReplies[key];

  if (!payload) {
    return null;
  }

  const replyKeys = Array.isArray(payload.replyKeys) && payload.replyKeys.length
    ? payload.replyKeys
    : [key];

  for (const replyKey of replyKeys) {
    delete state.pendingReplies[replyKey];
  }

  writeState(state);
  return payload;
}

function pushWebhookDebug(payload) {
  return updateState((state) => {
    state.webhookDebug.unshift({
      receivedAt: Date.now(),
      payload
    });
    state.webhookDebug = state.webhookDebug.slice(0, 100);
  });
}

function setDetectedSalesbotId(botId) {
  return updateState((state) => {
    state.kommo.detectedSalesbotId = botId ? Number(botId) : null;
  });
}

function setKommoLastError(error) {
  return updateState((state) => {
    state.kommo.lastError = error
      ? {
          message: String(error.message || 'Error desconocido'),
          status: error.status || null,
          detail: error.detail || null,
          at: error.at || Date.now()
        }
      : null;
  });
}

function clearKommoLastError() {
  return updateState((state) => {
    state.kommo.lastError = null;
  });
}

function pushSalesbotDebug(entry) {
  return updateState((state) => {
    state.salesbotDebug.unshift({
      receivedAt: Date.now(),
      ...entry
    });
    state.salesbotDebug = state.salesbotDebug.slice(0, 20);
  });
}

function getQuickReplies() {
  const state = readState();
  return (state.quickReplies || [])
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'es', { sensitivity: 'base' }));
}

function upsertQuickReply(reply) {
  const normalized = normalizeQuickReply(reply);

  return updateState((state) => {
    const index = (state.quickReplies || []).findIndex((item) => item.id === normalized.id);

    if (index >= 0) {
      state.quickReplies[index] = {
        ...state.quickReplies[index],
        ...normalized,
        updatedAt: Date.now()
      };
      return;
    }

    state.quickReplies.push({
      ...normalized,
      createdAt: normalized.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  });
}

function deleteQuickReply(id) {
  return updateState((state) => {
    state.quickReplies = (state.quickReplies || []).filter((item) => item.id !== id);
  });
}

module.exports = {
  readState,
  writeState,
  updateState,
  getChatList,
  upsertChat,
  addMessageToChat,
  markChatRead,
  deleteChat,
  buildPendingReplyKey,
  consolidateChats,
  queuePendingReply,
  updateMessageStatus,
  markChatUnread,
  setChatPinned,
  setChatTags,
  setChatLeadInfo,
  consumePendingReply,
  pushWebhookDebug,
  setDetectedSalesbotId,
  setKommoLastError,
  clearKommoLastError,
  pushSalesbotDebug,
  getQuickReplies,
  upsertQuickReply,
  deleteQuickReply
};
