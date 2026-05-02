const state = {
  chats: [],
  selectedChatId: null,
  filter: '',
  activeFilter: 'all',
  status: null,
  quickReplies: [],
  notifications: [],
  composerAttachment: null,
  initialized: false,
  editingQuickReplyId: null,
  editingQuickReplyAttachment: null,
  quickReplySubmitting: false
};

const CHANNEL_REGISTRY = [
  {
    keys: ['waba', 'wa', 'whatsapp', 'wabusiness', 'whatsapp_business'],
    key: 'whatsapp',
    label: 'WhatsApp',
    color: '#25D366',
    iconSvg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.6 6.32A8 8 0 0 0 4.13 14.6L3 20l5.5-1.45A8 8 0 0 0 20 12a8 8 0 0 0-2.4-5.68zm-5.6 12.3a6.6 6.6 0 0 1-3.36-.92l-.24-.14-3.27.85.87-3.18-.16-.25a6.6 6.6 0 1 1 6.16 3.64zm3.62-4.95c-.2-.1-1.18-.58-1.36-.65-.18-.07-.32-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.23.15-.43.05-.2-.1-.83-.31-1.59-.98-.59-.52-.99-1.17-1.1-1.37-.12-.2-.01-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.07-.13.03-.25-.02-.35-.05-.1-.45-1.08-.61-1.48-.16-.39-.32-.34-.45-.35h-.39c-.13 0-.35.05-.53.25-.18.2-.7.69-.7 1.67 0 .98.72 1.93.82 2.06.1.13 1.42 2.16 3.43 3.03.48.21.85.33 1.14.43.48.15.92.13 1.27.08.39-.06 1.18-.48 1.35-.95.17-.46.17-.86.12-.95-.05-.08-.18-.13-.38-.23z"/></svg>'
  },
  {
    keys: ['instagram', 'ig', 'instagram_direct'],
    key: 'instagram',
    label: 'Instagram',
    color: '#E4405F',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" ry="5"/><path d="M16 11.4a4 4 0 1 1-7.9 1.2 4 4 0 0 1 7.9-1.2z"/><line x1="17.5" y1="6.5" x2="17.5" y2="6.5"/></svg>'
  },
  {
    keys: ['facebook', 'fb', 'messenger', 'fb_messenger'],
    key: 'facebook',
    label: 'Facebook',
    color: '#1877F2',
    iconSvg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 12a10 10 0 1 0-11.6 9.9V14.9H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.3 0-1.7.8-1.7 1.6V12h2.9l-.5 2.9h-2.4v7A10 10 0 0 0 22 12z"/></svg>'
  },
  {
    keys: ['tiktok', 'tiktok_kommo'],
    key: 'tiktok',
    label: 'TikTok',
    color: '#000000',
    iconSvg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 6.7a4.8 4.8 0 0 1-2.9-1 4.8 4.8 0 0 1-1.9-3.5h-3.3v13.4a2.9 2.9 0 1 1-2-2.7V9.5a6.2 6.2 0 1 0 5.3 6.1V9.4a8 8 0 0 0 4.8 1.6V7.7a4.8 4.8 0 0 1 0-1z"/></svg>'
  },
  {
    keys: ['telegram', 'tg'],
    key: 'telegram',
    label: 'Telegram',
    color: '#0088CC',
    iconSvg: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.4 4.3 2.6 11.5c-1.2.4-1.2 1.2-.2 1.5l4.7 1.5 1.8 5.6c.2.6.1.9.7.9.5 0 .7-.2 1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3-14.2c.3-1.3-.5-1.9-1.4-1.5z"/></svg>'
  },
  {
    keys: ['email', 'mail', 'gmail'],
    key: 'email',
    label: 'Email',
    color: '#5F6368',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/></svg>'
  },
  {
    keys: ['livechat', 'chat', 'web', 'webchat'],
    key: 'livechat',
    label: 'Live chat',
    color: '#34AADC',
    iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2a8.5 8.5 0 1 1 16.1-4.3z"/></svg>'
  }
];

const DEFAULT_CHANNEL = {
  key: 'other',
  label: 'Otro',
  color: '#8E8E93',
  iconSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
};

function getChannelInfo(originRaw) {
  const origin = String(originRaw || '').trim().toLowerCase();

  if (!origin) {
    return DEFAULT_CHANNEL;
  }

  for (const channel of CHANNEL_REGISTRY) {
    if (channel.keys.some((key) => origin === key || origin.includes(key))) {
      return channel;
    }
  }

  return { ...DEFAULT_CHANNEL, label: originRaw };
}

function normalizeMessageStatus(message) {
  if (message.direction !== 'outgoing') {
    return null;
  }

  if (message.status) {
    return message.status;
  }

  const legacy = String(message.deliveryStatus || '').toLowerCase();

  if (['en cola', 'pendiente de bot'].includes(legacy)) {
    return 'pending';
  }

  if (['entregado al bot', 'enviado', 'ok'].includes(legacy)) {
    return 'sent';
  }

  return 'pending';
}

function buildStatusIconHtml(status) {
  if (status === 'pending') {
    return '<span class="msg-status pending" title="Enviando..."><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4v4l2.5 2"/></svg></span>';
  }

  if (status === 'sent') {
    return '<span class="msg-status sent" title="Enviado"><svg viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="2,6 6,10 14,2"/></svg></span>';
  }

  if (status === 'delivered') {
    return '<span class="msg-status delivered" title="Entregado"><svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,6 5,10 12,2"/><polyline points="7,10 14,2 14,2"/><polyline points="7,6 11,10 18,2"/></svg></span>';
  }

  if (status === 'read') {
    return '<span class="msg-status read" title="Leído"><svg viewBox="0 0 20 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1,6 5,10 12,2"/><polyline points="7,6 11,10 18,2"/></svg></span>';
  }

  return '';
}

function buildChannelBadgeHtml(originRaw) {
  const info = getChannelInfo(originRaw);
  return `<span class="channel-badge"><span class="channel-icon" style="color: ${info.color}">${info.iconSvg}</span><span class="channel-label">${info.label}</span></span>`;
}

const connectionBanner = document.getElementById('connectionBanner');
const connectionBannerText = document.getElementById('connectionBannerText');
const connectionBannerRetry = document.getElementById('connectionBannerRetry');

const chatList = document.getElementById('chatList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const chatMeta = document.getElementById('chatMeta');
const connectionLabel = document.getElementById('connectionLabel');
const connectButton = document.getElementById('connectButton');
const brandVersion = document.getElementById('brandVersion');
const searchInput = document.getElementById('searchInput');
const openQuickReplyManagerButton = document.getElementById('openQuickReplyManagerButton');
const replyForm = document.getElementById('replyForm');
const replyInput = document.getElementById('replyInput');
const sendButton = document.getElementById('sendButton');
const deleteChatButton = document.getElementById('deleteChatButton'); // legacy, may be null
const composerAttachmentButton = document.getElementById('composerAttachmentButton');
const openQuickReplyPickerButton = document.getElementById('openQuickReplyPickerButton');
const quickReplyList = document.getElementById('quickReplyList');
const quickReplyPicker = document.getElementById('quickReplyPicker');
const quickReplyPickerList = document.getElementById('quickReplyPickerList');
const quickReplyManagerModal = document.getElementById('quickReplyManagerModal');
const closeQuickReplyManagerButton = document.getElementById('closeQuickReplyManagerButton');
const closeQuickReplyPickerButton = document.getElementById('closeQuickReplyPickerButton');
const quickReplyForm = document.getElementById('quickReplyForm');
const quickReplyName = document.getElementById('quickReplyName');
const quickReplyText = document.getElementById('quickReplyText');
const quickReplyAttachment = document.getElementById('quickReplyAttachment');
const quickReplyAttachmentName = document.getElementById('quickReplyAttachmentName');
const attachmentSheet = document.getElementById('attachmentSheet');
const closeAttachmentSheetButton = document.getElementById('closeAttachmentSheetButton');
const cameraAttachmentInput = document.getElementById('cameraAttachmentInput');
const libraryAttachmentInput = document.getElementById('libraryAttachmentInput');
const fileAttachmentInput = document.getElementById('fileAttachmentInput');
const replyWindowNotice = document.getElementById('replyWindowNotice');
// composerAttachmentHint reemplazado por composerAttachmentPreview con miniatura
const appNotifications = document.getElementById('appNotifications');
const backToInboxButton = document.getElementById('backToInboxButton');
const logoutButton = document.getElementById('logoutButton');
const chatContextMenu = document.getElementById('chatContextMenu');

// Auto-redirect to /login if session expires
const _origFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await _origFetch(...args);
  if (response.status === 401 && location.pathname !== '/login' && location.pathname !== '/login.html') {
    location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
  }
  return response;
};

function isMobileViewport() {
  return window.matchMedia('(max-width: 660px)').matches;
}

function setMobileChatOpen(open) {
  document.body.classList.toggle('mobile-chat-open', Boolean(open));
}

function formatErrorDetails(payload) {
  const parts = [];

  if (payload?.error) {
    parts.push(payload.error);
  }

  if (payload?.detail) {
    parts.push(`Detalle: ${payload.detail}`);
  }

  if (Array.isArray(payload?.attempts) && payload.attempts.length) {
    const attemptLines = payload.attempts.map((item) => {
      const typeLabel = item.entityType === 'contact' ? 'contacto' : 'lead';
      const statusLabel = item.status ? ` (HTTP ${item.status})` : '';
      return `- ${typeLabel} ${item.entityId}${statusLabel}: ${item.message || 'sin detalle'}`;
    });

    parts.push(`Intentos:\n${attemptLines.join('\n')}`);
  }

  return parts.filter(Boolean).join('\n\n') || 'No se pudo enviar.';
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return time;

  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const aa = String(date.getFullYear()).slice(2);
  return `${dd}/${mm}/${aa} ${time}`;
}

function formatPhoneNumber(rawValue) {
  const digits = String(rawValue || '').replace(/\D+/g, '');

  if (!digits) {
    return 'Telefono no disponible';
  }

  if (digits.startsWith('521') && digits.length === 13) {
    return `+${digits}`;
  }

  if (digits.startsWith('52') && digits.length === 12) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+521${digits}`;
  }

  return digits.startsWith('+') ? digits : `+${digits}`;
}

function getSelectedChat() {
  return state.chats.find((chat) => chat.chatId === state.selectedChatId) || null;
}

function getLatestIncomingMessage(chat) {
  const incomingMessages = (chat?.messages || []).filter((item) => item.direction === 'incoming');

  if (!incomingMessages.length) {
    return null;
  }

  return incomingMessages.sort((left, right) => right.timestamp - left.timestamp)[0];
}

function isWhatsAppChat(chat) {
  if (!chat) return false;
  return getChannelInfo(chat.origin).key === 'whatsapp';
}

function getReplyWindowState(chat) {
  const latestIncoming = getLatestIncomingMessage(chat);

  // El countdown de 24h solo aplica a WhatsApp (Business API tiene esa regla).
  // Otros canales no tienen este límite estricto desde la app.
  if (!latestIncoming || !isWhatsAppChat(chat)) {
    return {
      latestIncoming: null,
      expired: false,
      remaining: null,
      applies: false
    };
  }

  const deadline = Number(latestIncoming.timestamp) + (24 * 60 * 60 * 1000);
  const remaining = deadline - Date.now();

  return {
    latestIncoming,
    expired: remaining <= 0,
    remaining,
    applies: true
  };
}

function formatWindowCountdown(timestamp, expiredLabel = 'Chat caducado') {
  const deadline = Number(timestamp || 0) + (24 * 60 * 60 * 1000);
  const remaining = deadline - Date.now();

  if (remaining <= 0) {
    return expiredLabel;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  return `${hours}:${minutes}:${seconds}`;
}

function requestNotificationPermission() {
  if (!('Notification' in window) || Notification.permission !== 'default') {
    return;
  }

  Notification.requestPermission().catch(() => {});
}

function showBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const notification = new Notification(title, { body });
    setTimeout(() => notification.close(), 6000);
  } catch (error) {
    // Ignore browser notification errors in unsupported environments.
  }
}

function pushInAppNotification(type, title, body) {
  const item = {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    title,
    body
  };

  state.notifications.unshift(item);
  state.notifications = state.notifications.slice(0, 5);
  renderNotifications();

  // Ya NO escalamos a notificación nativa del navegador: para mensajes nuevos
  // se ocupa el push del service worker (sw.js). Mostrar Notification() acá
  // duplicaba la alerta en iPhone cuando el usuario tenía la PWA abierta.

  setTimeout(() => {
    state.notifications = state.notifications.filter((entry) => entry.id !== item.id);
    renderNotifications();
  }, 6000);
}

// ─────────────────────────────────────────────────────────────
// Watchdog de conexión: detecta cuándo el server/red está caído.
// Si las llamadas de polling fallan N veces seguidas, marca offline,
// muestra banner persistente + dispara notificación del sistema (Mac/iOS).
// Cuando vuelve la conexión, muestra banner verde y notifica recuperación.
// ─────────────────────────────────────────────────────────────
const CONNECTION_FAIL_THRESHOLD = 3;     // 3 fallos seguidos = offline (12-36s con polling)
const CONNECTION_RECOVERY_BANNER_MS = 4000;
const CONNECTION_NOTIFY_COOLDOWN_MS = 60_000; // No re-spammear notif del sistema antes de 1min

const connectionState = {
  consecutiveFailures: 0,
  isOffline: false,
  lastNotifyAt: 0,
  recoveryTimer: null,
  lastError: null
};

function setConnectionBanner(mode, text) {
  if (!connectionBanner) return;
  if (!mode) {
    connectionBanner.hidden = true;
    connectionBanner.classList.remove('degraded', 'recovered');
    return;
  }
  connectionBanner.hidden = false;
  connectionBanner.classList.toggle('degraded', mode === 'degraded');
  connectionBanner.classList.toggle('recovered', mode === 'recovered');
  if (connectionBannerText) connectionBannerText.textContent = text;
}

function maybeFireSystemNotification(title, body) {
  // Notification API: funciona en macOS Safari/Chrome y en iOS PWA instalada (16.4+)
  const now = Date.now();
  if (now - connectionState.lastNotifyAt < CONNECTION_NOTIFY_COOLDOWN_MS) return;
  connectionState.lastNotifyAt = now;
  showBrowserNotification(title, body);
}

function markConnectionFailure(error) {
  connectionState.consecutiveFailures += 1;
  connectionState.lastError = error?.message || 'sin detalle';

  if (!connectionState.isOffline && connectionState.consecutiveFailures >= CONNECTION_FAIL_THRESHOLD) {
    connectionState.isOffline = true;
    if (connectionState.recoveryTimer) {
      clearTimeout(connectionState.recoveryTimer);
      connectionState.recoveryTimer = null;
    }
    setConnectionBanner('offline', 'Sin conexión con el servidor — reintentando…');
    pushInAppNotification('error', 'Reelance Hub desconectado', 'No se puede contactar el servidor. Reintentando automáticamente.');
    maybeFireSystemNotification('Reelance Hub desconectado', 'Perdiste conexión con el servidor. Verifica tu red.');
  } else if (!connectionState.isOffline && connectionState.consecutiveFailures > 0) {
    // Modo "degradado" — primer fallo: aviso suave en banner naranja
    setConnectionBanner('degraded', 'Conexión inestable — verificando…');
  }
}

function markConnectionSuccess() {
  const wasOffline = connectionState.isOffline;
  connectionState.consecutiveFailures = 0;
  connectionState.isOffline = false;
  connectionState.lastError = null;

  if (wasOffline) {
    setConnectionBanner('recovered', 'Conexión restaurada ✓');
    pushInAppNotification('message', 'Conexión restaurada', 'Reelance Hub volvió a conectar con el servidor.');
    maybeFireSystemNotification('Reelance Hub reconectado', 'La conexión con el servidor se restableció.');
    // Auto-ocultar el banner verde después de 4s
    if (connectionState.recoveryTimer) clearTimeout(connectionState.recoveryTimer);
    connectionState.recoveryTimer = setTimeout(() => {
      setConnectionBanner(null);
      connectionState.recoveryTimer = null;
    }, CONNECTION_RECOVERY_BANNER_MS);
  } else {
    // Si veníamos en "degradado" sin haber escalado a offline, limpiar banner
    setConnectionBanner(null);
  }
}

function renderNotifications() {
  appNotifications.innerHTML = '';

  for (const item of state.notifications) {
    const node = document.createElement('article');
    node.className = `app-notification ${item.type}`;
    node.innerHTML = `
      <strong>${item.title}</strong>
      <p>${item.body}</p>
    `;
    appNotifications.appendChild(node);
  }
}

function renderComposerState() {
  const preview = document.getElementById('composerAttachmentPreview');
  const thumb = document.getElementById('composerAttachmentThumb');
  const fileIcon = document.getElementById('composerAttachmentFile');
  const nameEl = preview?.querySelector('.composer-attachment-name');

  if (!preview) return;

  if (!state.composerAttachment) {
    preview.hidden = true;
    if (thumb) { thumb.hidden = true; thumb.src = ''; }
    if (fileIcon) fileIcon.hidden = true;
    if (nameEl) nameEl.textContent = '';
    return;
  }

  const att = state.composerAttachment;
  const isImage = String(att.type || '').startsWith('image/');

  preview.hidden = false;
  if (nameEl) nameEl.textContent = att.name || 'archivo';

  if (isImage && att.dataUrl) {
    if (thumb) { thumb.hidden = false; thumb.src = att.dataUrl; }
    if (fileIcon) fileIcon.hidden = true;
  } else {
    if (thumb) { thumb.hidden = true; thumb.src = ''; }
    if (fileIcon) { fileIcon.hidden = false; fileIcon.textContent = '📎'; }
  }
}

function openQuickReplyManager() {
  quickReplyManagerModal.hidden = false;
  quickReplyManagerModal.removeAttribute('hidden');
}

function closeQuickReplyManager() {
  quickReplyManagerModal.hidden = true;
  quickReplyManagerModal.setAttribute('hidden', '');
  resetQuickReplyForm();
}

function resetQuickReplyForm() {
  quickReplyForm.reset();
  quickReplyAttachmentName.textContent = '';
  state.editingQuickReplyId = null;
  state.editingQuickReplyAttachment = null;
  updateQuickReplyFormMode();
}

function updateQuickReplyFormMode() {
  const submitBtn = quickReplyForm.querySelector('button[type="submit"]');
  const cancelBtn = document.getElementById('quickReplyCancelEditButton');
  const editing = Boolean(state.editingQuickReplyId);

  if (submitBtn) {
    submitBtn.textContent = editing ? 'Actualizar' : 'Guardar';
  }

  if (cancelBtn) {
    cancelBtn.hidden = !editing;
  }
}

function startEditingQuickReply(item) {
  state.editingQuickReplyId = item.id;
  state.editingQuickReplyAttachment = item.attachment || null;
  quickReplyName.value = item.name || '';
  quickReplyText.value = item.text || '';
  quickReplyAttachment.value = '';
  quickReplyAttachmentName.textContent = item.attachment?.name
    ? `Adjunto actual: ${item.attachment.name}`
    : '';
  openQuickReplyManager();
  updateQuickReplyFormMode();
  quickReplyName.focus();
}

function openQuickReplyPicker() {
  quickReplyPicker.hidden = false;
}

function closeQuickReplyPicker() {
  quickReplyPicker.hidden = true;
}

function openAttachmentSheet() {
  attachmentSheet.hidden = false;
}

function closeAttachmentSheet() {
  attachmentSheet.hidden = true;
}

function applyQuickReply(item) {
  replyInput.value = item.text || '';
  state.composerAttachment = item.attachment || null;
  renderComposerState();
  closeQuickReplyPicker();
  replyInput.focus();
}

function updateReplyAvailability() {
  const currentChat = getSelectedChat();
  const windowState = getReplyWindowState(currentChat);
  const expired = Boolean(windowState.latestIncoming && windowState.expired);

  sendButton.disabled = !currentChat || expired;

  if (!expired) {
    replyWindowNotice.hidden = true;
    replyWindowNotice.textContent = '';
    return;
  }

  replyWindowNotice.hidden = false;
  replyWindowNotice.textContent = 'Chat caducado: la ventana de 24 horas ya terminó.';
}

function buildChatHaystack(chat) {
  const parts = [
    chat.title || '',
    chat.subtitle || '',
    chat.origin || '',
    ...(chat.phoneNumbers || []),
    ...(chat.contactIds || []),
    ...(chat.messages || []).map((m) => m.text || '')
  ];

  return parts.join(' ').toLowerCase();
}

function chatMatchesActiveFilter(chat) {
  if (state.activeFilter === 'all') {
    return true;
  }

  if (state.activeFilter === 'unread') {
    return Number(chat.unreadCount || 0) > 0;
  }

  if (state.activeFilter.startsWith('channel:')) {
    const wantedKey = state.activeFilter.slice('channel:'.length);
    return getChannelInfo(chat.origin).key === wantedKey;
  }

  return true;
}

function getUniqueChannelsFromChats() {
  const seen = new Map();

  for (const chat of state.chats) {
    const info = getChannelInfo(chat.origin);

    if (info.key === 'other' && !chat.origin) {
      continue;
    }

    if (!seen.has(info.key)) {
      seen.set(info.key, info);
    }
  }

  return Array.from(seen.values());
}

function renderFilterPills() {
  const container = document.getElementById('filterPills');

  if (!container) {
    return;
  }

  const unreadCount = state.chats.reduce((acc, chat) => acc + Number(chat.unreadCount || 0), 0);
  const channels = getUniqueChannelsFromChats();
  const pills = [
    { key: 'all', label: 'Todos', count: state.chats.length },
    { key: 'unread', label: 'No leídos', count: unreadCount }
  ];

  for (const channel of channels) {
    const count = state.chats.filter((chat) => getChannelInfo(chat.origin).key === channel.key).length;
    pills.push({
      key: `channel:${channel.key}`,
      label: channel.label,
      count,
      iconSvg: channel.iconSvg,
      color: channel.color
    });
  }

  container.innerHTML = '';

  for (const pill of pills) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'filter-pill' + (state.activeFilter === pill.key ? ' active' : '');
    const iconColor = state.activeFilter === pill.key ? '#fff' : pill.color;
    const iconHtml = pill.iconSvg
      ? `<span class="channel-icon" style="color: ${iconColor}">${pill.iconSvg}</span>`
      : '';
    btn.innerHTML = `${iconHtml}<span>${pill.label}</span><span class="filter-pill-count">${pill.count}</span>`;
    btn.addEventListener('click', () => {
      state.activeFilter = pill.key;
      renderFilterPills();
      renderSidebar();
    });
    container.appendChild(btn);
  }
}

function renderSidebar() {
  const template = document.getElementById('chatItemTemplate');
  chatList.innerHTML = '';

  const searchTerm = state.filter.trim().toLowerCase();
  const visibleChats = state.chats.filter((chat) => {
    if (!chatMatchesActiveFilter(chat)) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    return buildChatHaystack(chat).includes(searchTerm);
  });

  if (!visibleChats.length) {
    const emptyMsg = state.filter || state.activeFilter !== 'all'
      ? 'No hay conversaciones que coincidan con el filtro o búsqueda.'
      : 'Todavía no hay conversaciones sincronizadas.';
    chatList.innerHTML = `<p class="muted" style="padding: 12px 14px;">${emptyMsg}</p>`;
    return;
  }

  for (const chat of visibleChats) {
    const node = template.content.firstElementChild.cloneNode(true);
    const lastMessage = [...(chat.messages || [])].sort((left, right) => right.timestamp - left.timestamp)[0];
    const windowState = getReplyWindowState(chat);
    const phone = chat.phoneNumbers?.[0]
      ? formatPhoneNumber(chat.phoneNumbers[0])
      : 'Telefono no disponible';

    node.querySelector('.chat-name').textContent = chat.title;
    node.querySelector('.chat-time').textContent = lastMessage ? formatTime(lastMessage.timestamp) : '';
    node.querySelector('.chat-phone').textContent = phone;
    node.querySelector('.chat-preview').textContent = lastMessage ? lastMessage.text : 'Sin mensajes';

    if (chat.pinned) {
      node.classList.add('pinned');
      const pinIcon = node.querySelector('.chat-pin-icon');
      if (pinIcon) pinIcon.hidden = false;
    }

    const pipelineEl = node.querySelector('.chat-pipeline-stage');
    if (pipelineEl && (chat.pipelineName || chat.statusName)) {
      const parts = [chat.pipelineName, chat.statusName].filter(Boolean);
      const label = parts.join(': ');
      pipelineEl.hidden = false;
      pipelineEl.textContent = label;
      pipelineEl.title = label;
    }

    const tagsContainer = node.querySelector('.chat-tags');
    if (tagsContainer && Array.isArray(chat.tags) && chat.tags.length) {
      const lastThree = chat.tags.slice(-3);
      tagsContainer.hidden = false;
      tagsContainer.innerHTML = lastThree
        .map((tag) => `<span class="chat-tag" title="${tag.name}">${tag.name}</span>`)
        .join('');
    }

    const originBadge = node.querySelector('.chat-origin');
    if (originBadge) {
      originBadge.innerHTML = buildChannelBadgeHtml(chat.origin);
    }

    if (Number(chat.unreadCount || 0) > 0) {
      const topRow = node.querySelector('.chat-item-top');
      const dot = document.createElement('span');
      dot.className = 'chat-unread-dot';
      dot.title = `${chat.unreadCount} sin leer`;
      topRow?.appendChild(dot);
    }

    // Right-click (desktop) → menú contextual
    node.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openChatContextMenu(chat, event.clientX, event.clientY);
    });

    // Long-press (mobile) → mismo menú contextual
    attachLongPress(node, chat);

    const windowBadge = node.querySelector('.chat-window');

    if (windowState.latestIncoming && windowBadge) {
      windowBadge.hidden = false;
      windowBadge.dataset.timestamp = String(windowState.latestIncoming.timestamp);
      windowBadge.classList.toggle('expired', windowState.expired);
      windowBadge.textContent = windowState.expired
        ? 'Chat caducado'
        : `24h · ${formatWindowCountdown(windowState.latestIncoming.timestamp)}`;
    }

    if (chat.chatId === state.selectedChatId) {
      node.classList.add('active');
    }

    node.addEventListener('click', async (event) => {
      // Si acabamos de abrir el menú por long-press, ignoramos este click
      if (suppressNextClickFor === node) {
        suppressNextClickFor = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      state.selectedChatId = chat.chatId;
      setMobileChatOpen(true);
      render();
      await fetch(`/api/chats/${chat.chatId}/read`, { method: 'POST' });
      await refreshChats();
    });

    chatList.appendChild(node);
  }
}

function renderConversationMeta(currentChat) {
  chatMeta.innerHTML = '';

  const subtitle = document.createElement('span');
  subtitle.textContent = currentChat.subtitle;
  chatMeta.appendChild(subtitle);

  const origin = document.createElement('span');
  origin.className = 'conversation-origin';
  origin.innerHTML = buildChannelBadgeHtml(currentChat.origin);
  chatMeta.appendChild(origin);

  const windowState = getReplyWindowState(currentChat);

  if (!windowState.latestIncoming) {
    updateReplyAvailability();
    return;
  }

  updateReplyAvailability();
}

// Genera una huella ligera del estado del chat para detectar cambios reales
// entre re-renders. Si la huella no cambió → saltamos el re-render completo.
function buildMessagesFingerprint(chat) {
  const msgs = chat?.messages || [];
  if (!msgs.length) return `${chat?.chatId || ''}|0`;
  // Cantidad + último id + último timestamp + último status (cambia con
  // entregado/leído) + título (puede cambiar).
  const last = msgs[msgs.length - 1];
  return [
    chat.chatId,
    msgs.length,
    last.id || '',
    last.timestamp || 0,
    last.status || '',
    last.deliveryStatus || '',
    chat.title || '',
    chat.statusId || '',
    chat.pipelineId || ''
  ].join('|');
}

function renderMessages() {
  const currentChat = getSelectedChat();
  if (deleteChatButton) deleteChatButton.hidden = !currentChat;

  if (!currentChat) {
    messages.innerHTML = `
      <div class="empty-state">
        <h2>Tu inbox está listo</h2>
        <p>Cuando entren mensajes desde Kommo aparecerán aquí con un formato de conversación.</p>
      </div>
    `;
    chatTitle.textContent = 'Selecciona una conversación';
    chatMeta.textContent = 'Los mensajes entrantes desde Kommo aparecerán aquí.';
    updateReplyAvailability();
    return;
  }

  // OPTIMIZACIÓN: el polling llama render() cada 4s aunque no haya cambios.
  // Si la lista de mensajes es idéntica al último render, salimos sin tocar el
  // DOM — esto evita el flicker de "se sube y baja" cuando estás al fondo.
  const isChatSwitch = renderMessages._lastChatId !== currentChat.chatId;
  const fingerprint = buildMessagesFingerprint(currentChat);
  if (!isChatSwitch && renderMessages._lastFingerprint === fingerprint) {
    // Solo refrescamos meta/título y countdown del último incoming (cambia con el tiempo)
    chatTitle.textContent = currentChat.title;
    renderConversationMeta(currentChat);
    return;
  }

  // Scroll inteligente: medimos la posición ANTES de limpiar el contenido.
  // - Cambio de chat: ir al fondo (mensaje más reciente).
  // - Estaba cerca del fondo (<80px): seguir abajo aunque lleguen msgs nuevos.
  // - Estaba leyendo arriba: preservar la distancia desde el fondo (así los
  //   mensajes nuevos crecen "hacia abajo" sin moverle el viewport).
  const prevScrollHeight = messages.scrollHeight;
  const prevScrollTop = messages.scrollTop;
  const prevClientHeight = messages.clientHeight;
  const distanceFromBottom = prevScrollHeight - prevScrollTop - prevClientHeight;
  const wasNearBottom = distanceFromBottom < 80;
  renderMessages._lastChatId = currentChat.chatId;
  renderMessages._lastFingerprint = fingerprint;

  chatTitle.textContent = currentChat.title;
  renderConversationMeta(currentChat);
  messages.innerHTML = '';

  const template = document.getElementById('messageTemplate');
  const latestIncoming = getLatestIncomingMessage(currentChat);
  const orderedMessages = [...currentChat.messages].sort((left, right) => left.timestamp - right.timestamp);

  for (const item of orderedMessages) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.add(item.direction);

    const bubble = node.querySelector('.bubble');
    bubble.innerHTML = '';

    if (item.attachment?.url) {
      const isImage = String(item.attachment.type || '').startsWith('image/');
      const wrapper = document.createElement('div');
      wrapper.className = 'bubble-attachment';

      if (isImage) {
        const img = document.createElement('img');
        img.src = item.attachment.url;
        img.alt = item.attachment.name || 'Adjunto';
        img.loading = 'lazy';
        wrapper.appendChild(img);
      } else {
        const link = document.createElement('a');
        link.href = item.attachment.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = `📎 ${item.attachment.name || 'archivo'}`;
        link.className = 'bubble-attachment-link';
        wrapper.appendChild(link);
      }

      bubble.appendChild(wrapper);
    }

    const textNode = document.createElement('div');
    textNode.className = 'bubble-text';
    textNode.textContent = item.text || '';
    if (item.text) {
      bubble.appendChild(textNode);
    }

    const status = normalizeMessageStatus(item);
    const senderLabel = item.direction === 'incoming' ? 'Cliente' : 'Tú';
    const statusIconHtml = item.direction === 'outgoing' ? buildStatusIconHtml(status) : '';
    node.querySelector('.message-meta').innerHTML = `${senderLabel} · ${formatTime(item.timestamp)}${statusIconHtml ? ' ' + statusIconHtml : ''}`;

    const countdownNode = node.querySelector('.message-countdown');

    if (countdownNode && latestIncoming && item.direction === 'incoming' && item.id === latestIncoming.id) {
      countdownNode.hidden = false;
      countdownNode.dataset.timestamp = String(item.timestamp);
      countdownNode.textContent = getReplyWindowState(currentChat).expired
        ? 'Chat caducado'
        : `24h · ${formatWindowCountdown(item.timestamp)}`;
    }

    messages.appendChild(node);
  }

  if (isChatSwitch || wasNearBottom) {
    // Pegado al fondo (cambio de chat o user al final del hilo)
    messages.scrollTop = messages.scrollHeight;
  } else {
    // El user estaba leyendo arriba: mantener la MISMA distancia desde el
    // fondo. Si llegan nuevos msgs al final, no le movemos el viewport.
    messages.scrollTop = messages.scrollHeight - messages.clientHeight - distanceFromBottom;
  }
}

function renderStatus() {
  if (brandVersion && state.status?.version) {
    brandVersion.textContent = `Reelance Hub v${state.status.version}`;
  }

  if (!state.status) {
    connectionLabel.textContent = 'Cargando...';
    connectButton.hidden = false;
    return;
  }

  const lastError = state.status.lastError;

  if (state.status.connected && !lastError) {
    connectionLabel.textContent = `Conectado a ${state.status.subdomain || 'Kommo'}`;
    connectButton.hidden = true;
    return;
  }

  connectButton.hidden = false;
  connectionLabel.textContent = lastError
    ? `Desconectado: ${lastError.detail || lastError.message}`
    : 'Sin conectar';
}

function renderQuickReplies() {
  quickReplyList.innerHTML = '';
  quickReplyPickerList.innerHTML = '';

  if (!state.quickReplies.length) {
    quickReplyList.innerHTML = '<p class="muted">Todavía no hay respuestas rápidas guardadas.</p>';
    quickReplyPickerList.innerHTML = '<p class="muted">Aún no has creado respuestas rápidas.</p>';
    return;
  }

  for (const item of state.quickReplies) {
    const node = document.createElement('article');
    node.className = 'quick-reply-card';
    node.innerHTML = `
      <div>
        <strong>${item.name}</strong>
        <p>${item.text || 'Sin texto'}</p>
        ${item.attachment?.name ? `<span class="attachment-name">Adjunto: ${item.attachment.name}</span>` : ''}
      </div>
      <div class="quick-reply-card-actions">
        <button class="ghost-button" type="button" data-action="apply">Aplicar</button>
        <button class="ghost-button" type="button" data-action="edit">Editar</button>
        <button class="ghost-button danger-button" type="button" data-action="delete">Borrar</button>
      </div>
    `;

    node.querySelector('[data-action="apply"]').addEventListener('click', () => applyQuickReply(item));
    node.querySelector('[data-action="edit"]').addEventListener('click', () => startEditingQuickReply(item));

    node.querySelector('[data-action="delete"]').addEventListener('click', async () => {
      const confirmed = window.confirm(`¿Borro la respuesta rápida "${item.name}"?`);

      if (!confirmed) {
        return;
      }

      await fetch(`/api/quick-replies/${item.id}`, { method: 'DELETE' });
      await refreshQuickReplies();
    });

    quickReplyList.appendChild(node);

    const pickerNode = document.createElement('button');
    pickerNode.type = 'button';
    pickerNode.className = 'quick-reply-picker-item';
    pickerNode.innerHTML = `
      <strong>${item.name}</strong>
      <span>${item.text || 'Sin texto'}</span>
    `;
    pickerNode.addEventListener('click', () => applyQuickReply(item));
    quickReplyPickerList.appendChild(pickerNode);
  }
}

function updateCountdownDisplays() {
  const currentChat = getSelectedChat();

  if (!currentChat) {
    renderSidebar();
    return;
  }

  renderConversationMeta(currentChat);
  renderSidebar();

  const countdownNode = document.querySelector('.message-countdown[data-timestamp]');

  if (countdownNode) {
    const timestamp = Number(countdownNode.dataset.timestamp);
    const expired = getReplyWindowState(currentChat).expired;
    countdownNode.textContent = expired
      ? 'Chat caducado'
      : `24h · ${formatWindowCountdown(timestamp)}`;
  }
}

function render() {
  renderStatus();
  renderFilterPills();
  renderSidebar();
  renderMessages();
  renderQuickReplies();
  renderComposerState();
}

async function refreshStatus() {
  const previousStatus = state.status;

  try {
    const response = await fetch('/api/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.status = await response.json();
    markConnectionSuccess();
  } catch (error) {
    state.status = {
      connected: false,
      subdomain: null,
      lastError: {
        message: error.message || 'No se pudo consultar el estado local de la app.',
        detail: 'La app dejó de responder o perdió la conexión.',
        at: Date.now()
      }
    };
    markConnectionFailure(error);
  }

  renderStatus();

  if (!previousStatus || !state.initialized) {
    return;
  }

  const previousError = previousStatus.lastError?.detail || previousStatus.lastError?.message || '';
  const currentError = state.status.lastError?.detail || state.status.lastError?.message || '';

  if (previousStatus.connected && !state.status.connected) {
    pushInAppNotification('error', 'Kommo desconectado', currentError || 'La conexión con Kommo se perdió.');
    return;
  }

  if (currentError && currentError !== previousError) {
    pushInAppNotification('error', 'Error de Kommo', currentError);
  }
}

async function refreshChats() {
  const previousChats = new Map(
    state.chats.map((chat) => {
      const latestIncoming = getLatestIncomingMessage(chat);
      return [chat.chatId, latestIncoming?.id || null];
    })
  );

  let payload;
  try {
    const response = await fetch('/api/chats');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
    markConnectionSuccess();
  } catch (error) {
    markConnectionFailure(error);
    throw error; // El setInterval sigue manejando el throw como antes
  }
  state.chats = payload.chats || [];

  if (!state.selectedChatId && state.chats.length && !isMobileViewport()) {
    state.selectedChatId = state.chats[0].chatId;
  }

  if (state.selectedChatId && !state.chats.some((chat) => chat.chatId === state.selectedChatId)) {
    if (isMobileViewport()) {
      state.selectedChatId = null;
      setMobileChatOpen(false);
    } else {
      state.selectedChatId = state.chats[0]?.chatId || null;
    }
  }

  if (state.initialized) {
    for (const chat of state.chats) {
      const latestIncoming = getLatestIncomingMessage(chat);
      const previousIncomingId = previousChats.get(chat.chatId) || null;

      if (latestIncoming && latestIncoming.id !== previousIncomingId) {
        pushInAppNotification(
          'message',
          `Nuevo mensaje de ${chat.title}`,
          latestIncoming.text || 'Mensaje sin texto'
        );
      }
    }
  }

  render();
}

async function refreshQuickReplies() {
  const response = await fetch('/api/quick-replies');
  const payload = await response.json();
  state.quickReplies = payload.items || [];
  renderQuickReplies();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No pude leer el archivo seleccionado.'));
    reader.readAsDataURL(file);
  });
}

async function storeComposerAttachment(file) {
  if (!file) {
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  state.composerAttachment = {
    name: file.name,
    type: file.type || 'application/octet-stream',
    dataUrl
  };
  renderComposerState();
}

function clearComposerAttachment() {
  state.composerAttachment = null;
  renderComposerState();
}

const composerAttachmentRemoveBtn = document.getElementById('composerAttachmentRemove');
if (composerAttachmentRemoveBtn) {
  composerAttachmentRemoveBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearComposerAttachment();
  });
}

connectButton.addEventListener('click', async () => {
  const response = await fetch('/auth/kommo/url');
  const payload = await response.json();

  if (payload.url) {
    window.location.href = payload.url;
  }
});

openQuickReplyManagerButton.addEventListener('click', (event) => {
  event.stopPropagation();
  openQuickReplyManager();
});

closeQuickReplyManagerButton.addEventListener('click', (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeQuickReplyManager();
});

const quickReplyCancelEditButton = document.getElementById('quickReplyCancelEditButton');

if (quickReplyCancelEditButton) {
  quickReplyCancelEditButton.addEventListener('click', () => {
    resetQuickReplyForm();
  });
}

openQuickReplyPickerButton.addEventListener('click', () => {
  if (quickReplyPicker.hidden) {
    openQuickReplyPicker();
    return;
  }

  closeQuickReplyPicker();
});

closeQuickReplyPickerButton.addEventListener('click', () => {
  closeQuickReplyPicker();
});

composerAttachmentButton.addEventListener('click', () => {
  if (attachmentSheet.hidden) {
    openAttachmentSheet();
    return;
  }

  closeAttachmentSheet();
});

closeAttachmentSheetButton.addEventListener('click', () => {
  closeAttachmentSheet();
});

if (backToInboxButton) {
  backToInboxButton.addEventListener('click', () => {
    setMobileChatOpen(false);
  });
}

if (logoutButton) {
  logoutButton.addEventListener('click', async () => {
    try {
      await fetch('/logout', { method: 'POST' });
    } finally {
      location.href = '/login';
    }
  });
}

// ── Acción común usada por menú contextual y swipe ──
async function runChatAction(chat, action) {
  try {
    if (action === 'pin') {
      const method = chat.pinned ? 'DELETE' : 'POST';
      await fetch(`/api/chats/${chat.chatId}/pin`, { method });
    } else if (action === 'toggle-read') {
      const isUnread = Number(chat.unreadCount || 0) > 0;
      const path = isUnread ? 'read' : 'unread';
      await fetch(`/api/chats/${chat.chatId}/${path}`, { method: 'POST' });
    } else if (action === 'delete') {
      const confirmed = window.confirm(`¿Borrar el chat "${chat.title}" solo de Reelance Hub? Esto no toca Kommo.`);
      if (!confirmed) return;
      await fetch(`/api/chats/${chat.chatId}`, { method: 'DELETE' });
      if (state.selectedChatId === chat.chatId) {
        state.selectedChatId = null;
        setMobileChatOpen(false);
      }
    }
  } finally {
    await refreshChats();
  }
}

// ── Long-press en móvil → mismo menú contextual que click derecho ──
function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches;
}

const LONG_PRESS_MS = 500;
const MOVEMENT_TOLERANCE = 10;
let suppressNextClickFor = null;

function attachLongPress(item, chat) {
  if (!isTouchDevice() || !item) return;

  let timer = null;
  let startX = 0, startY = 0;
  let cancelled = false;

  item.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    cancelled = false;

    timer = setTimeout(() => {
      if (cancelled) return;
      if (navigator.vibrate) navigator.vibrate(15);
      suppressNextClickFor = item;
      openChatContextMenu(chat, startX, startY);
    }, LONG_PRESS_MS);
  }, { passive: true });

  item.addEventListener('touchmove', (event) => {
    if (cancelled) return;
    const t = event.touches[0];
    if (Math.abs(t.clientX - startX) > MOVEMENT_TOLERANCE ||
        Math.abs(t.clientY - startY) > MOVEMENT_TOLERANCE) {
      cancelled = true;
      clearTimeout(timer);
    }
  }, { passive: true });

  item.addEventListener('touchend', () => {
    cancelled = true;
    clearTimeout(timer);
  });

  item.addEventListener('touchcancel', () => {
    cancelled = true;
    clearTimeout(timer);
  });
}

function closeAllSwipes() { /* legacy noop */ }

// ── Menú contextual de chat (click derecho) ──
let contextMenuChat = null;

function openChatContextMenu(chat, x, y) {
  if (!chatContextMenu) return;
  contextMenuChat = chat;

  // Update labels based on current state
  const pinLabel = chatContextMenu.querySelector('[data-label="pin"]');
  if (pinLabel) {
    pinLabel.textContent = chat.pinned ? 'Quitar fijado' : 'Fijar arriba';
  }

  const readLabel = chatContextMenu.querySelector('[data-label="toggle-read"]');
  if (readLabel) {
    const isUnread = Number(chat.unreadCount || 0) > 0;
    readLabel.textContent = isUnread ? 'Marcar como leído' : 'Marcar como no leído';
  }

  // Position menu, keeping it inside viewport
  chatContextMenu.hidden = false;
  const rect = chatContextMenu.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 8;
  const maxY = window.innerHeight - rect.height - 8;
  chatContextMenu.style.left = `${Math.min(x, maxX)}px`;
  chatContextMenu.style.top = `${Math.min(y, maxY)}px`;
}

function closeChatContextMenu() {
  if (chatContextMenu) {
    chatContextMenu.hidden = true;
  }
  contextMenuChat = null;
}

if (chatContextMenu) {
  chatContextMenu.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-action]');
    if (!btn || !contextMenuChat) return;

    const action = btn.dataset.action;
    const chat = contextMenuChat;
    closeChatContextMenu();
    await runChatAction(chat, action);
  });
}

// Close context menu on outside click / scroll / Escape
document.addEventListener('click', (event) => {
  if (chatContextMenu && !chatContextMenu.hidden && !chatContextMenu.contains(event.target)) {
    closeChatContextMenu();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeChatContextMenu();
  }
});

window.addEventListener('scroll', closeChatContextMenu, true);
window.addEventListener('resize', closeChatContextMenu);

if (deleteChatButton) {
  deleteChatButton.addEventListener('click', async () => {
    const currentChat = getSelectedChat();
    if (!currentChat) return;
    const confirmed = window.confirm(`¿Borro el chat "${currentChat.title}" solo de Reelance Hub? Esto no toca Kommo.`);
    if (!confirmed) return;
    await fetch(`/api/chats/${currentChat.chatId}`, { method: 'DELETE' });
    state.selectedChatId = null;
    setMobileChatOpen(false);
    await refreshChats();
  });
}

searchInput.addEventListener('input', (event) => {
  state.filter = event.target.value || '';
  renderSidebar();
});

quickReplyAttachment.addEventListener('change', (event) => {
  const file = event.target.files?.[0] || null;

  if (file) {
    quickReplyAttachmentName.textContent = file.name;
    state.editingQuickReplyAttachment = null;
  } else if (state.editingQuickReplyAttachment?.name) {
    quickReplyAttachmentName.textContent = `Adjunto actual: ${state.editingQuickReplyAttachment.name}`;
  } else {
    quickReplyAttachmentName.textContent = '';
  }
});

cameraAttachmentInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0] || null;
  await storeComposerAttachment(file);
  closeAttachmentSheet();
  cameraAttachmentInput.value = '';
});

libraryAttachmentInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0] || null;
  await storeComposerAttachment(file);
  closeAttachmentSheet();
  libraryAttachmentInput.value = '';
});

fileAttachmentInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0] || null;
  await storeComposerAttachment(file);
  closeAttachmentSheet();
  fileAttachmentInput.value = '';
});

quickReplyForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (state.quickReplySubmitting) {
    return;
  }

  const submitBtn = quickReplyForm.querySelector('button[type="submit"]');
  const name = quickReplyName.value.trim();
  const text = quickReplyText.value;
  const file = quickReplyAttachment.files?.[0] || null;

  if (!name) {
    window.alert('La respuesta rápida necesita un nombre.');
    return;
  }

  let attachment = state.editingQuickReplyAttachment || null;

  if (file) {
    const dataUrl = await readFileAsDataUrl(file);
    attachment = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      dataUrl
    };
  }

  const payload = { name, text, attachment };

  if (state.editingQuickReplyId) {
    payload.id = state.editingQuickReplyId;
  }

  state.quickReplySubmitting = true;

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalLabel = submitBtn.textContent;
    submitBtn.textContent = state.editingQuickReplyId ? 'Actualizando…' : 'Guardando…';
  }

  try {
    const response = await fetch('/api/quick-replies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errPayload = await response.json().catch(() => ({ error: 'No pude guardar la respuesta rápida.' }));
      window.alert(errPayload.error || 'No pude guardar la respuesta rápida.');
      return;
    }

    closeQuickReplyManager();
    await refreshQuickReplies();
  } finally {
    state.quickReplySubmitting = false;

    if (submitBtn) {
      submitBtn.disabled = false;
      const originalLabel = submitBtn.dataset.originalLabel;

      if (originalLabel) {
        submitBtn.textContent = originalLabel;
        delete submitBtn.dataset.originalLabel;
      }
    }
  }
});

replyInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return;
  }

  const isDesktop = window.matchMedia('(pointer: fine)').matches;

  if (!isDesktop) {
    return;
  }

  event.preventDefault();

  if (sendButton.disabled) {
    return;
  }

  if (typeof replyForm.requestSubmit === 'function') {
    replyForm.requestSubmit();
  } else {
    replyForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
});

replyForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const currentChat = getSelectedChat();
  const text = replyInput.value.trim();
  const attachment = state.composerAttachment;

  if (!currentChat) {
    return;
  }

  if (!text && !attachment) {
    return;
  }

  const windowState = getReplyWindowState(currentChat);

  if (windowState.latestIncoming && windowState.expired) {
    window.alert('No puedes enviar porque el chat caducó: la ventana de 24 horas ya terminó.');
    return;
  }

  sendButton.disabled = true;

  try {
    const response = await fetch(`/api/chats/${currentChat.chatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, attachment })
    });

    if (!response.ok) {
      const rawBody = await response.text();
      let payload = null;

      try {
        payload = rawBody ? JSON.parse(rawBody) : null;
      } catch (error) {
        payload = null;
      }

      window.alert(formatErrorDetails(payload || { error: rawBody || 'No se pudo enviar.' }));
      return;
    }

    replyInput.value = '';
    state.composerAttachment = null;
    renderComposerState();
    closeQuickReplyPicker();
    closeAttachmentSheet();
    await refreshChats();
  } catch (error) {
    window.alert(`No se pudo enviar.\n\nDetalle: ${error.message || 'Error de red o de conexión con la app.'}`);
  } finally {
    updateReplyAvailability();
  }
});

// ── PWA + Push notifications ──────────────────────────────────────
const enablePushButton = document.getElementById('enablePushButton');

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('SW registration failed:', err);
    return null;
  }
}

function pushSupported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

async function getActiveSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function updatePushButtonVisibility() {
  if (!enablePushButton) return;

  if (!pushSupported()) {
    enablePushButton.hidden = true;
    return;
  }

  // En iOS, web push solo funciona si la app está instalada (PWA standalone).
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (isIOS && !isStandalone()) {
    enablePushButton.hidden = false;
    enablePushButton.textContent = '🔔 Agregar a inicio para activar';
    enablePushButton.title = 'En iOS, comparte → "Añadir a pantalla de inicio" para activar las notificaciones.';
    return;
  }

  if (Notification.permission === 'denied') {
    enablePushButton.hidden = false;
    enablePushButton.textContent = '🔕 Notificaciones bloqueadas';
    enablePushButton.disabled = true;
    return;
  }

  const sub = await getActiveSubscription();
  if (sub) {
    enablePushButton.hidden = true;
    return;
  }

  enablePushButton.hidden = false;
  enablePushButton.disabled = false;
  enablePushButton.textContent = '🔔 Activar notificaciones';
}

async function subscribeToPush() {
  if (!pushSupported()) {
    window.alert('Tu navegador no soporta notificaciones push.');
    return;
  }

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (isIOS && !isStandalone()) {
    window.alert('En iOS, primero instala la app: comparte → "Añadir a pantalla de inicio". Luego abre la app instalada y vuelve a tocar este botón.');
    return;
  }

  enablePushButton.disabled = true;
  enablePushButton.textContent = 'Conectando…';

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      pushInAppNotification('error', 'Permiso denegado', 'No se concedió permiso para notificaciones.');
      return;
    }

    const reg = await navigator.serviceWorker.ready;

    const keyResp = await fetch('/api/push/vapid-public-key');
    const { publicKey } = await keyResp.json();
    if (!publicKey) {
      window.alert('El servidor no tiene VAPID configurado.');
      return;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
    }

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });

    pushInAppNotification('message', 'Notificaciones activadas', 'Recibirás un push por cada mensaje nuevo.');
  } catch (err) {
    console.error('subscribeToPush error:', err);
    window.alert(`No se pudo activar las notificaciones: ${err.message || err}`);
  } finally {
    await updatePushButtonVisibility();
  }
}

if (enablePushButton) {
  enablePushButton.addEventListener('click', subscribeToPush);
}

async function boot() {
  try {
    closeQuickReplyManager();
    closeQuickReplyPicker();
    closeAttachmentSheet();
    requestNotificationPermission();

    try {
      await registerServiceWorker();
    } catch (err) {
      console.warn('SW register failed (no bloqueante):', err);
    }

    try {
      await updatePushButtonVisibility();
    } catch (err) {
      console.warn('Push button update failed (no bloqueante):', err);
    }

    // Cargar status, chats y quick replies de forma independiente para que
    // si uno falla los otros sigan funcionando.
    await Promise.allSettled([refreshStatus(), refreshChats(), refreshQuickReplies()]);

    state.initialized = true;
    setInterval(() => { refreshChats().catch((e) => console.error('refreshChats interval:', e)); }, 4000);
    setInterval(() => { refreshStatus().catch((e) => console.error('refreshStatus interval:', e)); }, 12000);
    setInterval(updateCountdownDisplays, 1000);

    // Watchdog: si el dispositivo pierde wifi/datos el navegador dispara
    // 'offline'. Adelantamos el aviso al usuario sin esperar a 3 fallos.
    window.addEventListener('offline', () => {
      connectionState.consecutiveFailures = CONNECTION_FAIL_THRESHOLD; // forzar offline
      if (!connectionState.isOffline) {
        connectionState.isOffline = true;
        setConnectionBanner('offline', 'Sin internet — esperando red…');
        pushInAppNotification('error', 'Sin conexión a internet', 'Tu dispositivo perdió la red.');
        maybeFireSystemNotification('Reelance Hub sin internet', 'Tu dispositivo perdió la conexión a internet.');
      }
    });

    window.addEventListener('online', () => {
      // Forzamos un refresh inmediato para detectar éxito y limpiar el banner
      refreshStatus().catch(() => {});
      refreshChats().catch(() => {});
    });

    // Botón "Reintentar" en el banner: forza re-poll inmediato
    if (connectionBannerRetry) {
      connectionBannerRetry.addEventListener('click', () => {
        connectionBannerText.textContent = 'Reintentando…';
        Promise.allSettled([refreshStatus(), refreshChats()]);
      });
    }
  } catch (err) {
    console.error('Boot error:', err);
    // No dejar el indicador en "Cargando" para siempre
    if (connectionLabel) {
      connectionLabel.textContent = `Error: ${err.message || err}`;
    }
  }
}

quickReplyManagerModal.addEventListener('click', (event) => {
  if (event.target === quickReplyManagerModal) {
    closeQuickReplyManager();
  }
});

const quickReplyManagerCard = quickReplyManagerModal.querySelector('.overlay-card');

if (quickReplyManagerCard) {
  quickReplyManagerCard.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

document.addEventListener('click', (event) => {
  if (!quickReplyPicker.hidden && !quickReplyPicker.contains(event.target) && event.target !== openQuickReplyPickerButton) {
    closeQuickReplyPicker();
  }

  if (!attachmentSheet.hidden && !attachmentSheet.contains(event.target) && event.target !== composerAttachmentButton) {
    closeAttachmentSheet();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }

  closeQuickReplyManager();
  closeQuickReplyPicker();
  closeAttachmentSheet();
});

boot();
