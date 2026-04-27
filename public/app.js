const state = {
  chats: [],
  selectedChatId: null,
  filter: '',
  status: null,
  quickReplies: [],
  notifications: [],
  composerAttachment: null,
  initialized: false
};

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
const deleteChatButton = document.getElementById('deleteChatButton');
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
const composerAttachmentHint = document.getElementById('composerAttachmentHint');
const appNotifications = document.getElementById('appNotifications');

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
  return new Date(timestamp).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit'
  });
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

function getReplyWindowState(chat) {
  const latestIncoming = getLatestIncomingMessage(chat);

  if (!latestIncoming) {
    return {
      latestIncoming: null,
      expired: false,
      remaining: null
    };
  }

  const deadline = Number(latestIncoming.timestamp) + (24 * 60 * 60 * 1000);
  const remaining = deadline - Date.now();

  return {
    latestIncoming,
    expired: remaining <= 0,
    remaining
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
  showBrowserNotification(title, body);

  setTimeout(() => {
    state.notifications = state.notifications.filter((entry) => entry.id !== item.id);
    renderNotifications();
  }, 6000);
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
  if (!state.composerAttachment) {
    composerAttachmentHint.hidden = true;
    composerAttachmentHint.textContent = '';
    return;
  }

  composerAttachmentHint.hidden = false;
  composerAttachmentHint.textContent = `Adjunto preparado: ${state.composerAttachment.name || 'archivo'}.`;
}

function openQuickReplyManager() {
  quickReplyManagerModal.hidden = false;
  quickReplyManagerModal.removeAttribute('hidden');
}

function closeQuickReplyManager() {
  quickReplyManagerModal.hidden = true;
  quickReplyManagerModal.setAttribute('hidden', '');
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

function renderSidebar() {
  const template = document.getElementById('chatItemTemplate');
  chatList.innerHTML = '';

  const visibleChats = state.chats.filter((chat) => {
    const haystack = `${chat.title} ${chat.subtitle}`.toLowerCase();
    return haystack.includes(state.filter.toLowerCase());
  });

  if (!visibleChats.length) {
    chatList.innerHTML = '<p class="muted" style="padding: 12px 14px;">Todavía no hay conversaciones sincronizadas.</p>';
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
    node.querySelector('.chat-origin').textContent = chat.origin || 'sin canal';

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

    node.addEventListener('click', async () => {
      state.selectedChatId = chat.chatId;
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
  origin.textContent = currentChat.origin || 'sin canal';
  chatMeta.appendChild(origin);

  const windowState = getReplyWindowState(currentChat);

  if (!windowState.latestIncoming) {
    updateReplyAvailability();
    return;
  }

  updateReplyAvailability();
}

function renderMessages() {
  const currentChat = getSelectedChat();
  deleteChatButton.hidden = !currentChat;

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

  chatTitle.textContent = currentChat.title;
  renderConversationMeta(currentChat);
  messages.innerHTML = '';

  const template = document.getElementById('messageTemplate');
  const latestIncoming = getLatestIncomingMessage(currentChat);
  const orderedMessages = [...currentChat.messages].sort((left, right) => right.timestamp - left.timestamp);

  for (const item of orderedMessages) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.classList.add(item.direction);
    node.querySelector('.bubble').textContent = item.text;
    node.querySelector('.message-meta').textContent = `${item.direction === 'incoming' ? 'Cliente' : 'Tú'} · ${formatTime(item.timestamp)} · ${item.deliveryStatus || 'ok'}`;

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

  messages.scrollTop = 0;
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
        <button class="ghost-button danger-button" type="button" data-action="delete">Borrar</button>
      </div>
    `;

    node.querySelector('[data-action="apply"]').addEventListener('click', () => applyQuickReply(item));

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
  renderSidebar();
  renderMessages();
  renderQuickReplies();
  renderComposerState();
}

async function refreshStatus() {
  const previousStatus = state.status;

  try {
    const response = await fetch('/api/status');
    state.status = await response.json();
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

  const response = await fetch('/api/chats');
  const payload = await response.json();
  state.chats = payload.chats || [];

  if (!state.selectedChatId && state.chats.length) {
    state.selectedChatId = state.chats[0].chatId;
  }

  if (state.selectedChatId && !state.chats.some((chat) => chat.chatId === state.selectedChatId)) {
    state.selectedChatId = state.chats[0]?.chatId || null;
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

deleteChatButton.addEventListener('click', async () => {
  const currentChat = getSelectedChat();

  if (!currentChat) {
    return;
  }

  const confirmed = window.confirm(`¿Borro el chat "${currentChat.title}" solo de Reelance Hub? Esto no toca Kommo.`);

  if (!confirmed) {
    return;
  }

  await fetch(`/api/chats/${currentChat.chatId}`, { method: 'DELETE' });
  state.selectedChatId = null;
  await refreshChats();
});

searchInput.addEventListener('input', (event) => {
  state.filter = event.target.value || '';
  renderSidebar();
});

quickReplyAttachment.addEventListener('change', (event) => {
  const file = event.target.files?.[0] || null;
  quickReplyAttachmentName.textContent = file ? file.name : '';
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

  const name = quickReplyName.value.trim();
  const text = quickReplyText.value;
  const file = quickReplyAttachment.files?.[0] || null;

  if (!name) {
    window.alert('La respuesta rápida necesita un nombre.');
    return;
  }

  let attachment = null;

  if (file) {
    const dataUrl = await readFileAsDataUrl(file);
    attachment = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      dataUrl
    };
  }

  const response = await fetch('/api/quick-replies', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name,
      text,
      attachment
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'No pude guardar la respuesta rápida.' }));
    window.alert(payload.error || 'No pude guardar la respuesta rápida.');
    return;
  }

  quickReplyForm.reset();
  quickReplyAttachmentName.textContent = '';
  closeQuickReplyManager();
  await refreshQuickReplies();
});

replyForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const currentChat = getSelectedChat();
  const text = replyInput.value.trim();

  if (!currentChat || !text) {
    return;
  }

  if (state.composerAttachment) {
    window.alert('Ya puedes seleccionar adjuntos desde el boton +, pero el envio real de imagenes/documentos por Kommo todavia no esta conectado en este flujo. Quita el adjunto o termina esa integracion antes de enviar.');
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
      body: JSON.stringify({ text })
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

async function boot() {
  closeQuickReplyManager();
  closeQuickReplyPicker();
  closeAttachmentSheet();
  requestNotificationPermission();
  await Promise.all([refreshStatus(), refreshChats(), refreshQuickReplies()]);
  state.initialized = true;
  setInterval(refreshChats, 4000);
  setInterval(refreshStatus, 12000);
  setInterval(updateCountdownDisplays, 1000);
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
