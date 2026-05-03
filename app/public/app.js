// ═══════ Helpers ═══════
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ─── Auth helpers ───
function getToken() { return localStorage.getItem('rh_token') || ''; }
function getAdvisor() {
  try { return JSON.parse(localStorage.getItem('rh_advisor') || 'null'); } catch { return null; }
}
function logout() {
  const token = getToken();
  if (token) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  localStorage.removeItem('rh_token');
  localStorage.removeItem('rh_advisor');
  window.location.href = '/login.html';
}

// ═══════ Estado de conexión global ═══════
const connState = {
  fails: 0,
  isOffline: false,
  banner: null,
  recoveryTimer: null,
};
const CONN_FAIL_THRESHOLD = 3;     // 3 fallos seguidos → marcamos offline
const CONN_RECOVERY_BANNER_MS = 4000;

function setConnBanner(kind, text) {
  const el = document.getElementById("connBanner");
  if (!el) return;
  if (!kind) { el.hidden = true; el.className = "conn-banner"; return; }
  el.className = `conn-banner is-${kind}`;
  el.textContent = text;
  el.hidden = false;
}

function markConnFailure() {
  connState.fails++;
  if (!connState.isOffline && connState.fails >= CONN_FAIL_THRESHOLD) {
    connState.isOffline = true;
    if (connState.recoveryTimer) { clearTimeout(connState.recoveryTimer); connState.recoveryTimer = null; }
    setConnBanner("offline", "Sin conexión con el servidor — reintentando…");
  } else if (!connState.isOffline) {
    setConnBanner("degraded", "Conexión inestable — verificando…");
  }
}

function markConnSuccess() {
  const wasOffline = connState.isOffline;
  connState.fails = 0;
  connState.isOffline = false;
  if (wasOffline) {
    setConnBanner("recovered", "Conexión restaurada ✓");
    if (connState.recoveryTimer) clearTimeout(connState.recoveryTimer);
    connState.recoveryTimer = setTimeout(() => setConnBanner(null), CONN_RECOVERY_BANNER_MS);
  } else if (connState.fails === 0) {
    setConnBanner(null);
  }
}

async function api(method, url, body) {
  const opts = { method, headers: { Authorization: `Bearer ${getToken()}` } };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    // Fallo de red (sin respuesta)
    markConnFailure();
    throw err;
  }
  if (res.status >= 500 && res.status !== 503) markConnFailure();
  else markConnSuccess();
  if (res.status === 401) { logout(); return; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ═══════ Toast system ═══════
function toast(message, kind = "info", duration = 3500) {
  const root = document.getElementById("toastContainer");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  const icon = kind === "success" ? "✓" : kind === "error" ? "✕" : "i";
  el.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Cerrar">×</button>
  `;
  const remove = () => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector(".toast-close").addEventListener("click", remove);
  root.appendChild(el);
  if (duration > 0) setTimeout(remove, duration);
}

// ═══════ Chats — conectado al backend ═══════
let CONVERSATIONS = [];
let ACTIVE_CONVO_ID = null;
let CHAT_MESSAGES = [];
let CHAT_FILTER_PROVIDER = '';
let CHAT_FILTER_UNREAD = false;
let CHAT_SEARCH = '';
let _chatPollTimer = null;

const PROVIDER_LABEL = { whatsapp: 'WhatsApp Business API', 'whatsapp-lite': 'WhatsApp Lite', messenger: 'Messenger', instagram: 'Instagram', telegram: 'Telegram', tiktok: 'TikTok' };

// Formatea timestamp para pie de burbuja: si es hoy → "14:32", si no → "15 abr · 14:32"
function fmtMsgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  return `${date} · ${time}`;
}

// Returns 24h countdown pill HTML — inline inside the badges row
function wa24Html(provider, lastIncomingAt) {
  if (provider !== 'whatsapp' || !lastIncomingAt) return '';
  const deadlineMs = lastIncomingAt * 1000 + 24 * 60 * 60 * 1000;
  const diffMs = deadlineMs - Date.now();
  if (diffMs <= 0) return '';
  const h  = Math.floor(diffMs / 3_600_000);
  const m  = Math.floor((diffMs % 3_600_000) / 60_000);
  const s  = Math.floor((diffMs % 60_000) / 1_000);
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `<span class="rh-wa24-pill" data-deadline="${deadlineMs}">24h · ${hh}:${mm}:${ss}</span>`;
}

// Ticker global — actualiza todos los pills visibles cada segundo
setInterval(() => {
  document.querySelectorAll('.rh-wa24-pill[data-deadline]').forEach(el => {
    const deadlineMs = Number(el.dataset.deadline);
    const diffMs = deadlineMs - Date.now();
    if (diffMs <= 0) { el.remove(); return; }
    const h  = Math.floor(diffMs / 3_600_000);
    const m  = Math.floor((diffMs % 3_600_000) / 60_000);
    const s  = Math.floor((diffMs % 60_000) / 1_000);
    el.textContent = `24h · ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  });
}, 1000);

async function loadConversations() {
  try {
    let data;
    if (window.PERSONAL_MODE) {
      // /chat — vista personal del asesor, con hides propios
      const params = new URLSearchParams();
      if (window.PERSONAL_SHOW_HIDDEN) params.set('showHidden', '1');
      params.set('limit', '200');
      data = await api('GET', `/api/personal-chat/conversations?${params}`);
      // El endpoint personal devuelve campos planos — normalizar a la forma esperada por renderChatList
      data.items = (data.items || []).map(r => ({
        id: r.id,
        provider: r.provider,
        externalId: r.external_id,
        contactId: r.contact_id,
        contactName: [r.contact_first_name, r.contact_last_name].filter(Boolean).join(' ').trim() || null,
        name: [r.contact_first_name, r.contact_last_name].filter(Boolean).join(' ').trim() || r.contact_phone || '—',
        contactPhone: r.contact_phone,
        phone: r.contact_phone || '',
        lastMessage: r.last_message,
        lastMessageAt: r.last_message_at,
        lastIncomingAt: r.last_incoming_at,  // ← para el badge 24h de WhatsApp Business API
        time: r.last_message_at ? new Date(r.last_message_at * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '',
        unreadCount: r.unread_count || 0,
        botPaused: !!r.bot_paused,
        _personalHidden: !!r.hidden_at,
      }));
    } else {
      const params = new URLSearchParams();
      if (CHAT_SEARCH) params.set('q', CHAT_SEARCH);
      if (CHAT_FILTER_PROVIDER) params.set('provider', CHAT_FILTER_PROVIDER);
      if (CHAT_FILTER_UNREAD) params.set('unread', '1');
      data = await api('GET', `/api/conversations?${params}`);
    }
    CONVERSATIONS = data.items || [];
    renderChatList();
    // Actualizar badges de los filtros
    const elAll    = document.getElementById('pillCountAll');
    const elUnread = document.getElementById('pillCountUnread');
    if (elAll)    elAll.textContent    = data.totalAll    ?? '';
    if (elUnread) elUnread.textContent = data.totalUnread || '';
    if (elUnread) elUnread.style.display = data.totalUnread ? '' : 'none';
  } catch (err) {
    console.error('loadConversations', err);
  }
}

function decrementUnreadBadge(convoId) {
  const convo = CONVERSATIONS.find(c => c.id === convoId);
  if (!convo || !convo.unreadCount) return;
  convo.unreadCount = 0;
  const el = document.getElementById('pillCountUnread');
  if (!el) return;
  const cur = parseInt(el.textContent) || 0;
  const next = Math.max(0, cur - 1);
  el.textContent = next || '';
  el.style.display = next ? '' : 'none';
}

async function loadMessages(convoId) {
  try {
    const data = await api('GET', `/api/conversations/${convoId}/messages`);
    CHAT_MESSAGES = data.items || [];
    renderMessages();
  } catch (err) {
    console.error('loadMessages', err);
  }
}

function renderChatList() {
  const root = document.getElementById("rhChatList");
  if (!root) return;

  if (!CONVERSATIONS.length) {
    root.innerHTML = '<p class="rh-chat-empty">No hay conversaciones aún.<br>Los mensajes entrantes aparecerán aquí.</p>';
    return;
  }

  root.innerHTML = CONVERSATIONS.map((c) => {
    const personalAction = window.PERSONAL_MODE
      ? (c._personalHidden
          ? `<button class="rh-chat-hide-btn rh-chat-hide-btn--unhide" data-personal-action="unhide" data-id="${c.id}" title="Desocultar">↩</button>`
          : `<button class="rh-chat-hide-btn" data-personal-action="hide" data-id="${c.id}" title="Ocultar (solo de tu vista)">×</button>`)
      : '';
    return `
    <div role="button" tabindex="0" class="rh-chat-item ${c.id === ACTIVE_CONVO_ID ? "rh-active" : ""}" data-id="${c.id}">
      ${personalAction}
      <div class="rh-chat-item-top">
        <strong class="rh-chat-name">${escapeHtml(c.name || c.contactName || '—')}</strong>
        <span class="rh-chat-time">${escapeHtml(c.time || '')}</span>
      </div>
      <p class="rh-chat-phone">${escapeHtml(c.phone || c.contactPhone || '')}</p>
      <p class="rh-chat-preview">${escapeHtml(c.lastMessage || '')}</p>
      <div class="rh-chat-badges">
        <span class="rh-chat-origin">
          <span class="rh-channel-badge">
            <span class="rh-channel-dot rh-channel-${c.provider}"></span>
            ${escapeHtml(PROVIDER_LABEL[c.provider] || c.provider)}
          </span>
        </span>
        ${wa24Html(c.provider, c.lastIncomingAt)}
        ${c.unreadCount ? `<span class="rh-chat-unread-dot"></span>` : ""}
      </div>
    </div>
  `;
  }).join("");

  root.querySelectorAll(".rh-chat-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Si clic fue en el botón de hide/unhide del modo personal, no abrir conversación
      const action = e.target.closest('[data-personal-action]');
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        const id = Number(action.dataset.id);
        const kind = action.dataset.personalAction;
        handlePersonalChatAction(id, kind);
        return;
      }
      openConversation(Number(el.dataset.id));
    });
  });
}

async function handlePersonalChatAction(convoId, kind) {
  try {
    if (kind === 'hide') {
      await api('POST', `/api/personal-chat/conversations/${convoId}/hide`);
      toast('Chat ocultado de tu vista', 'success');
    } else if (kind === 'unhide') {
      await api('POST', `/api/personal-chat/conversations/${convoId}/unhide`);
      toast('Chat desocultado', 'success');
    }
    await loadConversations();
  } catch (err) {
    toast(err.message || 'Error', 'error');
  }
}

async function openConversation(convoId) {
  ACTIVE_CONVO_ID = convoId;
  const convo = CONVERSATIONS.find((c) => c.id === convoId);

  // Marcar activa en la lista
  document.querySelectorAll(".rh-chat-item").forEach((x) => {
    x.classList.toggle("rh-active", Number(x.dataset.id) === convoId);
  });

  // Actualizar header
  if (convo) {
    const titleEl = document.getElementById("rhChatTitle");
    if (titleEl) titleEl.textContent = convo.name;
    const metaEl = document.querySelector(".rh-conversation-meta");
    if (metaEl) {
      metaEl.innerHTML = `
        <span>${escapeHtml(convo.phone)}</span>
        <span class="rh-conversation-origin">
          <span class="rh-channel-badge">
            <span class="rh-channel-dot rh-channel-${convo.provider}"></span>
            ${escapeHtml(PROVIDER_LABEL[convo.provider] || convo.provider)}
          </span>
        </span>
      `;
    }
    openChatContact({ id: convo.contactId, botPaused: convo.botPaused, convoId });
  }

  // Marcar leída + cargar mensajes
  api('PATCH', `/api/conversations/${convoId}/read`).then(() => decrementUnreadBadge(convoId)).catch(() => {});
  await loadMessages(convoId);

  // Habilitar form de respuesta
  const form = document.querySelector('.rh-reply-form');
  if (form) form.dataset.convoId = convoId;
}

// ── Bot toggle in chat header ──
let _chatContactId = null;
let _chatBotPaused = false;
let _chatConvoId   = null;

function openChatContact({ id, botPaused, convoId }) {
  _chatContactId = id;
  _chatBotPaused = !!botPaused;
  _chatConvoId   = convoId || null;
  updateBotToggleUI();
}

function updateBotToggleUI() {
  const btn = document.getElementById('rhBotToggle');
  if (!btn) return;
  btn.hidden = false;
  btn.classList.toggle('is-paused', _chatBotPaused);
  btn.querySelector('.rh-bot-toggle-label').textContent = _chatBotPaused ? 'Bot pausado' : 'Bot activo';
  btn.title = _chatBotPaused ? 'Reanudar bot para este contacto' : 'Parar bot para este contacto';
}

function renderMessages() {
  const root = document.getElementById("rhMessages");
  if (!root) return;
  const checkSvg = `<span class="rh-msg-status rh-read"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/><polyline points="23 11 16 18 13 15" style="opacity:.7"/></svg></span>`;

  if (!CHAT_MESSAGES.length) {
    root.innerHTML = '<p class="rh-messages-empty">No hay mensajes todavía.</p>';
    return;
  }

  const activeConvo = CONVERSATIONS.find(c => c.id === ACTIVE_CONVO_ID);
  const isWhatsapp = activeConvo?.provider === 'whatsapp';
  const lastIncomingIdx = CHAT_MESSAGES.reduce((acc, m, i) => m.direction === 'incoming' ? i : acc, -1);

  root.innerHTML = CHAT_MESSAGES.map((m, idx) => {
    const dir = m.direction === 'incoming' ? 'incoming' : 'outgoing';
    const isLastIncoming = dir === 'incoming' && idx === lastIncomingIdx;
    const footExtra = isLastIncoming && isWhatsapp ? wa24Html('whatsapp', m.createdAt) : '';
    const footContent = dir === 'incoming'
      ? `Contacto · <span class="rh-message-meta">${fmtMsgTime(m.createdAt)}</span>${footExtra}`
      : `<span class="rh-message-meta">${fmtMsgTime(m.createdAt)}${m.status === 'read' ? ' ' + checkSvg : ''}</span>`;
    return `
      <article class="rh-message rh-${dir}">
        <div class="rh-bubble">${escapeHtml(m.body).replace(/\n/g, "<br/>")}</div>
        <div class="rh-message-foot${dir === 'outgoing' ? ' rh-foot-out' : ''}">${footContent}</div>
      </article>`;
  }).join("");
  root.scrollTop = root.scrollHeight;
}

// ═══════ Contactos (conectado al backend) ═══════
const TAG_COLORS = ["amber", "green", "purple", "blue"];
let CUSTOMERS = [];
let PIPELINES = [];
let CURRENT_TAGS = [];
let CUSTOMER_FILTER = "";
let CUSTOMER_PAGE = 1;
let CUSTOMER_PAGE_SIZE = 50;
let CUSTOMER_TOTAL = 0;
let CUSTOMER_TOTAL_PAGES = 1;
let CUSTOMER_SORT_BY = "createdAt";
let CUSTOMER_SORT_DIR = "desc";
let editingCustomerId = null;
let EDIT_EXPEDIENTS = [];          // estado mutable de expedientes en el modal
let ORIGINAL_EXPEDIENTS = [];      // snapshot para diff al guardar
let EDIT_EXP_TMP = 0;              // contador para IDs temporales de expedientes nuevos

function getInitials(c) {
  return ((c.firstName?.[0] || "") + (c.lastName?.[0] || "")).toUpperCase() || "?";
}
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

// Color del stage según su kind
function stageColor(exp) {
  if (exp.stageKind === "won") return "#10b981";
  if (exp.stageKind === "lost") return "#ef4444";
  return "#3b82f6";
}

function renderExpedientChips(expedients) {
  if (!expedients || !expedients.length) return '<span class="exp-chip-empty">—</span>';
  return expedients.map((e) => `
    <span class="exp-chip" title="${escapeHtml(e.name || "")} · $${e.value || 0}">
      <span class="exp-chip-dot" style="background:${stageColor(e)}"></span>
      <span class="exp-chip-pipeline">${escapeHtml(e.pipelineName)} ·</span>
      <span class="exp-chip-stage">${escapeHtml(e.stageName)}</span>
    </span>
  `).join("");
}

async function loadCustomers() {
  try {
    const params = new URLSearchParams();
    if (CUSTOMER_FILTER) params.set("q", CUSTOMER_FILTER);
    params.set("page", CUSTOMER_PAGE);
    params.set("pageSize", CUSTOMER_PAGE_SIZE);
    params.set("sortBy", CUSTOMER_SORT_BY);
    params.set("sortDir", CUSTOMER_SORT_DIR);
    const data = await api("GET", `/api/contacts?${params}`);
    CUSTOMERS = data.items;
    CUSTOMER_TOTAL = data.total;
    CUSTOMER_TOTAL_PAGES = data.totalPages;
    if (CUSTOMER_PAGE > CUSTOMER_TOTAL_PAGES) {
      CUSTOMER_PAGE = CUSTOMER_TOTAL_PAGES;
      return loadCustomers();
    }
    renderCustomers();
    renderPaginator();
    renderSortHeaders();
  } catch (err) {
    toast(`Error cargando contactos: ${err.message}`, "error");
  }
}

// ─── Sort dropdown ───
function updateSortLabel() {
  const active = document.querySelector(`.sort-option[data-sort-by="${CUSTOMER_SORT_BY}"][data-sort-dir="${CUSTOMER_SORT_DIR}"]`);
  const label = document.getElementById("sortLabel");
  if (active && label) label.textContent = active.dataset.label;
  document.querySelectorAll(".sort-option").forEach((opt) => {
    opt.classList.toggle("is-active",
      opt.dataset.sortBy === CUSTOMER_SORT_BY && opt.dataset.sortDir === CUSTOMER_SORT_DIR);
  });
}
function renderSortHeaders() { updateSortLabel(); }

// ─── Formateo de fecha amigable ───
function formatDate(unixSeconds) {
  if (!unixSeconds) return "—";
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const t = d.getTime();

  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });

  if (diffMin < 1) return "Ahora";
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (t >= startOfToday) return `Hoy ${time}`;
  if (t >= startOfYesterday) return `Ayer ${time}`;
  if (diffH < 24 * 7) {
    const days = Math.floor(diffH / 24);
    return `Hace ${days} día${days === 1 ? "" : "s"}`;
  }
  // Misma año → "12 mar"; año anterior → "12 mar 2025"
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString("es-MX", sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
}

// ─── Paginador ───
// Construye el rango de páginas a mostrar con elipsis estilo: 1 … 4 5 [6] 7 8 … 20
function buildPageRange(current, total) {
  const range = [];
  if (total <= 7) {
    for (let i = 1; i <= total; i++) range.push(i);
    return range;
  }
  range.push(1);
  if (current > 4) range.push("…");
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  for (let i = from; i <= to; i++) range.push(i);
  if (current < total - 3) range.push("…");
  range.push(total);
  return range;
}

function renderPaginator() {
  const root = document.getElementById("customersPaginator");
  const summary = document.getElementById("customersSummary");
  const pages = document.getElementById("customersPages");
  if (!root) return;

  if (CUSTOMER_TOTAL === 0) {
    root.hidden = true;
    return;
  }
  root.hidden = false;

  const from = (CUSTOMER_PAGE - 1) * CUSTOMER_PAGE_SIZE + 1;
  const to = Math.min(CUSTOMER_PAGE * CUSTOMER_PAGE_SIZE, CUSTOMER_TOTAL);
  summary.textContent = `${from}–${to} de ${CUSTOMER_TOTAL}`;

  // Asegurar que el select refleje el page size actual
  const sel = document.getElementById("customersPageSize");
  if (sel && Number(sel.value) !== CUSTOMER_PAGE_SIZE) sel.value = String(CUSTOMER_PAGE_SIZE);

  const range = buildPageRange(CUSTOMER_PAGE, CUSTOMER_TOTAL_PAGES);
  const arrow = (dir) => dir === "left"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
  const dArrow = (dir) => dir === "left"
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';

  pages.innerHTML = `
    <button class="page-btn" data-page="1"           ${CUSTOMER_PAGE === 1 ? "disabled" : ""} title="Primera">${dArrow("left")}</button>
    <button class="page-btn" data-page="${CUSTOMER_PAGE - 1}" ${CUSTOMER_PAGE === 1 ? "disabled" : ""} title="Anterior">${arrow("left")}</button>
    ${range.map((p) => p === "…"
      ? `<span class="page-btn page-btn--ellipsis">…</span>`
      : `<button class="page-btn ${p === CUSTOMER_PAGE ? "is-active" : ""}" data-page="${p}">${p}</button>`
    ).join("")}
    <button class="page-btn" data-page="${CUSTOMER_PAGE + 1}" ${CUSTOMER_PAGE >= CUSTOMER_TOTAL_PAGES ? "disabled" : ""} title="Siguiente">${arrow("right")}</button>
    <button class="page-btn" data-page="${CUSTOMER_TOTAL_PAGES}" ${CUSTOMER_PAGE >= CUSTOMER_TOTAL_PAGES ? "disabled" : ""} title="Última">${dArrow("right")}</button>
  `;

  pages.querySelectorAll("[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = Number(btn.dataset.page);
      if (!p || p === CUSTOMER_PAGE) return;
      CUSTOMER_PAGE = Math.max(1, Math.min(CUSTOMER_TOTAL_PAGES, p));
      loadCustomers();
    });
  });
}

async function loadPipelines() {
  try {
    const data = await api("GET", "/api/pipelines");
    PIPELINES = data.items;
  } catch (err) {
    console.error("Error cargando pipelines:", err);
  }
}

function renderCustomers() {
  const root = document.getElementById("customersList");
  if (!root) return;

  if (!CUSTOMERS.length) {
    root.innerHTML = `<div class="customers-empty">No hay contactos${CUSTOMER_FILTER ? ` que coincidan con "${escapeHtml(CUSTOMER_FILTER)}"` : ""}.</div>`;
    return;
  }

  root.innerHTML = CUSTOMERS.map((c) => `
    <div class="customers-row" data-id="${c.id}">
      <div class="customer-cell-name customer-cell-name--clickable" data-action="edit">
        <div class="customer-avatar">${getInitials(c)}</div>
        <div>
          <div class="customer-name">${escapeHtml(c.firstName)} ${escapeHtml(c.lastName || "")}</div>
        </div>
      </div>
      <div>${escapeHtml(c.phone || "—")}</div>
      <div>${escapeHtml(c.email || "—")}</div>
      <div class="customer-tags">
        ${c.tags.length
          ? c.tags.map((t) => `<span class="tag tag--${tagColor(t)}">${escapeHtml(t)}</span>`).join("")
          : '<span style="color:var(--text-muted)">—</span>'}
      </div>
      <div class="customer-expedients">${renderExpedientChips(c.expedients)}</div>
      <div class="customer-date" title="${new Date((c.createdAt || 0) * 1000).toLocaleString("es-MX")}">${formatDate(c.createdAt)}</div>
      <div class="customer-row-actions">
        <button class="icon-btn icon-btn--ghost" data-action="edit" aria-label="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="icon-btn icon-btn--ghost" data-action="delete" aria-label="Eliminar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join("");

  root.querySelectorAll("[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = Number(e.currentTarget.closest(".customers-row").dataset.id);
      const c = CUSTOMERS.find((x) => x.id === id);
      if (c) openCustomerModal(c);
    });
  });
  root.querySelectorAll("[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.currentTarget.closest(".customers-row").dataset.id);
      const c = CUSTOMERS.find((x) => x.id === id);
      if (!c) return;
      if (!confirm(`¿Eliminar a ${c.firstName} ${c.lastName || ""}?`)) return;
      try {
        await api("DELETE", `/api/contacts/${id}`);
        await loadCustomers();
        toast(`Contacto eliminado`, "success");
      } catch (err) {
        toast(`Error: ${err.message}`, "error");
      }
    });
  });
}

// ─── Modal de contacto ───
function renderTagChips() {
  const root = document.getElementById("tagInputChips");
  root.innerHTML = CURRENT_TAGS.map((t, i) => `
    <span class="tag-chip">${escapeHtml(t)}<button type="button" class="tag-chip-remove" data-i="${i}">×</button></span>
  `).join("");
  root.querySelectorAll(".tag-chip-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      CURRENT_TAGS.splice(Number(e.currentTarget.dataset.i), 1);
      renderTagChips();
    });
  });
}

function openCustomerModal(customer = null) {
  editingCustomerId = customer?.id || null;
  document.getElementById("customerModalTitle").textContent = customer ? "Editar contacto" : "Nuevo contacto";
  const form = document.getElementById("customerForm");
  form.firstName.value = customer?.firstName || "";
  form.lastName.value = customer?.lastName || "";
  form.phone.value = customer?.phone || "";
  form.email.value = customer?.email || "";
  CURRENT_TAGS = customer ? [...customer.tags] : [];
  renderTagChips();
  document.getElementById("tagInputField").value = "";

  // Expedientes: snapshot para diff al guardar + estado mutable
  ORIGINAL_EXPEDIENTS = customer?.expedients ? customer.expedients.map((e) => ({ ...e })) : [];
  EDIT_EXPEDIENTS = customer?.expedients ? customer.expedients.map((e) => ({ ...e })) : [];
  renderEditExpedients();

  // Si no hay pipelines cargados, ocultar la sección
  document.getElementById("expedientsSection").hidden = PIPELINES.length === 0;

  document.getElementById("customerModal").hidden = false;
  setTimeout(() => form.firstName.focus(), 50);
}
function closeCustomerModal() {
  document.getElementById("customerModal").hidden = true;
  editingCustomerId = null;
  CURRENT_TAGS = [];
  EDIT_EXPEDIENTS = [];
  ORIGINAL_EXPEDIENTS = [];
}

// ─── Expedientes dentro del modal ───
function renderEditExpedients() {
  const root = document.getElementById("editExpedientsList");
  const emptyNote = document.getElementById("expedientsEmptyNote");
  const count = document.getElementById("expedientsSectionCount");
  if (!root) return;

  count.textContent = EDIT_EXPEDIENTS.length ? `(${EDIT_EXPEDIENTS.length})` : "";
  emptyNote.hidden = EDIT_EXPEDIENTS.length > 0;

  root.innerHTML = EDIT_EXPEDIENTS.map((exp, idx) => {
    const pipelineId = exp.pipelineId || PIPELINES[0]?.id;
    const pipeline = PIPELINES.find((p) => p.id === pipelineId) || PIPELINES[0];
    const stages = pipeline?.stages || [];
    const stageId = exp.stageId && stages.some((s) => s.id === exp.stageId) ? exp.stageId : stages[0]?.id;

    return `
      <div class="edit-exp-row ${exp._isNew ? "is-new" : ""}" data-idx="${idx}">
        <label>
          <span>Nombre del expediente</span>
          <input type="text" data-field="name" value="${escapeHtml(exp.name || "")}" placeholder="Ej: Serum Facial" />
        </label>
        <label>
          <span>Pipeline</span>
          <select data-field="pipelineId">
            ${PIPELINES.map((p) => `<option value="${p.id}" ${p.id === pipelineId ? "selected" : ""}>${escapeHtml(p.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Etapa</span>
          <select data-field="stageId">
            ${stages.map((s) => `<option value="${s.id}" ${s.id === stageId ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Valor (MXN)</span>
          <input type="number" data-field="value" value="${exp.value || 0}" step="0.01" />
        </label>
        <button type="button" class="edit-exp-delete" data-action="remove-exp" title="Eliminar expediente">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `;
  }).join("");

  // Listeners por fila
  root.querySelectorAll(".edit-exp-row").forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.querySelectorAll("[data-field]").forEach((el) => {
      el.addEventListener("change", () => {
        const field = el.dataset.field;
        let v = el.value;
        if (field === "pipelineId" || field === "stageId") v = Number(v);
        else if (field === "value") v = Number(v) || 0;
        EDIT_EXPEDIENTS[idx][field] = v;

        // Si cambió pipeline, resetear stage al primero del nuevo pipeline
        if (field === "pipelineId") {
          const p = PIPELINES.find((p) => p.id === v);
          EDIT_EXPEDIENTS[idx].stageId = p?.stages?.[0]?.id || null;
          renderEditExpedients();
        }
      });
    });
    row.querySelector('[data-action="remove-exp"]').addEventListener("click", () => {
      const exp = EDIT_EXPEDIENTS[idx];
      const label = exp.name || `expediente #${idx + 1}`;
      if (exp._isNew || confirm(`¿Eliminar el expediente "${label}"?`)) {
        EDIT_EXPEDIENTS.splice(idx, 1);
        renderEditExpedients();
      }
    });
  });
}

function addEmptyExpedient() {
  if (!PIPELINES.length) {
    toast("No hay pipelines configurados todavía", "error");
    return;
  }
  const p = PIPELINES[0];
  EDIT_EXPEDIENTS.push({
    id: null,
    _isNew: true,
    _tmpId: ++EDIT_EXP_TMP,
    name: "",
    pipelineId: p.id,
    stageId: p.stages[0]?.id || null,
    value: 0
  });
  renderEditExpedients();
}
function commitTagInput() {
  const input = document.getElementById("tagInputField");
  const v = input.value.trim().replace(/,$/, "").trim();
  if (v && !CURRENT_TAGS.includes(v)) {
    CURRENT_TAGS.push(v);
    renderTagChips();
  }
  input.value = "";
}

function setupCustomers() {
  document.getElementById("newCustomerBtn")?.addEventListener("click", () => openCustomerModal());

  document.getElementById("topbarSearchInput")?.addEventListener("input", (e) => {
    if (document.body.dataset.viewActive !== 'contactos') return;
    CUSTOMER_FILTER = e.target.value;
    CUSTOMER_PAGE = 1; // al filtrar, volver a la primera página
    clearTimeout(setupCustomers._t);
    setupCustomers._t = setTimeout(loadCustomers, 200);
  });

  document.getElementById("customersPageSize")?.addEventListener("change", (e) => {
    CUSTOMER_PAGE_SIZE = Number(e.target.value) || 50;
    CUSTOMER_PAGE = 1;
    loadCustomers();
  });

  // Sort dropdown
  const sortToggle = document.getElementById("sortToggle");
  const sortDropdown = document.getElementById("sortDropdown");

  sortToggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !sortDropdown.hidden;
    sortDropdown.hidden = isOpen;
    sortToggle.setAttribute("aria-expanded", String(!isOpen));
  });

  // Click fuera cierra el dropdown
  document.addEventListener("click", (e) => {
    if (!sortDropdown || sortDropdown.hidden) return;
    if (!sortDropdown.contains(e.target) && e.target !== sortToggle && !sortToggle.contains(e.target)) {
      sortDropdown.hidden = true;
      sortToggle?.setAttribute("aria-expanded", "false");
    }
  });

  // Selección de orden
  document.querySelectorAll(".sort-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      CUSTOMER_SORT_BY = opt.dataset.sortBy;
      CUSTOMER_SORT_DIR = opt.dataset.sortDir;
      CUSTOMER_PAGE = 1;
      sortDropdown.hidden = true;
      sortToggle?.setAttribute("aria-expanded", "false");
      loadCustomers();
    });
  });

  document.querySelectorAll("[data-close-modal]").forEach((el) => el.addEventListener("click", closeCustomerModal));

  const tagField = document.getElementById("tagInputField");
  tagField?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTagInput();
    } else if (e.key === "Backspace" && !tagField.value && CURRENT_TAGS.length) {
      CURRENT_TAGS.pop();
      renderTagChips();
    }
  });
  tagField?.addEventListener("blur", commitTagInput);
  document.getElementById("tagInputBox")?.addEventListener("click", () => tagField?.focus());

  document.getElementById("addExpedientBtn")?.addEventListener("click", addEmptyExpedient);

  document.getElementById("customerForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    commitTagInput();
    const fd = new FormData(e.target);
    const payload = {
      firstName: fd.get("firstName").trim(),
      lastName: fd.get("lastName").trim(),
      phone: fd.get("phone").trim(),
      email: fd.get("email").trim(),
      tags: [...CURRENT_TAGS]
    };
    if (!payload.firstName) {
      toast("El nombre es obligatorio", "error");
      return;
    }

    try {
      // 1. Crear o actualizar contacto
      let contactId;
      if (editingCustomerId) {
        await api("PATCH", `/api/contacts/${editingCustomerId}`, payload);
        contactId = editingCustomerId;
      } else {
        const data = await api("POST", "/api/contacts", payload);
        contactId = data.item.id;
      }

      // 2. Diff de expedientes
      const currentIds = new Set(EDIT_EXPEDIENTS.filter((e) => e.id).map((e) => e.id));
      const toDelete = ORIGINAL_EXPEDIENTS.filter((e) => !currentIds.has(e.id)).map((e) => e.id);
      const toCreate = EDIT_EXPEDIENTS.filter((e) => !e.id);
      const toUpdate = EDIT_EXPEDIENTS.filter((e) => {
        if (!e.id) return false;
        const orig = ORIGINAL_EXPEDIENTS.find((o) => o.id === e.id);
        if (!orig) return false;
        return orig.name !== e.name
            || orig.pipelineId !== e.pipelineId
            || orig.stageId !== e.stageId
            || Number(orig.value) !== Number(e.value);
      });

      // 3. Aplicar cambios en paralelo
      await Promise.all([
        ...toDelete.map((id) => api("DELETE", `/api/expedients/${id}`)),
        ...toCreate.map((e) => api("POST", "/api/expedients", {
          contactId,
          pipelineId: e.pipelineId,
          stageId: e.stageId,
          name: e.name,
          value: e.value
        })),
        ...toUpdate.map((e) => api("PATCH", `/api/expedients/${e.id}`, {
          pipelineId: e.pipelineId,
          stageId: e.stageId,
          name: e.name,
          value: e.value
        }))
      ]);

      const summary = [];
      if (editingCustomerId) summary.push("Contacto actualizado");
      else summary.push("Contacto creado");
      const expChanged = toDelete.length + toCreate.length + toUpdate.length;
      if (expChanged) summary.push(`${expChanged} expediente${expChanged === 1 ? "" : "s"} actualizado${expChanged === 1 ? "" : "s"}`);

      closeCustomerModal();
      await loadCustomers();
      toast(summary.join(" · "), "success");
    } catch (err) {
      toast(`Error: ${err.message}`, "error");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const cm = document.getElementById("customerModal");
      const im = document.getElementById("importModal");
      if (cm && !cm.hidden) closeCustomerModal();
      if (im && !im.hidden) closeImportModal();
    }
  });
}

// ═══════ Importar contactos ═══════
let IMPORT_PARSED = [];
const HEADER_HINTS = ["nombre", "name", "first", "apellido", "last", "correo", "email", "mail", "telefono", "teléfono", "phone", "tel", "celular", "movil", "móvil", "mobile"];

function looksLikeHeader(parts) {
  return parts.some((p) => HEADER_HINTS.some((h) => p.toLowerCase().includes(h)));
}
function smartSplit(line) {
  const seps = [",", ";", "\t", "|"];
  let best = [line];
  for (const s of seps) {
    const parts = splitWithQuotes(line, s);
    if (parts.length > best.length) best = parts;
  }
  return best.map((p) => p.trim());
}
function splitWithQuotes(line, sep) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === sep && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length >= 11 && digits.startsWith("52")) return `+${digits}`;
  return digits;
}
function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function findLocalDuplicate(row) {
  const phone = normalizePhone(row.phone);
  const email = (row.email || "").trim().toLowerCase();
  return CUSTOMERS.find((c) => {
    if (phone && c.phone && c.phone === phone) return true;
    if (email && c.email && c.email.toLowerCase() === email) return true;
    return false;
  });
}

function parseImportText(text) {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rawLines.length) return [];
  const firstParts = smartSplit(rawLines[0]);
  const startIdx = looksLikeHeader(firstParts) ? 1 : 0;

  const rows = [];
  for (let i = startIdx; i < rawLines.length; i++) {
    const parts = smartSplit(rawLines[i]);
    const [firstName = "", lastName = "", email = "", phone = ""] = parts;
    const row = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: normalizePhone(phone.trim()),
      lineNumber: i + 1
    };

    // Validación
    if (!row.firstName && !row.lastName) {
      row.status = "err";
      row.message = "Sin nombre";
    } else {
      const dupe = findLocalDuplicate(row);
      if (dupe) {
        row.status = "dupe";
        row.message = `Ya existe: ${dupe.firstName} ${dupe.lastName || ""}`.trim();
        row.duplicateId = dupe.id;
      } else {
        const warnings = [];
        if (row.email && !isValidEmail(row.email)) warnings.push("email raro");
        if (row.phone && row.phone.replace(/\D/g, "").length < 7) warnings.push("teléfono corto");
        if (!row.email && !row.phone) warnings.push("sin contacto");
        row.status = warnings.length ? "warn" : "ok";
        row.message = warnings.join(", ");
      }
    }
    rows.push(row);
  }
  return rows;
}

function getDupePolicy() {
  const r = document.querySelector('input[name="dupePolicy"]:checked');
  return r ? r.value : "skip";
}

function renderImportPreview() {
  const preview = document.getElementById("importPreview");
  const summary = document.getElementById("importSummary");
  const body = document.getElementById("importPreviewBody");
  const confirmBtn = document.getElementById("importConfirmBtn");

  if (!IMPORT_PARSED.length) {
    preview.hidden = true;
    confirmBtn.disabled = true;
    return;
  }
  preview.hidden = false;

  const okCount = IMPORT_PARSED.filter((r) => r.status === "ok").length;
  const warnCount = IMPORT_PARSED.filter((r) => r.status === "warn").length;
  const dupeCount = IMPORT_PARSED.filter((r) => r.status === "dupe").length;
  const errCount = IMPORT_PARSED.filter((r) => r.status === "err").length;

  const policy = getDupePolicy();
  // Filas que se procesarán según política
  const willImport = IMPORT_PARSED.filter((r) => {
    if (r.status === "err") return false;
    if (r.status === "dupe" && policy === "skip") return false;
    return true;
  }).length;

  summary.innerHTML = `
    <strong>${IMPORT_PARSED.length}</strong> filas detectadas:
    ${okCount} ✅ válidas · ${warnCount} ⚠️ advertencias · ${dupeCount} 🔄 duplicadas · ${errCount} ❌ inválidas
  `;

  body.innerHTML = IMPORT_PARSED.map((r) => `
    <div class="import-preview-row ${r.status === "err" ? "import-preview-row--err" : ""}">
      <div>${escapeHtml(r.firstName) || "—"}</div>
      <div>${escapeHtml(r.lastName) || "—"}</div>
      <div>${escapeHtml(r.email) || "—"}</div>
      <div>${escapeHtml(r.phone) || "—"}</div>
      <div>
        <span class="import-status import-status--${r.status}" title="${escapeHtml(r.message || "")}">
          ${r.status === "ok" ? "OK" : r.status === "warn" ? "⚠" : r.status === "dupe" ? "🔄" : "✕"}
        </span>
      </div>
    </div>
  `).join("");

  confirmBtn.disabled = willImport === 0;
  confirmBtn.textContent = willImport ? `Importar ${willImport} contacto${willImport === 1 ? "" : "s"}` : "Importar";
}

function openImportModal() {
  IMPORT_PARSED = [];
  document.getElementById("importTextarea").value = "";
  document.getElementById("importFileName").hidden = true;
  document.getElementById("importBulkTag").value = "";
  document.querySelectorAll('input[name="dupePolicy"]').forEach((r, i) => { r.checked = i === 0; });
  renderImportPreview();
  document.querySelectorAll(".import-tab").forEach((t, i) => t.classList.toggle("is-active", i === 0));
  document.querySelectorAll(".import-pane").forEach((p, i) => p.classList.toggle("is-active", i === 0));
  document.getElementById("importModal").hidden = false;
}
function closeImportModal() {
  document.getElementById("importModal").hidden = true;
  IMPORT_PARSED = [];
}

function setupImport() {
  document.getElementById("importCustomersBtn")?.addEventListener("click", openImportModal);
  document.querySelectorAll("[data-close-import]").forEach((el) => el.addEventListener("click", closeImportModal));

  document.querySelectorAll(".import-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.importTab;
      document.querySelectorAll(".import-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      document.querySelectorAll(".import-pane").forEach((p) => p.classList.toggle("is-active", p.dataset.pane === target));
    });
  });

  document.getElementById("importPasteBtn")?.addEventListener("click", () => {
    const text = document.getElementById("importTextarea").value;
    IMPORT_PARSED = parseImportText(text);
    renderImportPreview();
  });

  // Cambio de política recalcula el contador
  document.querySelectorAll('input[name="dupePolicy"]').forEach((r) => {
    r.addEventListener("change", renderImportPreview);
  });

  // Subir archivo
  const fileInput = document.getElementById("importFileInput");
  const dropzone = document.getElementById("importDropzone");
  const fileName = document.getElementById("importFileName");

  function handleFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("El archivo es demasiado grande (máx 5 MB)", "error");
      return;
    }
    fileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    fileName.hidden = false;
    const reader = new FileReader();
    reader.onload = (e) => {
      IMPORT_PARSED = parseImportText(e.target.result);
      renderImportPreview();
    };
    reader.readAsText(file, "utf-8");
  }

  fileInput?.addEventListener("change", (e) => handleFile(e.target.files?.[0]));
  ["dragenter", "dragover"].forEach((ev) => {
    dropzone?.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("is-dragover"); });
  });
  ["dragleave", "drop"].forEach((ev) => {
    dropzone?.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("is-dragover"); });
  });
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  });

  // Confirmar
  document.getElementById("importConfirmBtn")?.addEventListener("click", async () => {
    const dupePolicy = getDupePolicy();
    const importable = IMPORT_PARSED.filter((r) => {
      if (r.status === "err") return false;
      if (r.status === "dupe" && dupePolicy === "skip") return false;
      return true;
    });
    if (!importable.length) return;

    const bulkTag = document.getElementById("importBulkTag").value.trim() || null;

    try {
      const result = await api("POST", "/api/contacts/import", {
        rows: importable.map((r) => ({
          firstName: r.firstName,
          lastName: r.lastName,
          phone: r.phone,
          email: r.email
        })),
        dupePolicy,
        bulkTag
      });
      closeImportModal();
      await loadCustomers();
      const parts = [];
      if (result.created)  parts.push(`${result.created} creados`);
      if (result.updated)  parts.push(`${result.updated} actualizados`);
      if (result.skipped)  parts.push(`${result.skipped} omitidos`);
      if (result.errors)   parts.push(`${result.errors} con error`);
      toast(`✅ Importación lista: ${parts.join(" · ")}`, "success", 5000);
    } catch (err) {
      toast(`Error en importación: ${err.message}`, "error");
    }
  });
}

// ═══════ Asesores ═══════

let _advisors = [];
let _advisorEditId = null;

const PERM_DEFS = [
  { key: 'write',           elId: 'permWrite' },
  { key: 'delete',          elId: 'permDelete' },
  { key: 'view_reports',    elId: 'permReports' },
  { key: 'manage_advisors', elId: 'permManageAdvisors' },
];

async function loadAdvisors() {
  try {
    _advisors = await api('GET', '/api/advisors');
    renderAdvisors();
  } catch (e) {
    if (e?.message?.includes('403')) return; // no tiene permiso
    console.error('loadAdvisors', e);
  }
}

function renderAdvisors() {
  const table  = document.getElementById('advisorsTable');
  const empty  = document.getElementById('advisorsEmpty');
  if (!table) return;

  // Quitar filas anteriores (dejar header y empty)
  table.querySelectorAll('.advisors-row:not(.advisors-row--head)').forEach(r => r.remove());

  const me = getAdvisor();

  if (!_advisors.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const PERM_LABELS = {
    write:           'Escribir',
    delete:          'Eliminar',
    view_reports:    'Reportes',
    manage_advisors: 'Asesores',
  };

  _advisors.forEach(a => {
    const isMe   = me?.id === a.id;
    const isAdmin = a.role === 'admin';
    const perms  = isAdmin
      ? '<span class="adv-perm-tag adv-perm-tag--all">Todo</span>'
      : Object.entries(a.permissions || {})
          .filter(([, v]) => v)
          .map(([k]) => `<span class="adv-perm-tag">${PERM_LABELS[k] || k}</span>`)
          .join('') || '<span class="adv-perm-tag adv-perm-tag--none">Ninguno</span>';

    const initials = (a.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const statusClass = a.active ? 'adv-status--active' : 'adv-status--inactive';
    const statusLabel = a.active ? 'Activo' : 'Inactivo';

    const row = document.createElement('div');
    row.className = 'advisors-row';
    row.innerHTML = `
      <div class="adv-cell-user">
        <div class="adv-avatar">${initials}</div>
        <div>
          <div class="adv-cell-name">${escapeHtml(a.name)}${isMe ? ' <span class="adv-you">Tú</span>' : ''}</div>
          <div class="adv-cell-sub">${escapeHtml(a.username)}</div>
        </div>
      </div>
      <div class="adv-cell-email">${escapeHtml(a.email || '—')}</div>
      <div><span class="chip ${isAdmin ? 'chip--admin' : 'chip--asesor'}">${isAdmin ? 'Admin' : 'Asesor'}</span></div>
      <div class="adv-perms-row">${perms}</div>
      <div><span class="adv-status ${statusClass}">${statusLabel}</span></div>
      <div class="adv-actions">
        <button class="icon-btn icon-btn--ghost adv-edit-btn" data-id="${a.id}" title="Editar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </div>`;
    table.appendChild(row);
  });

  table.querySelectorAll('.adv-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openAdvisorModal(Number(btn.dataset.id)));
  });
}

function openAdvisorModal(id = null) {
  _advisorEditId = id;
  const modal    = document.getElementById('advisorModal');
  const title    = document.getElementById('advisorModalTitle');
  const errEl    = document.getElementById('advisorModalError');
  const delBtn   = document.getElementById('advisorDeleteBtn');
  const passLabel = document.getElementById('advPasswordLabel');

  errEl.hidden = true;

  if (id) {
    const a = _advisors.find(x => x.id === id);
    if (!a) return;
    title.textContent = 'Editar asesor';
    document.getElementById('advName').value     = a.name     || '';
    document.getElementById('advUsername').value = a.username || '';
    document.getElementById('advEmail').value    = a.email    || '';
    document.getElementById('advPassword').value = '';
    passLabel.innerHTML = 'Nueva contraseña <span style="color:var(--text-muted);font-weight:400">(opcional)</span>';
    document.querySelector(`input[name="advRole"][value="${a.role}"]`).checked = true;
    PERM_DEFS.forEach(p => {
      document.getElementById(p.elId).checked = !!a.permissions?.[p.key];
    });
    const me = getAdvisor();
    delBtn.hidden = (me?.id === id); // no puede borrarse a sí mismo
  } else {
    title.textContent = 'Nuevo asesor';
    ['advName','advUsername','advEmail','advPassword'].forEach(id => document.getElementById(id).value = '');
    passLabel.innerHTML = 'Contraseña <span class="int-field-required">*</span>';
    document.querySelector('input[name="advRole"][value="asesor"]').checked = true;
    PERM_DEFS.forEach(p => {
      document.getElementById(p.elId).checked = p.key === 'write';
    });
    delBtn.hidden = true;
  }

  _syncPermsVisibility();
  modal.hidden = false;
}

function _syncPermsVisibility() {
  const role = document.querySelector('input[name="advRole"]:checked')?.value;
  document.getElementById('advPermsSection').style.display = role === 'admin' ? 'none' : '';
}

function setupAdvisors() {
  // Abrir modal nuevo
  document.getElementById('advisorNewBtn')?.addEventListener('click', () => openAdvisorModal());

  // Cerrar modal
  document.getElementById('advisorModal')?.addEventListener('click', e => {
    if (e.target.dataset.closeAdvisor !== undefined) document.getElementById('advisorModal').hidden = true;
  });

  // Cambio de rol → mostrar/ocultar permisos
  document.querySelectorAll('input[name="advRole"]').forEach(r => {
    r.addEventListener('change', _syncPermsVisibility);
  });

  // Guardar
  document.getElementById('advisorSaveBtn')?.addEventListener('click', async () => {
    const errEl = document.getElementById('advisorModalError');
    errEl.hidden = true;

    const name     = document.getElementById('advName').value.trim();
    const username = document.getElementById('advUsername').value.trim();
    const email    = document.getElementById('advEmail').value.trim();
    const password = document.getElementById('advPassword').value;
    const role     = document.querySelector('input[name="advRole"]:checked')?.value || 'asesor';

    if (!name || !username) { showAdvError('Nombre y usuario son obligatorios'); return; }
    if (!_advisorEditId && !password) { showAdvError('La contraseña es obligatoria'); return; }
    if (password && password.length < 6) { showAdvError('La contraseña debe tener al menos 6 caracteres'); return; }

    const permissions = {};
    PERM_DEFS.forEach(p => { permissions[p.key] = document.getElementById(p.elId).checked; });

    const body = { name, username, email: email || null, role, permissions };
    if (password) body.password = password;

    try {
      if (_advisorEditId) {
        await api('PATCH', `/api/advisors/${_advisorEditId}`, body);
      } else {
        await api('POST', '/api/advisors', body);
      }
      document.getElementById('advisorModal').hidden = true;
      await loadAdvisors();
      toast(_advisorEditId ? 'Asesor actualizado' : 'Asesor creado', 'success');
    } catch (e) {
      showAdvError(e.message);
    }
  });

  // Eliminar
  document.getElementById('advisorDeleteBtn')?.addEventListener('click', async () => {
    if (!_advisorEditId) return;
    const a = _advisors.find(x => x.id === _advisorEditId);
    if (!confirm(`¿Eliminar al asesor "${a?.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api('DELETE', `/api/advisors/${_advisorEditId}`);
      document.getElementById('advisorModal').hidden = true;
      await loadAdvisors();
      toast('Asesor eliminado', 'success');
    } catch (e) {
      showAdvError(e.message);
    }
  });
}

function showAdvError(msg) {
  const el = document.getElementById('advisorModalError');
  el.textContent = msg;
  el.hidden = false;
}

// ═══════ Tokens de máquina (admin only) ═══════
let _machineTokens = [];

function relTime(ts) {
  if (!ts) return '—';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`;
  return new Date(ts * 1000).toLocaleDateString();
}

async function loadMachineTokens() {
  try {
    const data = await api('GET', '/api/machine-tokens');
    _machineTokens = data.items || [];
    renderMachineTokens();
  } catch (err) {
    console.error('loadMachineTokens', err);
    toast(err.message || 'Error cargando tokens', 'error');
  }
}

async function loadDeployVersion() {
  const el = document.getElementById('deployVersion');
  if (!el) return;
  try {
    const v = await api('GET', '/api/admin/version');
    const date = v.date ? new Date(v.date).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    el.innerHTML = `Versión actual: <code>${escHtml(v.commit || '?')}</code> · ${escHtml(v.subject || '')} <span class="deploy-date">${escHtml(date)}</span>`;
  } catch (err) {
    el.textContent = 'No se pudo leer la versión actual';
  }
}

async function runDeploy() {
  const btn = document.getElementById('deployBtn');
  const status = document.getElementById('deployStatus');
  if (!btn || !status) return;
  if (!confirm('¿Desplegar última versión? El server se reinicia ~3 segundos.')) return;
  btn.disabled = true;
  btn.textContent = '⏳ Desplegando…';
  status.hidden = false;
  status.className = 'deploy-status deploy-status--info';
  status.textContent = 'Bajando cambios desde GitHub…';
  let result;
  try {
    result = await api('POST', '/api/admin/deploy', {});
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '🚀 Desplegar última versión';
    status.className = 'deploy-status deploy-status--error';
    status.textContent = '❌ ' + (err.message || 'Falló el deploy');
    return;
  }
  if (result.noChanges) {
    btn.disabled = false;
    btn.textContent = '🚀 Desplegar última versión';
    status.className = 'deploy-status deploy-status--ok';
    status.textContent = `✓ Ya estás en la última versión (${result.after}). Sin cambios que aplicar.`;
    return;
  }
  status.textContent = `✓ Cambios bajados: ${result.before} → ${result.after} "${result.subject}". Reiniciando server…`;
  await waitForServerHealth(status);
  status.className = 'deploy-status deploy-status--ok';
  status.textContent = '✓ Deploy completado. Recargando…';
  await new Promise(r => setTimeout(r, 800));
  if ('caches' in window) {
    try { const keys = await caches.keys(); await Promise.all(keys.map(k => caches.delete(k))); } catch (_) {}
  }
  const url = new URL(window.location.href);
  url.searchParams.set('_cb', Date.now().toString(36));
  window.location.replace(url.toString());
}

async function waitForServerHealth(status) {
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const r = await fetch('/healthz', { cache: 'no-store' });
      if (r.ok) return true;
    } catch (_) {}
    if (status) status.textContent = `Reiniciando server… (${i + 1}s)`;
  }
  return false;
}

function renderMachineTokens() {
  const table = document.getElementById('mtTable');
  const empty = document.getElementById('mtEmpty');
  if (!table) return;

  table.querySelectorAll('.mt-row:not(.mt-row--head)').forEach(r => r.remove());

  const showRevoked = document.getElementById('mtShowRevoked')?.checked;
  const items = _machineTokens.filter(t => showRevoked || !t.revoked_at);

  if (!items.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  items.forEach(t => {
    const row = document.createElement('div');
    row.className = 'mt-row' + (t.revoked_at ? ' mt-row--revoked' : '');
    const status = t.revoked_at
      ? `<span class="mt-status mt-status--revoked">Revocado</span>`
      : `<span class="mt-status mt-status--active">Activo</span>`;
    const revokeBtn = t.revoked_at
      ? ''
      : `<button class="btn btn--sm btn--danger-ghost" data-mt-revoke="${t.id}">Revocar</button>`;
    row.innerHTML = `
      <div class="mt-name">${escapeHtml(t.name)}</div>
      <div class="mt-prefix"><code>${escapeHtml(t.prefix)}…</code></div>
      <div class="mt-lastuse">${relTime(t.last_used_at)}</div>
      <div class="mt-ip">${escapeHtml(t.last_used_ip || '—')}</div>
      <div>${status}</div>
      <div class="mt-actions-cell">${revokeBtn}</div>
    `;
    table.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function setupMachineTokens() {
  document.getElementById('deployBtn')?.addEventListener('click', runDeploy);

  const newBtn       = document.getElementById('mtNewBtn');
  const newModal     = document.getElementById('mtNewModal');
  const newName      = document.getElementById('mtNewName');
  const newCreate    = document.getElementById('mtNewCreate');
  const tokenModal   = document.getElementById('mtTokenModal');
  const tokenPlain   = document.getElementById('mtTokenPlain');
  const copyBtn      = document.getElementById('mtCopyBtn');
  const revokeAllBtn = document.getElementById('mtRevokeAllBtn');
  const showRevoked  = document.getElementById('mtShowRevoked');
  const table        = document.getElementById('mtTable');

  if (!newBtn) return;

  newBtn.addEventListener('click', () => {
    if (newName) newName.value = '';
    newModal.hidden = false;
    setTimeout(() => newName?.focus(), 50);
  });

  document.querySelectorAll('[data-close-mt-new]').forEach(el => {
    el.addEventListener('click', () => { newModal.hidden = true; });
  });

  document.querySelectorAll('[data-close-mt-token]').forEach(el => {
    el.addEventListener('click', () => { tokenModal.hidden = true; });
  });

  newCreate.addEventListener('click', async () => {
    const name = (newName.value || '').trim();
    if (!name) { toast('Nombre requerido', 'error'); return; }
    try {
      const r = await api('POST', '/api/machine-tokens', { name });
      newModal.hidden = true;
      tokenPlain.textContent = r.token;
      tokenModal.hidden = false;
      await loadMachineTokens();
    } catch (err) {
      toast(err.message || 'Error generando token', 'error');
    }
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(tokenPlain.textContent);
      toast('Copiado al portapapeles', 'success');
    } catch (_) {
      toast('No se pudo copiar — selecciónalo manualmente', 'error');
    }
  });

  table.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-mt-revoke]');
    if (!btn) return;
    const id = Number(btn.dataset.mtRevoke);
    const tok = _machineTokens.find(t => t.id === id);
    if (!confirm(`¿Revocar el token "${tok?.name || id}"? Las requests con este token recibirán 401.`)) return;
    try {
      await api('DELETE', `/api/machine-tokens/${id}`);
      await loadMachineTokens();
      toast('Token revocado', 'success');
    } catch (err) {
      toast(err.message || 'Error al revocar', 'error');
    }
  });

  revokeAllBtn.addEventListener('click', async () => {
    if (!confirm('Esto va a invalidar TODOS los tokens activos. ¿Continuar?')) return;
    try {
      const r = await api('POST', '/api/machine-tokens/revoke-all');
      await loadMachineTokens();
      toast(`${r.revoked} token(s) revocados`, 'success');
    } catch (err) {
      toast(err.message || 'Error al revocar todos', 'error');
    }
  });

  showRevoked?.addEventListener('change', renderMachineTokens);
}

// ═══════ Dashboard / Inicio ═══════

async function loadDashboard() {
  const subtitle = document.getElementById('dashSubtitle');
  if (subtitle) {
    const now = new Date();
    const h = now.getHours();
    const greeting = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    subtitle.textContent = `${greeting} · ${now.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}`;
  }

  try {
    const d = await api('GET', '/api/stats');
    renderDashboard(d);
  } catch (err) {
    console.error('loadDashboard', err);
  }
}

function renderDashboard(d) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const fmt = n => (n ?? 0).toLocaleString('es-MX');

  set('dashMsgReceived',    fmt(d.messages.received));
  set('dashMsgReceivedToday', `+${fmt(d.messages.receivedToday)} hoy · +${fmt(d.messages.receivedWeek)} esta semana`);
  set('dashMsgSent',        fmt(d.messages.sent));
  set('dashMsgSentToday',   `+${fmt(d.messages.sentToday)} hoy · +${fmt(d.messages.sentWeek)} esta semana`);
  set('dashConvos',         fmt(d.conversations.total));
  set('dashConvosUnread',   d.conversations.unread ? `${fmt(d.conversations.unread)} sin leer` : 'todas leídas');
  set('dashContacts',       fmt(d.contacts.total));
  set('dashContactsToday',  d.contacts.newToday ? `+${fmt(d.contacts.newToday)} hoy` : 'sin nuevos hoy');
  set('dashExps',           fmt(d.expedients.total));

  renderDashChart(d.daily || []);
}

function renderDashChart(daily) {
  const chartEl  = document.getElementById('dashChart');
  const labelsEl = document.getElementById('dashChartLabels');
  if (!chartEl || !labelsEl) return;

  // Fill missing days in the last 7
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = daily.find(r => r.day === key);
    days.push({ key, sent: found?.sent || 0, received: found?.received || 0 });
  }

  const maxVal = Math.max(...days.map(d => Math.max(d.sent, d.received)), 1);
  const BAR_W = 14;
  const GAP   = 6;
  const H     = 60;
  const PAIR  = BAR_W * 2 + GAP;
  const GROUP = PAIR + 14;
  const W     = GROUP * 7 + 4;

  const bars = days.map((d, i) => {
    const x0 = i * GROUP + 2;
    const hR  = Math.round((d.received / maxVal) * H);
    const hS  = Math.round((d.sent     / maxVal) * H);
    return `
      <rect x="${x0}"            y="${H - hR}" width="${BAR_W}" height="${hR}" rx="3" fill="var(--dash-received)" opacity=".85"/>
      <rect x="${x0 + BAR_W + GAP}" y="${H - hS}" width="${BAR_W}" height="${hS}" rx="3" fill="var(--dash-sent)"     opacity=".85"/>`;
  }).join('');

  chartEl.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:${H}px;display:block;">${bars}</svg>`;

  const DAY_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  labelsEl.innerHTML = days.map(d => {
    const label = DAY_LABELS[new Date(d.key + 'T12:00:00').getDay()];
    return `<span>${label}</span>`;
  }).join('');
}

function setupDashboard() {
  document.getElementById('dashRefreshBtn')?.addEventListener('click', loadDashboard);
}

// ═══════ Navegación ═══════
const NAV_VIEWS = new Set(['inicio','chats','pipelines','expedientes','contactos','plantillas','integraciones','bot','ajustes','cuenta']);
function showView(viewName) {
  const navItems = document.querySelectorAll(".nav-item");
  const views = document.querySelectorAll(".view");
  const title = document.getElementById("topbarTitle");
  navItems.forEach((n) => {
    n.classList.toggle("is-active", n.dataset.view === viewName);
  });
  views.forEach((v) => { v.hidden = v.dataset.view !== viewName; });
  document.body.dataset.viewActive = viewName;
  if (NAV_VIEWS.has(viewName)) localStorage.setItem('lastView', viewName);
  const labels = { cuenta: "Mi cuenta" };
  const matchingNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  title.textContent = labels[viewName] || matchingNav?.querySelector("span")?.textContent || viewName;

  // Toggle pipeline-specific topbar controls
  const searchInput = document.getElementById('topbarSearchInput');
  const plExtras = document.getElementById('topbarPlExtras');
  const topbarActions = document.getElementById('topbarActions');
  if (viewName === 'pipelines') {
    if (searchInput) { searchInput.placeholder = 'Buscar expediente…'; searchInput.value = PL_FILTERS.q || ''; }
    if (plExtras) plExtras.hidden = false;
    renderPipelinesBoard();
  } else if (viewName === 'integraciones') {
    if (searchInput) { searchInput.placeholder = 'Buscar integración…'; searchInput.value = ''; }
    if (plExtras) plExtras.hidden = true;
  } else if (viewName === 'bot') {
    if (searchInput) { searchInput.placeholder = 'Buscar bots…'; searchInput.value = ''; }
    if (plExtras) plExtras.hidden = true;
  } else if (viewName === 'contactos') {
    if (searchInput) { searchInput.placeholder = 'Buscar por nombre, teléfono o email...'; searchInput.value = CUSTOMER_FILTER || ''; }
    if (plExtras) plExtras.hidden = true;
  } else if (viewName === 'expedientes') {
    if (searchInput) { searchInput.placeholder = 'Buscar expediente…'; searchInput.value = (EXP_FILTERS && EXP_FILTERS.q) || ''; }
    if (plExtras) plExtras.hidden = true;
  } else if (viewName === 'plantillas') {
    if (searchInput) { searchInput.placeholder = 'Buscar plantilla…'; searchInput.value = (typeof _tplFilter !== 'undefined' ? _tplFilter : '') || ''; }
    if (plExtras) plExtras.hidden = true;
  } else {
    if (searchInput) { searchInput.placeholder = 'Buscar conversaciones...'; searchInput.value = ''; }
    if (plExtras) plExtras.hidden = true;
  }
  const cleanTopbar = (viewName === 'integraciones' || viewName === 'bot' || viewName === 'contactos' || viewName === 'expedientes' || viewName === 'plantillas');
  if (title) title.hidden = cleanTopbar;
  if (topbarActions) topbarActions.hidden = cleanTopbar || viewName === 'pipelines' || viewName === 'inicio';
  const customersExtras = document.getElementById('topbarCustomersExtras');
  if (customersExtras) customersExtras.hidden = (viewName !== 'contactos');
  const expExtras = document.getElementById('topbarExpExtras');
  if (expExtras) expExtras.hidden = (viewName !== 'expedientes');
  if (viewName === 'chats') loadConversations();
  if (viewName === 'inicio') loadDashboard();
}

function setupNav() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      showView(item.dataset.view);
    });
  });

  // Sidebar collapse toggle
  const collapseBtn = document.getElementById('navCollapseBtn');
  const isCollapsed = localStorage.getItem('navCollapsed') === '1';
  if (isCollapsed) document.body.classList.add('nav-collapsed');
  else document.body.classList.add('nav-expanded');

  collapseBtn?.addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('nav-collapsed');
    document.body.classList.toggle('nav-expanded', !collapsed);
    localStorage.setItem('navCollapsed', collapsed ? '1' : '0');
  });
}

// ═══════ Tabs Ajustes ═══════
function setupSettingsTabs() {
  const tabs = document.querySelectorAll(".settings-tab");
  const panes = document.querySelectorAll(".settings-pane");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.settings;
      tabs.forEach((t) => t.classList.toggle("is-active", t === tab));
      panes.forEach((p) => p.classList.toggle("is-active", p.dataset.settings === target));
      if (target === 'papelera') loadTrash();
      if (target === 'tokens-maquina') { loadMachineTokens(); loadDeployVersion(); }
    });
  });
  document.querySelectorAll(".ai-provider input").forEach((input) => {
    input.addEventListener("change", () => {
      document.querySelectorAll(".ai-provider").forEach((el) => el.classList.remove("is-selected"));
      input.closest(".ai-provider").classList.add("is-selected");
    });
  });
}

// ═══════ Integraciones ═══════

const PROVIDER_ICONS = {
  'whatsapp': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a8.6 8.6 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378L2 21l1.658-6.054a9.84 9.84 0 0 1-1.323-4.918C2.338 5.387 7.277.448 13.28.448c2.916 0 5.656 1.137 7.712 3.199 2.055 2.063 3.188 4.805 3.187 7.722-.003 6.027-4.943 10.967-10.968 10.967z"/></svg>`,

  'whatsapp-lite': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a8.6 8.6 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378L2 21l1.658-6.054a9.84 9.84 0 0 1-1.323-4.918C2.338 5.387 7.277.448 13.28.448c2.916 0 5.656 1.137 7.712 3.199 2.055 2.063 3.188 4.805 3.187 7.722-.003 6.027-4.943 10.967-10.968 10.967z"/></svg>`,

  'messenger': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 0C5.373 0 0 4.973 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.973 18.627 0 12 0zm1.194 14.963-3.055-3.26-5.963 3.26 6.559-6.963 3.13 3.26 5.957-3.26-6.628 6.963z"/></svg>`,

  'instagram': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,

  'telegram': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>`,

  'tiktok': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.2 8.2 0 0 0 4.78 1.5V6.73a4.85 4.85 0 0 1-1-.04z"/></svg>`,

  'woocommerce': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M2.2 2.6C1 2.6 0 3.6 0 4.8v11.6c0 1.2 1 2.2 2.2 2.2h5l2.8 2.8 2.8-2.8H21.8c1.2 0 2.2-1 2.2-2.2V4.8c0-1.2-1-2.2-2.2-2.2zm3 4.6c.5 0 .9.3 1 .9l.9 4.2 1-3.2c.2-.5.5-.8.9-.8.4 0 .7.3.9.8l1 3.2.9-4.2c.1-.6.5-.9 1-.9.5.1.8.5.7 1l-1.4 5.2c-.1.6-.5.9-1.1.9-.4 0-.7-.2-.9-.7l-1-3.2-1 3.2c-.2.5-.5.7-.9.7-.6 0-1-.3-1.1-.9L3.5 8.2c-.1-.5.2-.9.7-1zm10.8 0c1.6 0 2.7 1.2 2.7 2.8S17.6 12.8 16 12.8s-2.7-1.2-2.7-2.8 1.1-2.8 2.7-2.8zm0 1.3c-.9 0-1.5.7-1.5 1.5s.6 1.5 1.5 1.5 1.5-.7 1.5-1.5-.6-1.5-1.5-1.5zm5.3-.9v2.3c0 1 .7 1.8 1.6 1.8v1.3c-1.6 0-2.8-1.3-2.8-2.9v-.8l-.5-.1v-1l.5-.1V7.6h1.2z"/></svg>`,

  'shopify': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M15.337.009s-.137-.009-.273-.009c-.092 0-.23.025-.368.057C14.397.092 13.5.46 13.5.46s-.57-.156-1.24-.156C9.48.304 7.963 2.15 7.41 4.097c-.781.24-1.33.41-1.347.416C5.38 4.826 5.354 4.851 5.34 5.547L4.154 19.4l9.614 1.603L18.846 19.4 17.66 5.547c-.014-.696-.04-.721-.714-.914-.017-.006-.55-.17-1.347-.416C15.044 1.27 15.2.734 15.337.009zM13.774 1.04l-.005.094c-.48.146-.988.3-1.506.46l-.008-.028c.016-.008.033-.017.051-.026.235-.123.484-.247.74-.363.236-.11.49-.155.728-.137zm-1.514 1.378c.048.166.096.333.148.499-.6.183-1.252.382-1.916.585.16-.58.45-1.095.85-1.48.29-.276.616-.476.918-.572zm2.49-.79c-.11.37-.268.8-.49 1.235l-.245.075c-.063-.215-.126-.43-.194-.643.17-.092.345-.176.527-.25.135-.054.268-.1.402-.137v-.28zm-3.786 9.944-.71-.067.06-.56.768.072.02-.2-.768-.072.054-.512.73.07.02-.2-.73-.07.055-.527 1.07.1-.02.2-1.07-.1v.528l1.01.095-.018.2-1.01-.096v.56l.77.072-.062.56-.77-.072v.2l.74.07.062.56-.74-.07.2 1.887-1.255.118-.2-1.887-.73.07-.062-.56.73-.07-.065-.6-.77.073-.062-.56.77-.073v-.528l-1.07.1-.02-.2 1.07-.1.056.527.73-.07.02.2-.73.07v.512l.768-.072.02.2-.768.072.018.2.71.067z"/></svg>`,

  'square': `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.5 0h-11A6.5 6.5 0 0 0 0 6.5v11A6.5 6.5 0 0 0 6.5 24h11A6.5 6.5 0 0 0 24 17.5v-11A6.5 6.5 0 0 0 17.5 0zM16 16H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2z"/></svg>`,
};

let INTEGRATIONS = [];
let INT_EDIT = null;
let OUTGOING_WEBHOOKS = [];
let WH_EDIT = null;
let ROUTING_INTEGRATION_ID = null;
const ALL_WH_EVENTS = [
  { key: 'message.received',        label: 'Mensaje recibido' },
  { key: 'message.sent',            label: 'Mensaje enviado' },
  { key: 'contact.created',         label: 'Contacto creado' },
  { key: 'contact.updated',         label: 'Contacto actualizado' },
  { key: 'expedient.created',       label: 'Expediente creado' },
  { key: 'expedient.stage_changed', label: 'Expediente cambió de etapa' },
  { key: 'expedient.closed',        label: 'Expediente cerrado' },
];

async function loadIntegrations() {
  try {
    const data = await api("GET", "/api/integrations");
    INTEGRATIONS = data.items;
    renderIntegrations();
  } catch (err) {
    console.error("Error cargando integraciones:", err);
  }
}

async function loadOutgoingWebhooks() {
  try {
    const data = await api("GET", "/api/outgoing-webhooks");
    OUTGOING_WEBHOOKS = data.items;
    renderOutgoingWebhooks();
  } catch (err) {
    console.error("Error cargando webhooks salientes:", err);
  }
}

function oauthIcon(providerKey) {
  if (providerKey === 'tiktok') return `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.2 8.2 0 0 0 4.78 1.5V6.73a4.85 4.85 0 0 1-1-.04z"/></svg> Conectar con TikTok`;
  return `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 0C5.373 0 0 4.973 0 11.111c0 3.497 1.745 6.616 4.472 8.652V24l4.086-2.242c1.09.301 2.246.464 3.442.464 6.627 0 12-4.974 12-11.111C24 4.973 18.627 0 12 0zm1.194 14.963-3.055-3.26-5.963 3.26 6.559-6.963 3.13 3.26 5.957-3.26-6.628 6.963z"/></svg> Conectar con Facebook`;
}

function renderIntegrations() {
  const root = document.getElementById("integrationsGrid");
  if (!root) return;

  const cards = INTEGRATIONS.map((p) => {
    const isOAuth = p.authType && p.authType.startsWith('oauth_');
    const connected = (p.integrations || []).filter((i) => i.status === "connected");
    const errored = (p.integrations || []).filter((i) => i.status === "error");
    const connecting = (p.integrations || []).filter((i) => i.status === "connecting" || i.status === "pending");
    const hasAny = connected.length + errored.length > 0;
    const dotClass = errored.length ? "is-error" : connected.length ? "is-connected" : connecting.length ? "is-connecting" : "";

    const icon = PROVIDER_ICONS[p.key] || escapeHtml(p.initial || p.name[0]);

    const accountsHtml = (p.integrations || []).map((inst) => {
      const routingLabel = inst.routing
        ? `${escapeHtml(inst.routing.pipelineName || '')} › ${escapeHtml(inst.routing.stageName || '')}`
        : 'Sin pipeline asignado';
      const isErr = inst.status === 'error';
      const isConnecting = inst.status === 'connecting' || inst.status === 'pending';
      const metaClass = isErr ? 'is-error' : isConnecting ? 'is-connecting' : '';
      const metaText = isErr ? '⚠ ' + escapeHtml(inst.lastError || 'Error')
                     : isConnecting ? '⏳ Esperando escaneo de QR…'
                     : routingLabel;
      return `
        <div class="int-account-row">
          <div class="int-account-avatar" style="background:${p.color}">${icon}</div>
          <div class="int-account-info">
            <div class="int-account-name">${escapeHtml(inst.displayName || p.name)}</div>
            <div class="int-account-meta ${metaClass}">${metaText}</div>
          </div>
          <div class="int-account-actions">
            <button class="btn btn--xs btn--ghost" data-action="routing" data-id="${inst.id}" title="Configurar pipeline">Pipeline</button>
            <button class="btn btn--xs btn--ghost" data-action="edit-instance" data-provider="${p.key}" data-id="${inst.id}" title="Editar">${isOAuth ? 'Ver' : 'Editar'}</button>
            <button class="btn btn--xs btn--danger-ghost" data-action="disconnect" data-id="${inst.id}" data-name="${escapeHtml(inst.displayName || p.name)}" title="Desconectar">✕</button>
          </div>
        </div>`;
    }).join("");

    const connectBtn = `<button class="btn btn--ghost" data-action="manual" data-provider="${p.key}">${connected.length ? '+ Conectar otra' : 'Conectar'}</button>`;

    let badgeHtml;
    if (connected.length) badgeHtml = '<span class="int-badge-connected">Conectado</span>';
    else if (connecting.length) badgeHtml = '<span class="int-badge-connecting">Esperando QR…</span>';
    else badgeHtml = `<span class="int-status-dot ${dotClass}"></span>`;

    return `
      <div class="int-card${connected.length ? ' int-card--connected' : ''}${connecting.length && !connected.length ? ' int-card--connecting' : ''}">
        <div class="int-card-head">
          <span class="int-icon" style="background:${p.color}">${icon}</span>
          <div class="int-name">
            ${escapeHtml(p.name)}
            ${badgeHtml}
          </div>
        </div>
        <p class="int-desc">${escapeHtml(p.description)}</p>
        ${accountsHtml ? `<div class="int-accounts">${accountsHtml}</div>` : ''}
        <div class="int-card-actions">
          ${connectBtn}
        </div>
      </div>`;
  });

  root.innerHTML = cards.join("") + renderOutgoingWebhooksCard();
  bindIntegrationListeners(root);
  bindOutgoingWebhookCardListeners(root);
}

function bindIntegrationListeners(root) {
  root.querySelectorAll('[data-action="oauth"]').forEach((btn) => {
    btn.addEventListener("click", () => connectOAuth(btn.dataset.provider, btn.dataset.auth));
  });
  root.querySelectorAll('[data-action="manual"]').forEach((btn) => {
    btn.addEventListener("click", () => openIntegrationModal(btn.dataset.provider));
  });
  root.querySelectorAll('[data-action="edit-instance"]').forEach((btn) => {
    btn.addEventListener("click", () => openIntegrationModal(btn.dataset.provider, Number(btn.dataset.id)));
  });
  root.querySelectorAll('[data-action="routing"]').forEach((btn) => {
    btn.addEventListener("click", () => openRoutingModal(Number(btn.dataset.id)));
  });
  root.querySelectorAll('[data-action="disconnect"]').forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(`¿Desconectar "${btn.dataset.name}"?`)) return;
      try {
        await api("DELETE", `/api/integrations/${btn.dataset.id}`);
        await loadIntegrations();
        toast("Integración desconectada", "success");
      } catch (err) {
        toast(`Error: ${err.message}`, "error");
      }
    });
  });
}

// ─── OAuth popup ───
function connectOAuth(providerKey, authType) {
  const oauthPath = authType === 'oauth_tiktok'
    ? `/auth/tiktok/start`
    : `/auth/meta/start?provider=${providerKey}`;

  const w = 620, h = 700;
  const left = Math.round((screen.width - w) / 2);
  const top = Math.round((screen.height - h) / 2);
  const popup = window.open(oauthPath, 'oauth_connect',
    `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`);

  if (!popup) {
    toast("El navegador bloqueó la ventana emergente. Permite pop-ups para este sitio.", "error", 5000);
    return;
  }

  const handler = async (e) => {
    if (e.data?.type === 'oauth_success') {
      window.removeEventListener('message', handler);
      await loadIntegrations();
      toast("Conectado correctamente", "success");
      openRoutingModal(e.data.integrationId);
    } else if (e.data?.type === 'oauth_error') {
      window.removeEventListener('message', handler);
      toast(e.data.error || "Error al conectar", "error", 6000);
    }
  };
  window.addEventListener('message', handler);
}

// ─── Modal manual (Telegram, WhatsApp API, WooCommerce, Shopify, Square) ───
let QR_POLL_INTERVAL = null;
let QR_PENDING_ID = null;        // id de la integración en proceso de QR
let QR_CONFIRMED = false;        // se prendió cuando Baileys reportó 'connected'
function stopQrPolling() {
  if (QR_POLL_INTERVAL) { clearInterval(QR_POLL_INTERVAL); QR_POLL_INTERVAL = null; }
}

// Si el usuario cerró el modal sin completar el escaneo, abortar la sesión:
// llamar DELETE al backend para que detenga Baileys, borre auth files y elimine
// el row pendiente. Sin esto el row queda en 'connecting' y la sesión sigue
// generando QRs en background.
async function abortPendingQrIfNeeded() {
  if (!QR_PENDING_ID || QR_CONFIRMED) {
    QR_PENDING_ID = null;
    QR_CONFIRMED = false;
    return;
  }
  const id = QR_PENDING_ID;
  QR_PENDING_ID = null;
  QR_CONFIRMED = false;
  try {
    await api('DELETE', `/api/integrations/${id}`);
  } catch (err) {
    console.warn('[qr abort] no se pudo eliminar pending:', err.message);
  }
}

function openIntegrationModal(providerKey, instanceId = null) {
  const provider = INTEGRATIONS.find((p) => p.key === providerKey);
  if (!provider) return;
  const instance = instanceId ? provider.integrations.find((i) => i.id === instanceId) : null;
  INT_EDIT = { provider, instance };
  stopQrPolling();

  const modalIcon = document.getElementById("intModalIcon");
  const iconSvg = PROVIDER_ICONS[provider.key];
  if (iconSvg) { modalIcon.innerHTML = iconSvg; } else { modalIcon.textContent = provider.initial || provider.name[0]; }
  modalIcon.style.background = provider.color;
  document.getElementById("intModalTitle").textContent = instance ? `Editar ${provider.name}` : `Conectar ${provider.name}`;
  document.getElementById("intModalDesc").textContent = provider.description;

  // Setup steps (solo al conectar por primera vez, no al editar)
  const stepsBox = document.getElementById("intSetupSteps");
  const steps = provider.setupSteps || [];
  if (stepsBox) {
    if (!instance && steps.length) {
      stepsBox.innerHTML = `<p class="int-steps-title">Cómo conectar</p><ol class="int-steps-list">${
        steps.map(s => `<li>${s}</li>`).join('')
      }</ol>`;
      stepsBox.hidden = false;
    } else {
      stepsBox.hidden = true;
    }
  }

  const fields = document.getElementById("intFormFields");
  const values = instance?.credentials || {};
  fields.innerHTML = (provider.fields || []).map((f) => {
    const val = values[f.key] || "";
    const inputType = f.type === "textarea" ? "textarea" : (f.type === "password" ? "password" : "text");
    const req = f.required ? '<span class="int-field-required">*</span>' : '';
    const help = f.help ? `<div class="int-field-help">${escapeHtml(f.help)}</div>` : "";
    if (inputType === "textarea") return `<div class="int-field"><label>${escapeHtml(f.label)}${req}</label><textarea name="${f.key}" rows="3">${escapeHtml(val)}</textarea>${help}</div>`;
    return `<div class="int-field"><label>${escapeHtml(f.label)}${req}</label><input type="${inputType}" name="${f.key}" value="${escapeHtml(val)}" autocomplete="off" />${help}</div>`;
  }).join("");

  // Webhook URL — mostrar siempre (al conectar usa la URL del provider, al editar usa la de la instancia)
  const webhookBox = document.getElementById("intWebhookBox");
  const baseUrl = window.location.origin;
  const webhookUrl = instance?.webhookUrl || `${baseUrl}/webhooks/${provider.key}`;
  document.getElementById("intWebhookUrl").textContent = webhookUrl;
  const evts = provider.webhooks?.events?.join(", ");
  document.getElementById("intWebhookEvents").textContent = evts ? `Eventos: ${evts}` : "";
  // Para Telegram no hay webhook manual (se registra automático), ocultamos la caja
  webhookBox.hidden = provider.key === 'telegram';
  document.getElementById("intWebhookBox").querySelector("h4").textContent =
    provider.key === 'messenger' || provider.key === 'instagram'
      ? "URL del Webhook — pégala en Meta for Developers"
      : "URL del Webhook";

  document.getElementById("intError").hidden = true;
  document.getElementById("intDocsLink").href = provider.docsUrl || "#";
  document.getElementById("intDocsLink").hidden = !provider.docsUrl;
  document.getElementById("intDisconnectBtn").hidden = !instance;
  document.getElementById("intSubmitBtn").textContent = instance ? "Guardar cambios" : "Conectar";

  // ─── Modo QR (whatsapp-lite): oculta form y webhook box ───
  const qrBox = document.getElementById("intQrBox");
  const isQrProvider = provider.authType === 'qr';
  const isQrConnect = isQrProvider && !instance;
  if (qrBox) {
    qrBox.hidden = !isQrProvider;
    if (isQrProvider) {
      document.getElementById("intFormFields").hidden = true;
      document.getElementById("intWebhookBox").hidden = true;
      const refreshBtn = document.getElementById("intQrRefreshBtn");
      if (isQrConnect) {
        document.getElementById("intSubmitBtn").textContent = "Generar QR";
        document.getElementById("intSubmitBtn").hidden = false;
        if (refreshBtn) refreshBtn.style.display = "none";
        document.getElementById("intQrStatus").textContent = 'Click "Generar QR" para empezar';
        document.getElementById("intQrStatus").className = "int-qr-status";
        // Sin spinner ni QR hasta que el usuario haga click en el botón
        const wrap = document.getElementById("intQrImageWrap");
        wrap.innerHTML = '<div style="font-size:48px;opacity:.3">📱</div>';
        wrap.style.background = "#f8fafc";
      } else {
        // Ya conectado: mostrar estado, sin QR ni botón submit
        document.getElementById("intSubmitBtn").hidden = true;
        if (refreshBtn) refreshBtn.style.display = "inline-flex";
        const phone = instance.externalId || '';
        document.getElementById("intQrStatus").textContent = phone ? `✓ Conectado como +${phone}` : '✓ Conectado';
        document.getElementById("intQrStatus").className = "int-qr-status is-ok";
        document.getElementById("intQrImageWrap").innerHTML = '<div style="font-size:64px">📱</div>';
      }
    } else {
      document.getElementById("intFormFields").hidden = false;
      document.getElementById("intSubmitBtn").hidden = false;
    }
  }

  document.getElementById("integrationModal").hidden = false;
}

function closeIntegrationModal() {
  stopQrPolling();
  // Si había un QR pendiente sin confirmar, abortar (limpia row + sesión backend)
  abortPendingQrIfNeeded().then(() => loadIntegrations()).catch(() => {});
  document.getElementById("integrationModal").hidden = true;
  INT_EDIT = null;
}

// ─── Flujo QR para whatsapp-lite ───
async function startQrFlow() {
  if (!INT_EDIT) return;
  const provider = INT_EDIT.provider;
  const statusEl = document.getElementById("intQrStatus");
  const imgWrap  = document.getElementById("intQrImageWrap");
  const submitBtn = document.getElementById("intSubmitBtn");
  const errBox = document.getElementById("intError");

  errBox.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Iniciando…";
  statusEl.textContent = "Iniciando sesión de WhatsApp Web…";
  statusEl.className = "int-qr-status";
  imgWrap.innerHTML = '<div class="int-qr-spinner"></div>';

  let integrationId = null;
  try {
    const res = await api("POST", `/api/integrations/${provider.key}/connect`, {});
    integrationId = res?.item?.id;
    if (!integrationId) throw new Error("No se obtuvo el ID de la integración");
    INT_EDIT.instance = res.item; // recordar para refrescar al conectar
    QR_PENDING_ID = integrationId;
    QR_CONFIRMED = false;
  } catch (err) {
    errBox.textContent = err.message; errBox.hidden = false;
    submitBtn.disabled = false;
    submitBtn.textContent = "Generar QR";
    statusEl.textContent = "Error al iniciar";
    statusEl.classList.add("is-error");
    return;
  }

  submitBtn.textContent = "Esperando escaneo…";
  let polls = 0;
  const MAX_POLLS = 100; // ~150s
  stopQrPolling();
  QR_POLL_INTERVAL = setInterval(async () => {
    polls++;
    if (polls > MAX_POLLS) {
      stopQrPolling();
      statusEl.textContent = "Tiempo agotado. Click \"Generar QR nuevo\".";
      statusEl.classList.add("is-error");
      submitBtn.disabled = false;
      submitBtn.textContent = "Generar QR";
      return;
    }
    try {
      const s = await api("GET", `/api/integrations/${integrationId}/qr-status`);
      if (s.liveStatus === 'qr' && s.qrDataUrl) {
        statusEl.textContent = "Escanea el QR desde tu WhatsApp";
        statusEl.className = "int-qr-status";
        const cur = imgWrap.querySelector("img");
        if (!cur || cur.src !== s.qrDataUrl) {
          imgWrap.innerHTML = `<img src="${s.qrDataUrl}" alt="QR de WhatsApp" />`;
        }
      } else if (s.liveStatus === 'connecting') {
        statusEl.textContent = "Conectando…";
      } else if (s.liveStatus === 'connected') {
        stopQrPolling();
        QR_CONFIRMED = true;          // ya escaneó — no abortar al cerrar modal
        statusEl.textContent = `✓ Conectado como +${s.phoneNumber || '?'}`;
        statusEl.classList.add("is-ok");
        toast(`WhatsApp Lite conectado +${s.phoneNumber || ''}`, "success");
        setTimeout(async () => {
          closeIntegrationModal();
          await loadIntegrations();
          openRoutingModal(integrationId);
        }, 800);
      } else if (s.liveStatus === 'disconnected' || s.liveStatus === 'error' || s.liveStatus === 'not_started') {
        stopQrPolling();
        statusEl.textContent = s.lastError || "Sesión desconectada. Genera un QR nuevo.";
        statusEl.classList.add("is-error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Generar QR";
      }
    } catch (err) {
      console.warn("[qr poll] err:", err.message);
    }
  }, 1500);
}

// ─── Modal de routing (pipeline / etapa) ───
function openRoutingModal(integrationId) {
  ROUTING_INTEGRATION_ID = integrationId;

  // Poblar select de pipelines
  const pipelineSel = document.getElementById("routingPipelineSelect");
  pipelineSel.innerHTML = PIPELINES.map((p) =>
    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
  ).join("");

  function updateStages() {
    const pid = Number(pipelineSel.value);
    const pipeline = PIPELINES.find((p) => p.id === pid);
    const stageSel = document.getElementById("routingStageSelect");
    stageSel.innerHTML = (pipeline?.stages || []).map((s) =>
      `<option value="${s.id}">${escapeHtml(s.name)}</option>`
    ).join("");
  }
  pipelineSel.onchange = updateStages;
  updateStages();

  // Pre-seleccionar routing actual si existe
  const allInst = INTEGRATIONS.flatMap((p) => p.integrations || []);
  const inst = allInst.find((i) => i.id === integrationId);
  if (inst?.routing?.pipelineId) {
    pipelineSel.value = inst.routing.pipelineId;
    updateStages();
    const stageSel = document.getElementById("routingStageSelect");
    stageSel.value = inst.routing.stageId;
  }

  document.getElementById("routingModal").hidden = false;
}

function closeRoutingModal() {
  document.getElementById("routingModal").hidden = true;
  ROUTING_INTEGRATION_ID = null;
}

async function saveRouting(skip = false) {
  if (!ROUTING_INTEGRATION_ID) { closeRoutingModal(); return; }

  if (skip) {
    closeRoutingModal();
    toast("Se usará el primer pipeline disponible por defecto", "info", 3000);
    return;
  }

  const pipelineSel = document.getElementById("routingPipelineSelect");
  const stageSel = document.getElementById("routingStageSelect");
  const pipelineId = Number(pipelineSel.value);
  const stageId = Number(stageSel.value);
  const pipeline = PIPELINES.find((p) => p.id === pipelineId);
  const stage = pipeline?.stages?.find((s) => s.id === stageId);

  try {
    await api("PATCH", `/api/integrations/${ROUTING_INTEGRATION_ID}/routing`, {
      pipelineId, stageId,
      pipelineName: pipeline?.name || '',
      stageName: stage?.name || '',
    });
    await loadIntegrations();
    closeRoutingModal();
    toast("Pipeline configurado correctamente", "success");
  } catch (err) {
    toast(`Error: ${err.message}`, "error");
  }
}

// ─── Outgoing webhooks card + modal ───
function renderOutgoingWebhooksCard() {
  const whIcon = `<svg viewBox="0 0 24 24" fill="white" width="22" height="22"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="white" stroke-width="1.5" fill="none"/></svg>`;
  const listHtml = OUTGOING_WEBHOOKS.map((wh) => `
    <div class="int-account-row wh-row" data-wh-id="${wh.id}">
      <div class="wh-active-dot ${wh.active ? 'is-on' : ''}"></div>
      <div class="int-account-info">
        <div class="int-account-name">${escapeHtml(wh.name)}</div>
        <div class="int-account-meta wh-url">${escapeHtml(wh.url)}</div>
      </div>
      <button class="btn btn--xs btn--ghost" data-action="edit-wh" data-id="${wh.id}">Editar</button>
    </div>`).join("");

  return `
    <div class="int-card int-card--webhooks">
      <div class="int-card-head">
        <span class="int-icon int-icon--webhook">${whIcon}</span>
        <div class="int-name">Webhooks salientes</div>
      </div>
      <p class="int-desc">Notifica URLs externas (Zapier, Make, tu propio servidor) cuando ocurren eventos en Reelance.</p>
      ${listHtml ? `<div class="int-accounts" id="whList">${listHtml}</div>` : ''}
      <div class="int-card-actions">
        <button class="btn btn--ghost" data-action="add-wh">+ Agregar webhook</button>
      </div>
    </div>`;
}

function renderOutgoingWebhooks() {
  const root = document.getElementById("integrationsGrid");
  if (!root) return;
  // Re-render solo el card de webhooks si ya existe
  const existing = root.querySelector('.int-card--webhooks');
  if (existing) {
    existing.outerHTML = renderOutgoingWebhooksCard();
    bindOutgoingWebhookCardListeners(root);
  }
}

function bindOutgoingWebhookCardListeners(root) {
  root.querySelector('[data-action="add-wh"]')?.addEventListener("click", () => openWebhookModal(null));
  root.querySelectorAll('[data-action="edit-wh"]').forEach((btn) => {
    btn.addEventListener("click", () => openWebhookModal(Number(btn.dataset.id)));
  });
}

function openWebhookModal(whId) {
  WH_EDIT = whId ? OUTGOING_WEBHOOKS.find((w) => w.id === whId) : null;

  document.getElementById("whModalTitle").textContent = WH_EDIT ? "Editar Webhook" : "Agregar Webhook";
  document.getElementById("whName").value = WH_EDIT?.name || "";
  document.getElementById("whUrl").value = WH_EDIT?.url || "";
  document.getElementById("whSecret").value = "";
  document.getElementById("whDeleteBtn").hidden = !WH_EDIT;
  document.getElementById("whError").hidden = true;

  const selectedEvents = WH_EDIT?.events || ['message.received'];
  document.getElementById("whEvents").innerHTML = ALL_WH_EVENTS.map((ev) => `
    <label class="wh-event-check">
      <input type="checkbox" name="events" value="${ev.key}" ${selectedEvents.includes(ev.key) ? 'checked' : ''}/>
      ${escapeHtml(ev.label)}
    </label>`).join("");

  document.getElementById("whModal").hidden = false;
}

function closeWebhookModal() {
  document.getElementById("whModal").hidden = true;
  WH_EDIT = null;
}

function setupIntegrations() {
  document.querySelectorAll("[data-close-int]").forEach((el) => el.addEventListener("click", closeIntegrationModal));
  document.querySelectorAll("[data-close-routing]").forEach((el) => el.addEventListener("click", closeRoutingModal));
  document.querySelectorAll("[data-close-wh]").forEach((el) => el.addEventListener("click", closeWebhookModal));

  document.getElementById("intWebhookCopy")?.addEventListener("click", async () => {
    const url = document.getElementById("intWebhookUrl").textContent;
    try { await navigator.clipboard.writeText(url); toast("URL copiada", "success", 2000); }
    catch (_) { toast("No pude copiar", "error"); }
  });

  document.getElementById("integrationForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!INT_EDIT) return;
    // Modo QR: el "submit" arranca el flujo de QR — no envía credenciales
    if (INT_EDIT.provider.authType === 'qr' && !INT_EDIT.instance) {
      return startQrFlow();
    }
    const fd = new FormData(e.target);
    const payload = {};
    for (const f of INT_EDIT.provider.fields) {
      const v = fd.get(f.key);
      if (v != null) payload[f.key] = String(v).trim();
    }
    const errBox = document.getElementById("intError");
    const submitBtn = document.getElementById("intSubmitBtn");
    errBox.hidden = true;
    submitBtn.disabled = true;
    const orig = submitBtn.textContent;
    submitBtn.textContent = "Validando…";
    try {
      if (INT_EDIT.instance) {
        await api("PATCH", `/api/integrations/${INT_EDIT.instance.id}`, payload);
        closeIntegrationModal();
        await loadIntegrations();
        toast(`${INT_EDIT.provider.name} actualizado`, "success");
      } else {
        const res = await api("POST", `/api/integrations/${INT_EDIT.provider.key}/connect`, payload);
        closeIntegrationModal();
        await loadIntegrations();
        toast(`${INT_EDIT.provider.name} conectado`, "success");
        if (res?.item?.id) openRoutingModal(res.item.id);
      }
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = orig;
    }
  });

  document.getElementById("intQrRefreshBtn")?.addEventListener("click", () => startQrFlow());

  document.getElementById("intDisconnectBtn")?.addEventListener("click", async () => {
    if (!INT_EDIT?.instance) return;
    if (!confirm(`¿Desconectar ${INT_EDIT.instance.displayName || INT_EDIT.provider.name}?`)) return;
    try {
      await api("DELETE", `/api/integrations/${INT_EDIT.instance.id}`);
      closeIntegrationModal();
      await loadIntegrations();
      toast("Integración desconectada", "success");
    } catch (err) { toast(`Error: ${err.message}`, "error"); }
  });

  document.getElementById("routingSaveBtn")?.addEventListener("click", () => saveRouting(false));
  document.getElementById("routingSkipBtn")?.addEventListener("click", () => saveRouting(true));

  document.getElementById("whForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("whName").value.trim();
    const url = document.getElementById("whUrl").value.trim();
    const secret = document.getElementById("whSecret").value.trim();
    const events = [...document.querySelectorAll('#whEvents input[type=checkbox]:checked')].map((cb) => cb.value);
    const errBox = document.getElementById("whError");
    const btn = document.getElementById("whSubmitBtn");
    errBox.hidden = true;
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      if (WH_EDIT) {
        await api("PATCH", `/api/outgoing-webhooks/${WH_EDIT.id}`, { name, url, events, secret: secret || undefined });
        toast("Webhook actualizado", "success");
      } else {
        await api("POST", "/api/outgoing-webhooks", { name, url, events, secret: secret || undefined });
        toast("Webhook agregado", "success");
      }
      closeWebhookModal();
      await loadOutgoingWebhooks();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  });

  document.getElementById("whDeleteBtn")?.addEventListener("click", async () => {
    if (!WH_EDIT || !confirm(`¿Eliminar webhook "${WH_EDIT.name}"?`)) return;
    try {
      await api("DELETE", `/api/outgoing-webhooks/${WH_EDIT.id}`);
      closeWebhookModal();
      await loadOutgoingWebhooks();
      toast("Webhook eliminado", "success");
    } catch (err) { toast(`Error: ${err.message}`, "error"); }
  });
}

// ═══════ Expedientes ═══════

let EXP_STATE = { page: 1, pageSize: 50, search: '', sortBy: 'createdAt', sortDir: 'desc', total: 0 };
let EXP_EDIT = null;        // expediente en edición (null = nuevo)
let EXP_TAGS = [];          // tags del modal actual
let EXP_CONTACT_ID = null;  // contacto seleccionado en el modal
let EXP_FIELD_DEFS = [];    // definiciones de campos personalizados

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function loadExpedients() {
  const { page, pageSize, sortBy, sortDir } = EXP_STATE;
  const params = new URLSearchParams({ page, pageSize, sortBy, sortDir });
  // Text search — routed through EXP_FILTERS
  const effectiveSearch = EXP_FILTERS.q || EXP_STATE.search || '';
  if (effectiveSearch) params.set('search', effectiveSearch);
  if (EXP_FILTERS.tags.length) EXP_FILTERS.tags.forEach(t => params.append('tags', t));
  const nonEmptyFields = Object.fromEntries(Object.entries(EXP_FILTERS.fieldValues).filter(([, v]) => v !== ''));
  if (Object.keys(nonEmptyFields).length) params.set('fieldFilters', JSON.stringify(nonEmptyFields));
  try {
    const data = await api('GET', `/api/expedients?${params}`);
    EXP_STATE.total = data.total;
    EXP_STATE.totalPages = data.totalPages;
    renderExpedientRows(data.items);
    renderExpPaginator(data);
  } catch (err) { console.error('Error cargando expedientes:', err); }
}

async function loadExpFieldDefs() {
  try {
    const data = await api('GET', '/api/expedients/field-defs');
    EXP_FIELD_DEFS = data.items;
  } catch (err) { console.error('Error cargando campos:', err); }
}

function renderExpedientRows(items) {
  const tbody = document.getElementById('expTableBody');
  const empty = document.getElementById('expEmpty');
  const paginator = document.getElementById('expPaginator');
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    paginator.hidden = true;
    return;
  }
  empty.hidden = true;
  paginator.hidden = false;
  tbody.innerHTML = items.map((exp) => {
    const tagsHtml = exp.tags.map((t) => `<span class="exp-tag">${escapeHtml(t)}</span>`).join('') || '—';
    const stageColor = exp.stageKind === 'won' ? '#10b981' : exp.stageKind === 'lost' ? '#ef4444' : '#2563eb';
    return `
      <tr data-exp-id="${exp.id}" style="cursor:pointer">
        <td>
          <div class="exp-name${exp.nameIsAuto ? ' is-auto-name' : ''}">${escapeHtml(exp.name || 'Sin nombre')}</div>
        </td>
        <td><div class="exp-contact">${escapeHtml(exp.contactName || '—')}</div></td>
        <td>
          <span class="exp-pipeline-badge" style="background:${stageColor}18;color:${stageColor}">
            ${escapeHtml(exp.pipelineName || '')} › ${escapeHtml(exp.stageName || '')}
          </span>
        </td>
        <td>${tagsHtml}</td>
        <td><span class="exp-date">${fmtDate(exp.createdAt)}</span></td>
        <td>
          <div class="exp-actions">
            <button class="btn btn--xs btn--ghost" data-action="edit-exp" data-id="${exp.id}">Editar</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('tr[data-exp-id]').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="edit-exp"]')) return;
      openExpDetail(Number(row.dataset.expId));
    });
  });
  tbody.querySelectorAll('[data-action="edit-exp"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openExpModal(Number(btn.dataset.id));
    });
  });
}

function renderExpPaginator({ page, pageSize, total, totalPages }) {
  document.getElementById('expPageInfo').textContent = `${(page-1)*pageSize+1}–${Math.min(page*pageSize,total)} de ${total}`;
  const prev = document.getElementById('expPagePrev');
  const next = document.getElementById('expPageNext');
  prev.disabled = page <= 1;
  next.disabled = page >= totalPages;
  prev.onclick = () => { EXP_STATE.page--; loadExpedients(); };
  next.onclick = () => { EXP_STATE.page++; loadExpedients(); };
  // Números de página
  const pages = document.getElementById('expPageNumbers');
  const nums = [];
  for (let i = Math.max(1, page-2); i <= Math.min(totalPages, page+2); i++) nums.push(i);
  pages.innerHTML = nums.map((n) => `<button class="paginator-page${n===page?' is-active':''}" data-p="${n}">${n}</button>`).join('');
  pages.querySelectorAll('[data-p]').forEach((btn) => {
    btn.addEventListener('click', () => { EXP_STATE.page = Number(btn.dataset.p); loadExpedients(); });
  });
}

// ═══════ Detalle de expediente ═══════
let EXP_DETAIL = null;          // expedient actual en el detalle
let EXP_DETAIL_CONVOS = [];     // conversaciones del contacto
let EXP_DETAIL_CONVO_ID = null; // conversación activa en el detalle
let EXP_DETAIL_MSGS = [];       // mensajes de la convo activa
let EXP_DETAIL_ACTIVITY = [];   // actividad del expediente
let _chatSearchQuery = '';      // búsqueda activa en el chat del expediente
let EXP_DETAIL_FROM = 'expedientes'; // vista desde la que se abrió

async function openExpDetail(id, from = 'expedientes') {
  try {
    const [expData] = await Promise.all([
      api('GET', `/api/expedients/${id}`),
      loadExpFieldDefs(),
    ]);
    EXP_DETAIL = expData.item;
    EXP_DETAIL_FROM = from;
  } catch (err) { toast('Error cargando expediente', 'error'); return; }

  // Persist so page refresh restores this view
  localStorage.setItem('lastView', 'exp-detail');
  localStorage.setItem('lastExpDetailId', id);
  localStorage.setItem('lastExpDetailFrom', from);

  // Update back button label
  const backLbl = document.querySelector('.exp-detail-back-label');
  if (backLbl) backLbl.textContent = from === 'pipelines' ? 'Pipeline' : 'Expedientes';

  showView('exp-detail');
  renderExpDetailInfo();
  renderExpDetailBots();
  await loadExpDetailConvos();
}

function renderExpDetailInfo() {
  const exp = EXP_DETAIL;
  if (!exp) return;
  const root = document.getElementById('expDetailInfo');
  if (!root) return;

  const savedValues = {};
  (exp.fieldValues || []).forEach((fv) => { savedValues[fv.fieldId] = fv.value; });

  const customFields = (EXP_FIELD_DEFS || []).filter((d) => d.entity === 'expedient' || !d.entity);

  // Build pipeline + stage selects
  const pipelineOptions = PIPELINES.map((p) =>
    `<option value="${p.id}" ${p.id === exp.pipelineId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
  const currentPipeline = PIPELINES.find((p) => p.id === exp.pipelineId) || PIPELINES[0];
  const stageOptions = (currentPipeline?.stages || []).map((s) =>
    `<option value="${s.id}" ${s.id === exp.stageId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  const customFieldsHtml = customFields.map((def) => {
    const val = savedValues[def.id] ?? '';
    const displayVal = val ? escapeHtml(val) : '<span class="edf-empty">—</span>';

    let inputHtml;
    if (def.fieldType === 'date' || def.fieldType === 'birthday') {
      inputHtml = `<input class="edf-input" type="date" value="${escapeHtml(val)}" data-original="${escapeHtml(val)}" />`;
    } else if (def.fieldType === 'datetime') {
      inputHtml = `<input class="edf-input" type="datetime-local" value="${escapeHtml(val)}" data-original="${escapeHtml(val)}" />`;
    } else if (def.fieldType === 'number') {
      inputHtml = `<input class="edf-input" type="number" value="${escapeHtml(val)}" data-original="${escapeHtml(val)}" />`;
    } else if (def.fieldType === 'select' && def.options?.length) {
      const opts = def.options.map(o => `<option value="${escapeHtml(o)}" ${o === val ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
      inputHtml = `<select class="edf-input edf-select" data-original="${escapeHtml(val)}">${opts}</select>`;
    } else {
      inputHtml = `<input class="edf-input" type="text" value="${escapeHtml(val)}" data-original="${escapeHtml(val)}" />`;
    }

    return `
    <div class="exp-detail-field editable-field" data-field-id="${def.id}" data-field-type="custom">
      <span class="exp-detail-field-label">${escapeHtml(def.label)}</span>
      <div class="edf-cell">
        <span class="exp-detail-field-value edf-display">${displayVal}</span>
        ${inputHtml}
      </div>
    </div>`;
  }).join('');

  // Stage options with color dots rendered via JS after insert (select can't have colored options cross-browser)
  // We'll use a custom stage selector instead
  const stageOptionsHtml = (currentPipeline?.stages || []).map((s) =>
    `<option value="${s.id}" data-color="${s.color}" ${s.id === exp.stageId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
  ).join('');

  root.innerHTML = `
    <div class="exp-detail-section">
      <div class="exp-detail-section-title">Expediente</div>
      <div class="exp-detail-field editable-field" data-field-id="name" data-field-type="builtin">
        <span class="exp-detail-field-label">Nombre</span>
        <div class="edf-cell">
          <span class="exp-detail-field-value edf-display${exp.nameIsAuto ? ' is-auto-name' : ''}">${escapeHtml(exp.name || '—')}</span>
          <input class="edf-input" type="text" value="${escapeHtml(exp.nameIsAuto ? '' : exp.name || '')}" placeholder="Nombre del expediente" data-original="${escapeHtml(exp.nameIsAuto ? '' : exp.name || '')}" />
        </div>
      </div>
      <div class="exp-detail-field editable-field" data-field-id="pipeline" data-field-type="builtin">
        <span class="exp-detail-field-label">Pipeline</span>
        <div class="edf-cell">
          <span class="exp-detail-field-value edf-display">
            <span class="exp-detail-stage-badge">
              <span class="edf-stage-dot" style="background:${exp.pipelineColor || '#94a3b8'}"></span>
              ${escapeHtml(exp.pipelineName || '—')}
            </span>
          </span>
          <select class="edf-input edf-select" id="edfPipelineSel" data-original="${exp.pipelineId}">${pipelineOptions}</select>
        </div>
      </div>
      <div class="exp-detail-field editable-field" data-field-id="stage" data-field-type="builtin">
        <span class="exp-detail-field-label">Etapa</span>
        <div class="edf-cell">
          <span class="exp-detail-field-value edf-display">
            <span class="exp-detail-stage-badge">
              <span class="edf-stage-dot" style="background:${exp.stageColor || '#94a3b8'}"></span>
              ${escapeHtml(exp.stageName || '—')}
            </span>
          </span>
          <select class="edf-input edf-select edf-stage-sel" id="edfStageSel" data-original="${exp.stageId}">${stageOptionsHtml}</select>
        </div>
      </div>
    </div>

    <div class="exp-detail-section">
      <div class="exp-detail-section-title">Contacto</div>
      <div class="exp-detail-field editable-field" data-field-id="contactName" data-field-type="builtin">
        <span class="exp-detail-field-label">Nombre</span>
        <div class="edf-cell">
          <span class="exp-detail-field-value edf-display">${escapeHtml(exp.contactName || '—')}</span>
          <input class="edf-input" type="text" value="${escapeHtml(exp.contactName || '')}" data-original="${escapeHtml(exp.contactName || '')}" />
        </div>
      </div>
    </div>

    ${customFields.length ? `
    <div class="exp-detail-section">
      <div class="exp-detail-section-title">Campos personalizados</div>
      ${customFieldsHtml}
    </div>` : ''}

    <div class="exp-detail-actions-bar" id="expDetailActionsBar" hidden>
      <button class="btn btn--primary btn--sm" id="expDetailSaveBtn">Guardar</button>
      <button class="btn btn--ghost btn--sm" id="expDetailCancelBtn">Cancelar</button>
    </div>`;

  setupExpDetailEditing();
}

let _botRunsTimer = null;

function _stopBotRunsPolling() {
  if (_botRunsTimer) { clearInterval(_botRunsTimer); _botRunsTimer = null; }
}

async function renderExpDetailBots() {
  const root = document.getElementById('expDetailBots');
  if (!root || !EXP_DETAIL) return;

  const TRIGGER_LABEL = {
    keyword:        'Palabra clave',
    new_contact:    'Nuevo contacto',
    pipeline_stage: 'Entra a etapa',
    always:         'Cualquier mensaje',
    outbound:       'Manual',
  };

  function fmtDuration(startedAt, finishedAt) {
    const secs = (finishedAt || Math.floor(Date.now() / 1000)) - startedAt;
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }

  function fmtRelTime(ts) {
    if (!ts) return '';
    const secs = Math.floor(Date.now() / 1000) - ts;
    if (secs < 60) return 'hace un momento';
    if (secs < 3600) return `hace ${Math.floor(secs / 60)} min`;
    if (secs < 86400) return `hace ${Math.floor(secs / 3600)} h`;
    return new Date(ts * 1000).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  }

  async function refresh() {
    const expId = EXP_DETAIL?.id;
    if (!expId) { _stopBotRunsPolling(); return; }

    try {
      const runsData = await api('GET', `/api/expedients/${expId}/bot-runs`);
      const runs = runsData.items || [];
      const activeRuns = runs.filter(r => r.status === 'running' || r.status === 'paused');
      const hasRunning  = activeRuns.length > 0;

      // Auto-poll mientras haya bots activos; detener cuando terminen
      if (hasRunning && !_botRunsTimer) {
        _botRunsTimer = setInterval(refresh, 1500);
      } else if (!hasRunning && _botRunsTimer) {
        _stopBotRunsPolling();
      }

      // Si no hay nada activo, ocultar la sección
      if (!hasRunning) {
        root.innerHTML = '';
        return;
      }

      const pctOf = r => r.total_steps ? Math.round((r.current_step / r.total_steps) * 100) : 0;

      root.innerHTML = `
        <div class="exp-detail-section exp-bots-section">
          <div class="exp-detail-section-title">Corriendo ahora</div>
          ${activeRuns.map(r => `
            <div class="exp-run-row exp-run-running" data-run-id="${r.id}">
              <div class="exp-run-header">
                <span class="exp-run-pulse${r.status === 'paused' ? ' exp-run-pulse--paused' : ''}"></span>
                <span class="exp-run-name">${escapeHtml(r.bot_name || 'Bot')}</span>
                <span class="exp-run-meta">paso ${r.current_step}/${r.total_steps}</span>
                <div class="exp-run-actions">
                  <button class="exp-run-btn exp-run-btn--pause" data-run-id="${r.id}" data-paused="${r.status === 'paused' ? '1' : '0'}" title="${r.status === 'paused' ? 'Reanudar' : 'Pausar'}">
                    ${r.status === 'paused'
                      ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'
                      : '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'}
                  </button>
                  <button class="exp-run-btn exp-run-btn--kill" data-run-id="${r.id}" title="Terminar bot">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              </div>
              <div class="exp-run-bar-wrap">
                <div class="exp-run-bar${r.status === 'paused' ? ' exp-run-bar--paused' : ''}" style="width:${pctOf(r)}%"></div>
              </div>
            </div>`).join('')}
        </div>`;

      async function reloadActivity() {
        if (!EXP_DETAIL) return;
        try {
          const actData = await api('GET', `/api/expedients/${EXP_DETAIL.id}/activity`);
          EXP_DETAIL_ACTIVITY = actData.items || [];
          renderExpDetailMessages();
        } catch (_) {}
      }

      // Bind kill/pause buttons
      root.querySelectorAll('.exp-run-btn--kill').forEach(btn => {
        btn.addEventListener('click', async () => {
          const runId = btn.dataset.runId;
          btn.disabled = true;
          try { await api('POST', `/api/bot/runs/${runId}/kill`); } catch (_) {}
          await Promise.all([reloadActivity(), refresh()]);
        });
      });
      root.querySelectorAll('.exp-run-btn--pause').forEach(btn => {
        btn.addEventListener('click', async () => {
          const runId = btn.dataset.runId;
          const isPaused = btn.dataset.paused === '1';
          btn.disabled = true;
          try {
            await api('POST', `/api/bot/runs/${runId}/${isPaused ? 'resume' : 'pause'}`);
          } catch (_) {}
          await Promise.all([reloadActivity(), refresh()]);
        });
      });

    } catch (err) {
      // silencioso si falla
    }
  }

  _stopBotRunsPolling();
  await refresh();
}

function updateStageDot(stageSel) {
  if (!stageSel) return;
  const selected = stageSel.options[stageSel.selectedIndex];
  const color = selected?.dataset.color || '#94a3b8';
  // Actualiza el dot del badge en display mode en tiempo real
  const displayDot = stageSel.closest('.edf-cell')?.querySelector('.edf-stage-dot');
  if (displayDot) displayDot.style.background = color;
}

// ── Picker modal genérico (pipeline / etapa) ──
function openOptionPicker({ title, options, currentValue, onSelect }) {
  const modal = document.getElementById('optionPickerModal');
  const titleEl = document.getElementById('optionPickerTitle');
  const listEl = document.getElementById('optionPickerList');
  if (!modal || !titleEl || !listEl) return;

  titleEl.textContent = title || 'Selecciona';
  listEl.innerHTML = options.map((o) => `
    <button type="button" class="option-picker-row${String(o.value) === String(currentValue) ? ' is-selected' : ''}" data-val="${escapeHtml(String(o.value))}">
      ${o.color ? `<span class="option-picker-dot" style="background:${escapeHtml(o.color)}"></span>` : ''}
      <span class="option-picker-label">${escapeHtml(o.label)}</span>
      ${String(o.value) === String(currentValue) ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16" class="option-picker-check"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </button>
  `).join('');

  const close = () => {
    modal.hidden = true;
    listEl.innerHTML = '';
    modal.querySelectorAll('[data-close-picker]').forEach(el => el.removeEventListener('click', close));
    listEl.removeEventListener('click', onRowClick);
    document.removeEventListener('keydown', onKey);
  };
  const onRowClick = (e) => {
    const row = e.target.closest('.option-picker-row');
    if (!row) return;
    const val = row.dataset.val;
    close();
    onSelect(val);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  modal.querySelectorAll('[data-close-picker]').forEach(el => el.addEventListener('click', close));
  listEl.addEventListener('click', onRowClick);
  document.addEventListener('keydown', onKey);
  modal.hidden = false;
}

function openPipelinePicker() {
  const sel = document.getElementById('edfPipelineSel');
  if (!sel) return;
  openOptionPicker({
    title: 'Selecciona un pipeline',
    options: PIPELINES.map(p => ({ value: p.id, label: p.name, color: p.color || '#94a3b8' })),
    currentValue: sel.value,
    onSelect: (val) => {
      if (String(val) === String(sel.value)) return;
      sel.value = val;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      const p = PIPELINES.find(x => String(x.id) === String(val));
      const display = document.querySelector('.editable-field[data-field-id="pipeline"] .edf-display');
      if (display && p) {
        display.innerHTML = `<span class="exp-detail-stage-badge"><span class="edf-stage-dot" style="background:${p.color || '#94a3b8'}"></span>${escapeHtml(p.name)}</span>`;
      }
    }
  });
}

function openStagePicker() {
  const stageSel = document.getElementById('edfStageSel');
  const pipelineSel = document.getElementById('edfPipelineSel');
  if (!stageSel || !pipelineSel) { console.warn('[stage-picker] selects no encontrados'); return; }
  let pipeline = PIPELINES.find(p => String(p.id) === String(pipelineSel.value));
  if (!pipeline) pipeline = PIPELINES.find(p => Array.isArray(p.stages) && p.stages.length) || PIPELINES[0];
  if (!pipeline) { console.warn('[stage-picker] no hay pipelines cargados'); return; }
  const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
  if (!stages.length) { console.warn('[stage-picker] el pipeline no tiene etapas', pipeline); return; }
  openOptionPicker({
    title: `Etapa de "${pipeline.name}"`,
    options: stages.map(s => ({ value: s.id, label: s.name, color: s.color || '#94a3b8' })),
    currentValue: stageSel.value,
    onSelect: (val) => {
      if (String(val) === String(stageSel.value)) return;
      stageSel.value = val;
      stageSel.dispatchEvent(new Event('change', { bubbles: true }));
      const stage = stages.find(s => String(s.id) === String(val));
      const display = document.querySelector('.editable-field[data-field-id="stage"] .edf-display');
      if (display && stage) {
        display.innerHTML = `<span class="exp-detail-stage-badge"><span class="edf-stage-dot" style="background:${stage.color || '#94a3b8'}"></span>${escapeHtml(stage.name)}</span>`;
      }
    }
  });
}

function setupExpDetailEditing() {
  const root = document.getElementById('expDetailInfo');
  if (!root) return;

  const actionsBar = document.getElementById('expDetailActionsBar');

  // Update dot when stage select changes
  const stageSel = document.getElementById('edfStageSel');
  stageSel?.addEventListener('change', () => updateStageDot(stageSel));

  // Track which fields have pending changes
  function checkForChanges() {
    let hasChanges = false;
    root.querySelectorAll('.edf-input').forEach(input => {
      if (String(input.value) !== String(input.dataset.original || '')) hasChanges = true;
    });
    if (actionsBar) actionsBar.hidden = !hasChanges;
  }

  // Pipeline changes → reload stage options with colors
  const pipelineSel = document.getElementById('edfPipelineSel');
  pipelineSel?.addEventListener('change', () => {
    const pid = Number(pipelineSel.value);
    const pipeline = PIPELINES.find((p) => p.id === pid);
    const stageSel = document.getElementById('edfStageSel');
    if (stageSel && pipeline) {
      stageSel.innerHTML = pipeline.stages.map((s) =>
        `<option value="${s.id}" data-color="${s.color}">${escapeHtml(s.name)}</option>`
      ).join('');
      stageSel.value = '';
      updateStageDot(stageSel);
    }
    checkForChanges();
  });

  // Click on a field → enter edit mode (pipeline & stage open a picker modal instead)
  root.querySelectorAll('.editable-field').forEach((field) => {
    field.addEventListener('click', (e) => {
      if (e.target.closest('.edf-input') || e.target.closest('.exp-detail-actions-bar')) return;
      const fieldId = field.dataset.fieldId;
      if (fieldId === 'pipeline') { openPipelinePicker(); return; }
      if (fieldId === 'stage')    { openStagePicker();    return; }
      const cell = field.querySelector('.edf-cell');
      if (!cell) return;
      cell.classList.add('is-editing');
      const input = field.querySelector('.edf-input');
      if (input?.tagName === 'INPUT') { input.focus(); input.select(); }
    });
  });

  // Watch for actual value changes on all inputs/selects
  root.querySelectorAll('.edf-input').forEach(input => {
    input.addEventListener('input', checkForChanges);
    input.addEventListener('change', checkForChanges);
  });

  // Save button
  document.getElementById('expDetailSaveBtn')?.addEventListener('click', saveExpDetailEdits);

  // Cancel button
  document.getElementById('expDetailCancelBtn')?.addEventListener('click', () => {
    root.querySelectorAll('.edf-cell').forEach(cell => cell.classList.remove('is-editing'));
    root.querySelectorAll('.edf-input').forEach(input => { input.value = input.dataset.original || ''; });
    if (actionsBar) actionsBar.hidden = true;
  });

}

async function saveExpDetailEdits() {
  const exp = EXP_DETAIL;
  if (!exp) return;
  const root = document.getElementById('expDetailInfo');
  if (!root) return;

  const patch = {};

  // Built-in fields
  root.querySelectorAll('.editable-field[data-field-type="builtin"]').forEach((field) => {
    const fieldId = field.dataset.fieldId;
    const input = field.querySelector('.edf-input');
    if (!input) return;
    // Only include if value changed
    if (String(input.value) === String(input.dataset.original || '')) return;
    const val = input.value.trim();
    if (fieldId === 'name') patch.name = val;
    else if (fieldId === 'pipeline') patch.pipelineId = Number(input.value);
    else if (fieldId === 'stage') patch.stageId = Number(input.value);
    else if (fieldId === 'contactName') patch.contactName = val;
  });

  // Custom fields — only changed ones
  const fieldValues = {};
  root.querySelectorAll('.editable-field[data-field-type="custom"]').forEach((field) => {
    const input = field.querySelector('.edf-input');
    if (!input) return;
    if (String(input.value) === String(input.dataset.original || '')) return;
    fieldValues[field.dataset.fieldId] = input.value.trim();
  });
  if (Object.keys(fieldValues).length) patch.fieldValues = fieldValues;

  if (!Object.keys(patch).length) {
    document.getElementById('expDetailActionsBar').hidden = true;
    return;
  }

  try {
    const data = await api('PATCH', `/api/expedients/${exp.id}`, patch);
    EXP_DETAIL = data.item;
    toast('Guardado', 'success');
    renderExpDetailInfo();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadExpDetailConvos() {
  const exp = EXP_DETAIL;
  if (!exp?.contactId) return;
  try {
    const data = await api('GET', `/api/conversations?contactId=${exp.contactId}`);
    EXP_DETAIL_CONVOS = data.items || [];
  } catch (err) { EXP_DETAIL_CONVOS = []; }
  renderExpDetailConvoTabs();
  if (EXP_DETAIL_CONVOS.length) {
    await selectExpDetailConvo(EXP_DETAIL_CONVOS[0].id);
  }
}

function renderExpDetailConvoTabs() {
  const root = document.getElementById('expDetailConvoTabs');
  if (!root) return;
  if (!EXP_DETAIL_CONVOS.length) {
    root.innerHTML = '<span style="color:#64748b;font-size:12px">Sin conversaciones</span>';
    return;
  }
  root.innerHTML = EXP_DETAIL_CONVOS.map((c) => `
    <button class="exp-detail-convo-tab ${c.id === EXP_DETAIL_CONVO_ID ? 'is-active' : ''}" data-convo-id="${c.id}">
      <span class="rh-channel-dot rh-channel-${c.provider}"></span>
      ${escapeHtml(PROVIDER_LABEL[c.provider] || c.provider)}
      ${c.unreadCount ? `<span class="rh-chat-unread-dot"></span>` : ''}
    </button>
  `).join('');
  root.querySelectorAll('.exp-detail-convo-tab').forEach((btn) => {
    btn.addEventListener('click', () => selectExpDetailConvo(Number(btn.dataset.convoId)));
  });
}

async function selectExpDetailConvo(convoId) {
  EXP_DETAIL_CONVO_ID = convoId;
  _chatSearchQuery = '';
  const si = document.getElementById('expChatSearchInput');
  if (si) si.value = '';
  renderExpDetailConvoTabs();
  updateExpDetailBotToggle(null);

  // Mark read
  api('PATCH', `/api/conversations/${convoId}/read`).catch(() => {});

  try {
    const [msgData, actData] = await Promise.all([
      api('GET', `/api/conversations/${convoId}/messages`),
      EXP_DETAIL ? api('GET', `/api/expedients/${EXP_DETAIL.id}/activity`) : Promise.resolve({ items: [] }),
    ]);
    EXP_DETAIL_MSGS     = msgData.items || [];
    EXP_DETAIL_ACTIVITY = actData.items || [];
  } catch (err) { EXP_DETAIL_MSGS = []; EXP_DETAIL_ACTIVITY = []; }

  renderExpDetailMessages();

  // Hook reply form
  const form = document.getElementById('expDetailReplyForm');
  if (form) form.dataset.convoId = convoId;
}

function updateExpDetailBotToggle(_convo) { /* removed — replaced by chat search */ }

const ACT_ICON = {
  created:             '🗂',
  stage_change:        '↗',
  pipeline_change:     '⇄',
  bot_start:           '▶',
  bot_done:            '✓',
  bot_error:           '✕',
  bot_killed:          '✕',
  bot_paused_manual:   '⏸',
  bot_resumed:         '▶',
  name_change:         '✎',
  contact_name_change: '✎',
  phone_change:        '✎',
  tag_add:             '＋',
  tag_remove:          '－',
};

function highlightText(rawText, query) {
  const escaped = escapeHtml(rawText);
  if (!query) return escaped;
  const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(escapedQuery, 'gi'), m => `<mark class="rh-chat-hl">${m}</mark>`);
}

function _matchesSearch(item, q) {
  if (!q) return true;
  const lq = q.toLowerCase();
  if (item._kind === 'msg') {
    const body  = (item.body || '').toLowerCase();
    const tStr  = new Date(item.createdAt * 1000)
      .toLocaleString('es-MX', { day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit', hour12: false })
      .toLowerCase();
    return body.includes(lq) || tStr.includes(lq);
  }
  if (item._kind === 'act') {
    return (item.description || '').toLowerCase().includes(lq) ||
           (item.advisor_name || '').toLowerCase().includes(lq) ||
           (item.type || '').toLowerCase().includes(lq);
  }
  return false;
}

function renderExpDetailMessages() {
  const root = document.getElementById('expDetailMessages');
  if (!root) return;
  const checkSvg = `<span class="rh-msg-status rh-read"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/><polyline points="23 11 16 18 13 15" style="opacity:.7"/></svg></span>`;

  // Mezclar mensajes y actividad por timestamp
  const msgs = (EXP_DETAIL_MSGS || []).map(m => ({ _kind: 'msg', _ts: m.createdAt, ...m }));
  const acts = (EXP_DETAIL_ACTIVITY || []).map(a => ({ _kind: 'act', _ts: a.created_at, ...a }));
  const timeline = [...msgs, ...acts].sort((a, b) => a._ts !== b._ts ? a._ts - b._ts : (a._kind === 'act' ? -1 : 1));

  const q = _chatSearchQuery.trim();
  const visible = q ? timeline.filter(i => _matchesSearch(i, q)) : timeline;

  // Update search count badge
  const clearBtn = document.getElementById('expChatSearchClear');
  if (clearBtn) clearBtn.hidden = !q;
  const searchWrap = document.getElementById('expChatSearchWrap');
  if (searchWrap) {
    searchWrap.classList.toggle('has-results', q && visible.length > 0);
    searchWrap.classList.toggle('no-results', q && visible.length === 0);
    const badge = searchWrap.querySelector('.exp-chat-search-count');
    if (badge) badge.remove();
    if (q) {
      const b = document.createElement('span');
      b.className = 'exp-chat-search-count';
      b.textContent = visible.length ? `${visible.length}` : '0';
      searchWrap.appendChild(b);
    }
  }

  if (!visible.length) {
    root.innerHTML = q
      ? `<p class="rh-messages-empty">Sin resultados para "<em>${escapeHtml(q)}</em>".</p>`
      : '<p class="rh-messages-empty">No hay mensajes todavía.</p>';
    return;
  }

  const expConvo = EXP_DETAIL_CONVOS.find(c => c.id === EXP_DETAIL_CONVO_ID);
  const isWhatsappExp = expConvo?.provider === 'whatsapp';
  const lastIncomingItem = timeline.reduce((acc, item) =>
    (item._kind === 'msg' && item.direction === 'incoming') ? item : acc, null);

  root.innerHTML = visible.map((item) => {
    if (item._kind === 'act') {
      const icon = ACT_ICON[item.type] || '·';
      const time = item.created_at ? new Date(item.created_at * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
      const byLine = item.advisor_name ? `<span class="rh-act-by">${escapeHtml(item.advisor_name)}</span>` : '';
      return `<div class="rh-act-event" data-type="${item.type}">
        <span class="rh-act-icon">${icon}</span>
        <span class="rh-act-text">${highlightText(item.description, q)}${byLine}</span>
        <span class="rh-act-time">${time}</span>
      </div>`;
    }
    const dir = item.direction === 'incoming' ? 'incoming' : 'outgoing';
    const isLastIncoming = item === lastIncomingItem;
    const footExtra = isLastIncoming && isWhatsappExp ? wa24Html('whatsapp', item.createdAt) : '';
    const footContent = dir === 'incoming'
      ? `Contacto · <span class="rh-message-meta">${fmtMsgTime(item.createdAt)}</span>${footExtra}`
      : `<span class="rh-message-meta">${fmtMsgTime(item.createdAt)}${item.status === 'read' ? ' ' + checkSvg : ''}</span>`;
    return `
      <article class="rh-message rh-${dir}">
        <div class="rh-bubble">${highlightText(item.body, q).replace(/\n/g, '<br/>')}</div>
        <div class="rh-message-foot${dir === 'outgoing' ? ' rh-foot-out' : ''}">${footContent}</div>
      </article>`;
  }).join('');

  if (!q) root.scrollTop = root.scrollHeight;
}

function setupExpDetail() {
  // Back button uses origin view; clear saved exp-detail so refresh doesn't re-open it
  document.getElementById('expDetailBack')?.addEventListener('click', () => {
    _stopBotRunsPolling();
    localStorage.removeItem('lastExpDetailId');
    localStorage.setItem('lastView', EXP_DETAIL_FROM);
    showView(EXP_DETAIL_FROM);
  });

  // Delete button (lives in the static HTML, wired once)
  document.getElementById('expDetailDeleteBtn')?.addEventListener('click', async () => {
    if (!EXP_DETAIL) return;
    if (!confirm(`¿Eliminar el expediente "${EXP_DETAIL.name}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api('DELETE', `/api/expedients/${EXP_DETAIL.id}`);
      toast('Expediente eliminado', 'success');
      showView(EXP_DETAIL_FROM);
      EXP_DETAIL = null;
      if (EXP_DETAIL_FROM === 'expedientes') await loadExpedients();
      else if (EXP_DETAIL_FROM === 'pipelines') await loadPipelinesKanban();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Chat search
  const searchInput = document.getElementById('expChatSearchInput');
  const searchClear = document.getElementById('expChatSearchClear');
  searchInput?.addEventListener('input', () => {
    _chatSearchQuery = searchInput.value;
    renderExpDetailMessages();
  });
  searchClear?.addEventListener('click', () => {
    _chatSearchQuery = '';
    if (searchInput) searchInput.value = '';
    renderExpDetailMessages();
  });

  // Reply form
  const form = document.getElementById('expDetailReplyForm');
  const textarea = document.getElementById('expDetailReplyText');
  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });
  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form?.requestSubmit(); }
  });
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const convoId = Number(form.dataset.convoId);
    if (!convoId) { toast('Selecciona una conversación', 'warning'); return; }
    const body = textarea?.value.trim();
    if (!body) return;
    try {
      const msg = await api('POST', `/api/conversations/${convoId}/messages`, { body });
      EXP_DETAIL_MSGS.push(msg);
      renderExpDetailMessages();
      if (textarea) { textarea.value = ''; textarea.style.height = 'auto'; }
      // Reflect in convo list
      const convo = EXP_DETAIL_CONVOS.find((c) => c.id === convoId);
      if (convo) { convo.lastMessage = body; }
    } catch (err) { toast(err.message, 'error'); }
  });
}

// ─── Modal de expediente ───
async function openExpModal(idOrNull = null) {
  EXP_EDIT = null;
  EXP_TAGS = [];
  EXP_CONTACT_ID = null;

  await loadExpFieldDefs();

  if (idOrNull) {
    try {
      const data = await api('GET', `/api/expedients/${idOrNull}`);
      EXP_EDIT = data.item;
    } catch (err) { toast('Error cargando expediente', 'error'); return; }
  }

  const exp = EXP_EDIT;
  document.getElementById('expModalTitle').textContent = exp ? 'Editar expediente' : 'Nuevo expediente';
  document.getElementById('expName').value = exp?.name || '';
  document.getElementById('expDeleteBtn').hidden = !exp;
  document.getElementById('expModalError').hidden = true;

  // Contacto
  setExpContact(exp?.contactId, exp?.contactName);

  // Pipeline / Stage
  populateExpPipelineStage(exp?.pipelineId, exp?.stageId);

  // Tags
  EXP_TAGS = exp?.tags ? [...exp.tags] : [];
  renderExpTags();

  // Campos personalizados
  renderCustomFieldInputs(exp);

  document.getElementById('expModal').hidden = false;
  document.getElementById('expContactSearch').focus();
}

function closeExpModal() {
  document.getElementById('expModal').hidden = true;
  EXP_EDIT = null;
}

function setExpContact(contactId, contactName) {
  EXP_CONTACT_ID = contactId || null;
  const searchInput = document.getElementById('expContactSearch');
  const selected = document.getElementById('expContactSelected');
  const selectedName = document.getElementById('expContactSelectedName');
  const results = document.getElementById('expContactResults');

  if (contactId && contactName) {
    searchInput.hidden = true;
    results.hidden = true;
    selectedName.textContent = contactName;
    selected.hidden = false;
    document.getElementById('expContactId').value = contactId;
  } else {
    searchInput.hidden = false;
    searchInput.value = '';
    selected.hidden = true;
    results.hidden = true;
    document.getElementById('expContactId').value = '';
  }
}

function populateExpPipelineStage(pipelineId, stageId) {
  const pSel = document.getElementById('expPipeline');
  pSel.innerHTML = '<option value="">Selecciona pipeline...</option>' +
    PIPELINES.map((p) => `<option value="${p.id}" ${p.id === pipelineId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');

  function updateStages() {
    const pid = Number(pSel.value);
    const pipeline = PIPELINES.find((p) => p.id === pid);
    const sSel = document.getElementById('expStage');
    sSel.innerHTML = '<option value="">Selecciona etapa...</option>' +
      (pipeline?.stages || []).map((s) => `<option value="${s.id}" ${s.id === stageId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  }
  pSel.onchange = updateStages;
  updateStages();
}

function renderExpTags() {
  const chips = document.getElementById('expTagsChips');
  chips.innerHTML = EXP_TAGS.map((t) => `
    <span class="exp-tag-chip">${escapeHtml(t)}
      <button type="button" data-rm-tag="${escapeHtml(t)}">×</button>
    </span>`).join('');
  chips.querySelectorAll('[data-rm-tag]').forEach((btn) => {
    btn.addEventListener('click', () => {
      EXP_TAGS = EXP_TAGS.filter((t) => t !== btn.dataset.rmTag);
      renderExpTags();
    });
  });
}

function renderCustomFieldInputs(exp) {
  const container = document.getElementById('expCustomFields');
  if (!EXP_FIELD_DEFS.length) {
    container.innerHTML = `<div class="exp-form-custom-title">Campos personalizados</div>
      <div class="exp-form-custom-empty">Sin campos aún.<br><a onclick="openFieldsModal()">Configurar campos →</a></div>`;
    return;
  }
  const values = {};
  (exp?.fieldValues || []).forEach((fv) => { values[fv.fieldId] = fv.value; });

  container.innerHTML = `<div class="exp-form-custom-title">Campos personalizados</div>` +
    EXP_FIELD_DEFS.map((fd) => {
      const val = values[fd.id] ?? '';
      return `<div class="int-field">
        <label>${escapeHtml(fd.label)}</label>
        <div class="custom-field-input">${renderFieldInput(fd, val)}</div>
      </div>`;
    }).join('');
}

function renderFieldInput(fd, val) {
  const id = `cf_${fd.id}`;
  switch (fd.fieldType) {
    case 'text':    return `<input type="text" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" autocomplete="off" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
    case 'number':  return `<input type="number" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
    case 'url':     return `<input type="url" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" placeholder="https://" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
    case 'date':
    case 'birthday':return `<input type="date" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
    case 'datetime':return `<input type="datetime-local" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
    case 'long_text':return `<textarea id="${id}" data-field-id="${fd.id}" rows="3" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit;resize:vertical">${escapeHtml(val)}</textarea>`;
    case 'toggle':
      return `<div class="custom-field-toggle">
        <label class="toggle-switch">
          <input type="checkbox" id="${id}" data-field-id="${fd.id}" ${val === 'true' ? 'checked' : ''} />
          <span class="toggle-track"></span>
        </label>
        <span style="font-size:13px">${val === 'true' ? 'Sí' : 'No'}</span>
      </div>`;
    case 'select': {
      const opts = fd.options.map((o) => `<option value="${escapeHtml(o)}" ${o===val?'selected':''}>${escapeHtml(o)}</option>`).join('');
      return `<select id="${id}" data-field-id="${fd.id}"><option value="">— Sin selección —</option>${opts}</select>`;
    }
    case 'multi_select': {
      return fd.options.map((o) =>
        `<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:3px 0">
          <input type="checkbox" data-field-id="${fd.id}" data-ms-val="${escapeHtml(o)}" ${(val||'').split(',').includes(o)?'checked':''} />
          ${escapeHtml(o)}
        </label>`).join('');
    }
    default: return `<input type="text" id="${id}" data-field-id="${fd.id}" value="${escapeHtml(val)}" style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:13px;outline:none;box-sizing:border-box;font-family:inherit" />`;
  }
}

function collectCustomFieldValues() {
  const values = {};
  EXP_FIELD_DEFS.forEach((fd) => {
    if (fd.fieldType === 'toggle') {
      const el = document.querySelector(`[data-field-id="${fd.id}"][type="checkbox"]:not([data-ms-val])`);
      values[fd.id] = el ? String(el.checked) : 'false';
    } else if (fd.fieldType === 'multi_select') {
      const checked = [...document.querySelectorAll(`[data-field-id="${fd.id}"][data-ms-val]:checked`)].map((cb) => cb.dataset.msVal);
      values[fd.id] = checked.join(',');
    } else {
      const el = document.getElementById(`cf_${fd.id}`);
      values[fd.id] = el ? el.value.trim() : '';
    }
  });
  return values;
}

// ─── Guardar expediente ───
async function saveExpedient(e) {
  e.preventDefault();
  const errBox = document.getElementById('expModalError');
  const saveBtn = document.getElementById('expSaveBtn');
  errBox.hidden = true;

  const contactId = EXP_CONTACT_ID;
  const pipelineId = Number(document.getElementById('expPipeline').value) || null;
  const stageId = Number(document.getElementById('expStage').value) || null;
  const name = document.getElementById('expName').value.trim();
  const fieldValues = collectCustomFieldValues();

  if (!contactId) { errBox.textContent = 'Selecciona un contacto'; errBox.hidden = false; return; }
  if (!pipelineId) { errBox.textContent = 'Selecciona un pipeline'; errBox.hidden = false; return; }
  if (!stageId) { errBox.textContent = 'Selecciona una etapa'; errBox.hidden = false; return; }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Guardando…';
  try {
    if (EXP_EDIT) {
      await api('PATCH', `/api/expedients/${EXP_EDIT.id}`, { contactId, pipelineId, stageId, name, tags: EXP_TAGS, fieldValues });
      toast('Expediente actualizado', 'success');
    } else {
      await api('POST', '/api/expedients', { contactId, pipelineId, stageId, name, tags: EXP_TAGS, fieldValues });
      toast('Expediente creado', 'success');
    }
    closeExpModal();
    await loadExpedients();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Guardar';
  }
}

// ─── Modal de campos personalizados ───
function openFieldsModal() {
  renderFieldDefs();
  document.getElementById('expFieldsModal').hidden = false;
  document.getElementById('fieldsNewForm').hidden = true;
}
function closeFieldsModal() { document.getElementById('expFieldsModal').hidden = true; }

function renderFieldDefs() {
  const list = document.getElementById('fieldDefsList');
  const empty = document.getElementById('fieldDefsEmpty');
  const typeLabels = {
    text: 'Texto', number: 'Número', toggle: 'Interruptor', select: 'Selección',
    multi_select: 'Multi-selección', date: 'Día', url: 'URL', long_text: 'Texto largo',
    birthday: 'Cumpleaños', datetime: 'Fecha y hora',
  };
  if (!EXP_FIELD_DEFS.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = EXP_FIELD_DEFS.map((fd) => `
    <div class="field-def-row">
      <span class="field-def-label">${escapeHtml(fd.label)}</span>
      <span class="field-def-type">${typeLabels[fd.fieldType] || fd.fieldType}</span>
      <button class="btn btn--xs btn--danger-ghost" data-action="del-field" data-id="${fd.id}">Eliminar</button>
    </div>`).join('');

  list.querySelectorAll('[data-action="del-field"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este campo? Se perderán todos los valores guardados.')) return;
      try {
        await api('DELETE', `/api/expedients/field-defs/${btn.dataset.id}`);
        await loadExpFieldDefs();
        renderFieldDefs();
        toast('Campo eliminado', 'success');
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

// ─── Búsqueda de contactos en el modal ───
let _contactSearchTimer = null;
function setupExpContactSearch() {
  const input = document.getElementById('expContactSearch');
  const results = document.getElementById('expContactResults');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(_contactSearchTimer);
    const q = input.value.trim();
    if (!q) { results.hidden = true; return; }
    _contactSearchTimer = setTimeout(async () => {
      try {
        const data = await api('GET', `/api/expedients/contacts-search?q=${encodeURIComponent(q)}`);
        if (!data.items.length) {
          results.innerHTML = '<div class="exp-contact-result-item" style="color:var(--text-muted)">Sin resultados</div>';
        } else {
          results.innerHTML = data.items.map((c) => `
            <div class="exp-contact-result-item" data-id="${c.id}" data-name="${escapeHtml(c.name)}">
              <div class="exp-contact-result-name">${escapeHtml(c.name)}</div>
              <div class="exp-contact-result-meta">${escapeHtml(c.phone || c.email || '')}</div>
            </div>`).join('');
          results.querySelectorAll('[data-id]').forEach((item) => {
            item.addEventListener('click', () => {
              setExpContact(Number(item.dataset.id), item.dataset.name);
            });
          });
        }
        results.hidden = false;
      } catch (_) {}
    }, 250);
  });

  document.getElementById('expContactClear')?.addEventListener('click', () => setExpContact(null, null));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.exp-contact-search')) results.hidden = true;
  });

  // ─── Crear contacto rápido ───
  const quickForm = document.getElementById('expQuickContact');
  const newContactBtn = document.getElementById('expNewContactBtn');

  newContactBtn?.addEventListener('click', () => {
    const isOpen = !quickForm.hidden;
    if (isOpen) {
      quickForm.hidden = true;
      newContactBtn.textContent = '+ Crear contacto';
    } else {
      quickForm.hidden = false;
      newContactBtn.textContent = '✕ Cancelar';
      document.getElementById('qcFirstName').focus();
      // Limpiar
      document.getElementById('qcFirstName').value = '';
      document.getElementById('qcLastName').value = '';
      document.getElementById('qcPhone').value = '';
      document.getElementById('qcEmail').value = '';
      document.getElementById('qcError').hidden = true;
    }
  });

  document.getElementById('qcCancelBtn')?.addEventListener('click', () => {
    quickForm.hidden = true;
    newContactBtn.textContent = '+ Crear contacto';
  });

  document.getElementById('qcSaveBtn')?.addEventListener('click', async () => {
    const firstName = document.getElementById('qcFirstName').value.trim();
    const lastName  = document.getElementById('qcLastName').value.trim();
    const phone     = document.getElementById('qcPhone').value.trim();
    const email     = document.getElementById('qcEmail').value.trim();
    const errBox    = document.getElementById('qcError');
    const saveBtn   = document.getElementById('qcSaveBtn');

    if (!firstName) {
      errBox.textContent = 'El nombre es obligatorio';
      errBox.hidden = false;
      document.getElementById('qcFirstName').focus();
      return;
    }

    errBox.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creando…';

    try {
      const data = await api('POST', '/api/contacts', { firstName, lastName, phone, email });
      const contact = data.item;
      const fullName = [contact.firstName || contact.first_name, contact.lastName || contact.last_name].filter(Boolean).join(' ');
      setExpContact(contact.id, fullName);
      quickForm.hidden = true;
      newContactBtn.textContent = '+ Crear contacto';
      toast(`Contacto "${fullName}" creado y seleccionado`, 'success');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Crear y seleccionar';
    }
  });
}

// ─── Import de expedientes ───
let EXP_IMPORT_PARSED = [];

function openExpImportModal() {
  document.getElementById('expImportText').value = '';
  document.getElementById('expImportPreview').innerHTML = '';
  document.getElementById('expImportSaveBtn').disabled = true;
  EXP_IMPORT_PARSED = [];
  document.getElementById('expImportModal').hidden = false;
}
function closeExpImportModal() { document.getElementById('expImportModal').hidden = true; }

function parseExpImport() {
  const raw = document.getElementById('expImportText').value;
  const preview = document.getElementById('expImportPreview');
  const saveBtn = document.getElementById('expImportSaveBtn');
  EXP_IMPORT_PARSED = [];

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { preview.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Pega al menos una línea.</p>'; return; }

  const rows = lines.map((line) => {
    const parts = line.split(',').map((p) => p.trim());
    return {
      name:     parts[0] || '',
      contact:  parts[1] || '',
      pipeline: parts[2] || '',
      stage:    parts[3] || '',
    };
  });

  EXP_IMPORT_PARSED = rows;
  const thead = `<tr><th>Nombre</th><th>Contacto</th><th>Pipeline</th><th>Etapa</th></tr>`;
  const tbody = rows.map((r) => `<tr>
    <td>${escapeHtml(r.name || '—')}</td>
    <td>${escapeHtml(r.contact)}</td>
    <td>${escapeHtml(r.pipeline)}</td>
    <td>${escapeHtml(r.stage)}</td>
  </tr>`).join('');
  preview.innerHTML = `<table class="exp-table" style="margin-top:0"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
  saveBtn.disabled = false;
}

async function importExpedients() {
  if (!EXP_IMPORT_PARSED.length) return;
  const btn = document.getElementById('expImportSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Importando…';
  let ok = 0, fail = 0;

  for (const row of EXP_IMPORT_PARSED) {
    try {
      // Buscar contacto por nombre o teléfono
      const contactData = await api('GET', `/api/expedients/contacts-search?q=${encodeURIComponent(row.contact)}`);
      const contact = contactData.items[0];
      if (!contact) { fail++; continue; }

      // Buscar pipeline
      const pipeline = PIPELINES.find((p) => p.name.toLowerCase().includes((row.pipeline || '').toLowerCase()));
      if (!pipeline) { fail++; continue; }

      // Buscar etapa
      const stage = pipeline.stages.find((s) => s.name.toLowerCase().includes((row.stage || '').toLowerCase()));
      if (!stage) { fail++; continue; }

      await api('POST', '/api/expedients', {
        contactId: contact.id,
        pipelineId: pipeline.id,
        stageId: stage.id,
        name: row.name || null,
        tags: [],
      });
      ok++;
    } catch (_) { fail++; }
  }

  closeExpImportModal();
  await loadExpedients();
  btn.disabled = false;
  btn.textContent = 'Importar';
  toast(`Importados: ${ok} correctos${fail ? `, ${fail} no encontrados` : ''}`, ok ? 'success' : 'error');
}

function setupExpedients() {
  // Buscar (text — syncs with EXP_FILTERS via topbar search when on expedientes view)
  let _expSearchTimer = null;
  document.getElementById('topbarSearchInput')?.addEventListener('input', (e) => {
    if (document.body.dataset.viewActive !== 'expedientes') return;
    clearTimeout(_expSearchTimer);
    _expSearchTimer = setTimeout(() => {
      EXP_FILTERS.q = e.target.value.trim();
      EXP_STATE.search = EXP_FILTERS.q;
      EXP_STATE.page = 1;
      updateFilterBadge('exp');
      loadExpedients();
    }, 320);
  });

  // Sort dropdown
  const sortBtn = document.getElementById('expSortBtn');
  const sortDrop = document.getElementById('expSortDropdown');
  sortBtn?.addEventListener('click', (e) => { e.stopPropagation(); sortDrop.hidden = !sortDrop.hidden; });
  document.addEventListener('click', (e) => { if (!e.target.closest('.sort-wrapper')) sortDrop && (sortDrop.hidden = true); });
  document.querySelectorAll('#expSortDropdown .sort-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      EXP_STATE.sortBy  = btn.dataset.expSort;
      EXP_STATE.sortDir = btn.dataset.expDir;
      EXP_STATE.page = 1;
      document.getElementById('expSortLabel').textContent = btn.dataset.label;
      sortDrop.hidden = true;
      loadExpedients();
    });
  });

  // Tamaño de página
  document.getElementById('expPageSize')?.addEventListener('change', (e) => {
    EXP_STATE.pageSize = Number(e.target.value);
    EXP_STATE.page = 1;
    loadExpedients();
  });

  // Botones add
  document.getElementById('expAddBtn')?.addEventListener('click', () => openExpModal());
  document.getElementById('expAddBtnEmpty')?.addEventListener('click', () => openExpModal());

  // Import
  document.getElementById('expImportBtn')?.addEventListener('click', openExpImportModal);
  document.querySelectorAll('[data-close-exp-import]').forEach((el) => el.addEventListener('click', closeExpImportModal));
  document.getElementById('expImportParseBtn')?.addEventListener('click', parseExpImport);
  document.getElementById('expImportSaveBtn')?.addEventListener('click', importExpedients);

  // Modal expediente
  document.querySelectorAll('[data-close-exp]').forEach((el) => el.addEventListener('click', closeExpModal));
  document.getElementById('expForm')?.addEventListener('submit', saveExpedient);
  document.getElementById('expDeleteBtn')?.addEventListener('click', async () => {
    if (!EXP_EDIT || !confirm(`¿Eliminar el expediente "${EXP_EDIT.name || 'sin nombre'}"?`)) return;
    try {
      await api('DELETE', `/api/expedients/${EXP_EDIT.id}`);
      closeExpModal();
      await loadExpedients();
      toast('Expediente eliminado', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Tags input
  document.getElementById('expTagsField')?.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && !e.shiftKey) {
      e.preventDefault();
      const val = e.target.value.trim().replace(/,$/, '');
      if (val && !EXP_TAGS.includes(val)) { EXP_TAGS.push(val); renderExpTags(); }
      e.target.value = '';
    }
  });
  document.getElementById('expTagsInput')?.addEventListener('click', () => {
    document.getElementById('expTagsField').focus();
  });

  // Campos personalizados
  document.getElementById('expFieldsBtn')?.addEventListener('click', async () => {
    await loadExpFieldDefs();
    openFieldsModal();
  });
  document.querySelectorAll('[data-close-fields]').forEach((el) => el.addEventListener('click', closeFieldsModal));

  const fieldsAddBtn = document.getElementById('fieldsAddBtn');
  const fieldsNewForm = document.getElementById('fieldsNewForm');
  fieldsAddBtn?.addEventListener('click', () => {
    fieldsNewForm.hidden = false;
    fieldsAddBtn.hidden = true;
    document.getElementById('newFieldLabel').focus();
  });
  document.getElementById('fieldsNewCancel')?.addEventListener('click', () => {
    fieldsNewForm.hidden = true;
    fieldsAddBtn.hidden = false;
    document.getElementById('fieldsNewError').hidden = true;
    document.getElementById('newFieldLabel').value = '';
  });

  // Mostrar/ocultar opciones según tipo
  document.querySelectorAll('input[name="newFieldType"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const needsOptions = ['select', 'multi_select'].includes(radio.value);
      document.getElementById('fieldOptionsWrap').hidden = !needsOptions;
    });
  });

  document.getElementById('fieldsNewSave')?.addEventListener('click', async () => {
    const label = document.getElementById('newFieldLabel').value.trim();
    const fieldType = document.querySelector('input[name="newFieldType"]:checked')?.value || 'text';
    const optionsRaw = document.getElementById('newFieldOptions').value.trim();
    const options = ['select', 'multi_select'].includes(fieldType)
      ? optionsRaw.split('\n').map((o) => o.trim()).filter(Boolean)
      : [];
    const errBox = document.getElementById('fieldsNewError');
    errBox.hidden = true;
    try {
      await api('POST', '/api/expedients/field-defs', { entity: 'expedient', label, fieldType, options });
      await loadExpFieldDefs();
      renderFieldDefs();
      document.getElementById('fieldsNewForm').hidden = true;
      document.getElementById('fieldsAddBtn').hidden = false;
      document.getElementById('newFieldLabel').value = '';
      document.getElementById('newFieldOptions').value = '';
      toast('Campo agregado', 'success');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    }
  });

  setupExpContactSearch();
}

// ════════════════════════════════
// BOT BUILDER
// ════════════════════════════════
let sbBots = [];
let sbCurrentId = null;   // null = nuevo
let sbSteps = [];         // steps del bot en edición
let sbStepCounter = 0;
let sbTagIds = [];        // tag IDs asignados al bot en edición
let _botTags = [];
let _botTagFilter = null; // null = todos, number = id de tag
let _botSort = 'date_desc'; // date_desc | date_asc | name_asc | name_desc | tag

function formatBotDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

function sortBots(bots) {
  const arr = bots.slice();
  switch (_botSort) {
    case 'name_asc':  return arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
    case 'name_desc': return arr.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'es', { sensitivity: 'base' }));
    case 'date_asc':  return arr.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    case 'tag': return arr.sort((a, b) => {
      const ta = (a.tags && a.tags[0] && a.tags[0].name) || '￿';
      const tb = (b.tags && b.tags[0] && b.tags[0].name) || '￿';
      const c = ta.localeCompare(tb, 'es', { sensitivity: 'base' });
      return c !== 0 ? c : (b.created_at || 0) - (a.created_at || 0);
    });
    case 'date_desc':
    default: return arr.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
}

// Misma paleta que TPL_TAG_PALETTE (15 colores con contraste auto vía
// tplTagPillStyle). Incluye negro con texto blanco y amarillo brillante.
const BOT_TAG_PALETTE = [
  '#94a3b8', // gris
  '#3b82f6', // azul
  '#10b981', // verde
  '#f59e0b', // ámbar
  '#ef4444', // rojo
  '#8b5cf6', // violeta
  '#ec4899', // rosa
  '#14b8a6', // teal
  '#f97316', // naranja
  '#0f172a', // negro (texto blanco automático)
  '#facc15', // amarillo brillante
  '#84cc16', // lima
  '#06b6d4', // cian
  '#d946ef', // fucsia
  '#92400e', // café
];

async function loadBotTags() {
  try {
    const data = await api('GET', '/api/bot-tags');
    _botTags = data.items || [];
  } catch (e) {
    _botTags = [];
    console.error('loadBotTags', e);
  }
}

const SB_STEP_LABELS = {
  message:   'Enviar mensaje',
  template:  'Enviar plantilla',
  timer:     'Temporizador',
  condition: 'Condición',
  stage:     'Cambiar etapa',
  tag:       'Agregar etiqueta',
  assign:    'Asignar responsable',
  stop_bot:  'Parar bot',
};
const SB_TRIGGER_LABELS = {
  keyword:        'Palabra clave',
  new_contact:    'Nuevo contacto',
  pipeline_stage: 'Expediente entra a etapa',
  always:         'Cualquier mensaje',
  outbound:       'Manual / Outbound',
};

async function loadSalsbots() {
  try {
    await loadBotTags();
    const data = await api('GET', '/api/bot');
    sbBots = data.items || [];
    renderBotList();
  } catch (e) { console.error('loadSalsbots', e); }
}

// Layout de la lista de bots: 'v1' (compacto en grid) o 'v2' (card vertical, más aire)
let _botListLayout = (() => {
  try { return localStorage.getItem('botListLayout') || 'v1'; } catch { return 'v1'; }
})();
function setBotListLayout(v) {
  _botListLayout = v;
  try { localStorage.setItem('botListLayout', v); } catch {}
  const list = document.getElementById('botList');
  if (list) {
    list.classList.toggle('bot-cards-v2', v === 'v2');
    list.classList.toggle('bot-cards-v1', v === 'v1');
  }
  renderBotTagFilters();
}

function renderBotTagFilters() {
  const root = document.getElementById('botTagFilters');
  if (!root) return;
  const allActive = _botTagFilter === null ? 'is-active' : '';
  const tagPills = _botTags.map(t => `
    <button type="button" class="bot-tag-filter ${_botTagFilter === t.id ? 'is-active' : ''}" data-bot-tag-filter="${t.id}">
      <span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>
      ${escHtml(t.name)}
    </button>
  `).join('');
  root.innerHTML = `
    <button type="button" class="bot-tag-filter ${allActive}" data-bot-tag-filter="">Todos</button>
    ${tagPills}
    <select id="botSortSelect" class="bot-sort-select" title="Ordenar bots">
      <option value="date_desc"${_botSort === 'date_desc' ? ' selected' : ''}>Más nuevo</option>
      <option value="date_asc"${_botSort === 'date_asc' ? ' selected' : ''}>Más viejo</option>
      <option value="name_asc"${_botSort === 'name_asc' ? ' selected' : ''}>A → Z</option>
      <option value="name_desc"${_botSort === 'name_desc' ? ' selected' : ''}>Z → A</option>
      <option value="tag"${_botSort === 'tag' ? ' selected' : ''}>Por etiqueta</option>
    </select>
    <button type="button" class="bot-tag-manage-btn" id="botTagManageBtn" title="Gestionar etiquetas">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><circle cx="10" cy="10" r="3"/><path d="M10 2v2m0 12v2M4.2 4.2l1.4 1.4m8.8 8.8l1.4 1.4M2 10h2m12 0h2M4.2 15.8l1.4-1.4m8.8-8.8l1.4-1.4"/></svg>
      Etiquetas
    </button>
    <div class="bot-layout-switch" title="Cambia entre lista compacta (v1) y cards verticales (v2)">
      <button type="button" class="bot-layout-btn ${_botListLayout === 'v1' ? 'is-active' : ''}" data-bot-layout="v1">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><line x1="3" y1="6" x2="17" y2="6"/><line x1="3" y1="10" x2="17" y2="10"/><line x1="3" y1="14" x2="17" y2="14"/></svg>
        v1
      </button>
      <button type="button" class="bot-layout-btn ${_botListLayout === 'v2' ? 'is-active' : ''}" data-bot-layout="v2">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><rect x="3" y="3" width="14" height="6" rx="1.5"/><rect x="3" y="11" width="14" height="6" rx="1.5"/></svg>
        v2
      </button>
    </div>`;
}

// Resuelve un stage_id a { pipelineName, stageName, color } usando el global PIPELINES
function _resolveStage(stageId) {
  const sid = Number(stageId);
  if (!sid || !Array.isArray(PIPELINES)) return null;
  for (const p of PIPELINES) {
    if (!Array.isArray(p.stages)) continue;
    const stage = p.stages.find(s => Number(s.id) === sid);
    if (stage) return { pipelineName: p.name, stageName: stage.name, color: stage.color || '#94a3b8' };
  }
  return null;
}

// Construye el texto del trigger de un bot, enriqueciendo pipeline_stage con
// nombres legibles del pipeline + etapa (en lugar de mostrar el stage_id raw).
function botTriggerHtml(bot) {
  const label = SB_TRIGGER_LABELS[bot.trigger_type] || bot.trigger_type;
  if (bot.trigger_type === 'pipeline_stage' && bot.trigger_value) {
    const info = _resolveStage(bot.trigger_value);
    if (info) {
      return `${escHtml(label)}: <span class="bot-row-pipeline-pill"><span class="bot-row-pipeline-name">${escHtml(info.pipelineName)}</span><span class="bot-row-pipeline-arrow">→</span><span class="bot-row-stage-pill" style="background:${escHtml(info.color)}1a;color:${escHtml(info.color)};border-color:${escHtml(info.color)}66"><span class="bot-row-stage-dot" style="background:${escHtml(info.color)}"></span>${escHtml(info.stageName)}</span></span>`;
    }
    return `${escHtml(label)}: stage #${escHtml(bot.trigger_value)} (no encontrada)`;
  }
  if (bot.trigger_type === 'keyword' && bot.trigger_value) {
    return `${escHtml(label)}: "${escHtml(bot.trigger_value)}"`;
  }
  return escHtml(label);
}

function botRowTagsHtml(bot) {
  if (!Array.isArray(bot.tags) || !bot.tags.length) return '';
  return `<span class="bot-row-tags">${bot.tags.map(t => `<span class="bot-tag-pill" style="--tag-color:${escHtml(t.color)};${tplTagPillStyle(t.color)}"><span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>${escHtml(t.name)}</span>`).join('')}</span>`;
}

function renderBotList() {
  const list = document.getElementById('botList');
  const empty = document.getElementById('botEmpty');
  if (!list) return;

  renderBotTagFilters();

  const filteredBots = _botTagFilter === null
    ? sbBots
    : sbBots.filter(b => Array.isArray(b.tags) && b.tags.some(t => t.id === _botTagFilter));
  const visibleBots = sortBots(filteredBots);

  if (!sbBots.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  if (!visibleBots.length) {
    list.innerHTML = `<div class="bot-list-empty-filter">Ningún bot tiene esta etiqueta.</div>`;
    return;
  }

  // Aplica la clase del layout actual (v1 compacto o v2 cards)
  list.classList.toggle('bot-cards-v2', _botListLayout === 'v2');
  list.classList.toggle('bot-cards-v1', _botListLayout === 'v1');

  list.innerHTML = `
    <div class="bot-list-table">
      <div class="bot-list-head">
        <div>Nombre</div>
        <div>Disparador</div>
        <div>Pasos</div>
        <div>Activo</div>
        <div></div>
      </div>
      ${visibleBots.map(b => `
        <div class="bot-list-row" data-bot-id="${b.id}">
          <div class="bot-row-name-wrap">
            <div class="bot-row-name">${escHtml(b.name)}${botRowTagsHtml(b)}</div>
            ${b.created_at ? `<div class="bot-row-date">Creado ${escHtml(formatBotDate(b.created_at))}</div>` : ''}
          </div>
          <div class="bot-row-trigger">${botTriggerHtml(b)}</div>
          <div class="bot-row-steps">${b.steps.length} paso${b.steps.length !== 1 ? 's' : ''}</div>
          <div>
            <label class="sb-toggle" onclick="event.stopPropagation()">
              <input type="checkbox" class="sb-enabled-toggle" data-id="${b.id}" ${b.enabled ? 'checked' : ''} />
              <span class="sb-thumb"></span>
            </label>
          </div>
          <div>
            <button class="icon-btn icon-btn--ghost sb-del-btn" data-id="${b.id}" aria-label="Eliminar">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16"><polyline points="3 6 17 6"/><path d="M8 6V4h4v2"/><rect x="5" y="6" width="10" height="11" rx="1"/><line x1="8" y1="9" x2="8" y2="15"/><line x1="12" y1="9" x2="12" y2="15"/></svg>
            </button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function openBotBuilder(bot) {
  sbCurrentId = bot ? bot.id : null;
  sbSteps = bot
    ? JSON.parse(JSON.stringify(bot.steps)).map((s, i) => {
        sbStepCounter = Math.max(sbStepCounter, i + 1);
        return { ...s, _id: s._id || `s${i}` };
      })
    : [];
  sbTagIds = bot && Array.isArray(bot.tags) ? bot.tags.map(t => t.id) : [];

  document.getElementById('botListView').hidden = true;
  document.getElementById('botBuilder').hidden = false;
  renderBotBuilderTags();

  // Mostrar botón Eliminar solo cuando se edita un bot existente
  const delBtn = document.getElementById('botBuilderDelete');
  if (delBtn) delBtn.hidden = !bot;

  document.getElementById('botBuilderName').value = bot ? bot.name : '';
  document.getElementById('botBuilderEnabled').checked = bot ? bot.enabled : false;
  document.getElementById('sbTriggerType').value = bot ? bot.trigger_type : 'keyword';
  document.getElementById('sbTriggerValue').value = bot ? (bot.trigger_value || '') : '';

  updateTriggerValueVisibility();

  // Si el trigger es pipeline_stage, restaurar pipeline+etapa en los selectores
  if (bot?.trigger_type === 'pipeline_stage' && bot.trigger_value) {
    const stageId = Number(bot.trigger_value);
    const pl = (PIPELINES || []).find(p => p.stages?.some(s => s.id === stageId));
    if (pl) populateTriggerPipelines(pl.id, stageId);
  }
  renderStepsFlow();
}

function closeBotBuilder() {
  document.getElementById('botBuilder').hidden = true;
  document.getElementById('botListView').hidden = false;
}

function updateTriggerValueVisibility() {
  const type = document.getElementById('sbTriggerType').value;
  const valInput = document.getElementById('sbTriggerValue');
  const stageWrap = document.getElementById('sbTriggerStageWrap');
  const isStage = type === 'pipeline_stage';
  const hideValue = ['always', 'new_contact', 'outbound', 'pipeline_stage'].includes(type);
  valInput.hidden = hideValue;
  if (stageWrap) stageWrap.hidden = !isStage;
  valInput.placeholder = 'p.ej. "precio", "hola", "info"';
  if (isStage) populateTriggerPipelines();
}

function populateTriggerPipelines(selectedPipelineId, selectedStageId) {
  const plSel = document.getElementById('sbTriggerPipeline');
  const stageSel = document.getElementById('sbTriggerStage');
  if (!plSel || !stageSel) return;
  plSel.innerHTML = '<option value="">— Pipeline —</option>' +
    (PIPELINES || []).map(p =>
      `<option value="${p.id}" ${p.id == selectedPipelineId ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');
  updateTriggerStageOptions(selectedPipelineId, selectedStageId);
}

function updateTriggerStageOptions(pipelineId, selectedStageId) {
  const stageSel = document.getElementById('sbTriggerStage');
  if (!stageSel) return;
  const pl = (PIPELINES || []).find(p => p.id == pipelineId);
  if (!pl?.stages?.length) {
    stageSel.innerHTML = '<option value="">— Primero elige pipeline —</option>';
    updateTriggerStageDot(null);
    return;
  }
  stageSel.innerHTML = pl.stages.map(s =>
    `<option value="${s.id}" data-color="${s.color || ''}" ${s.id == selectedStageId ? 'selected' : ''}>${escHtml(s.name)}</option>`
  ).join('');
  updateTriggerStageDot(stageSel.options[stageSel.selectedIndex]);
}

function updateTriggerStageDot(opt) {
  const dot = document.getElementById('sbTriggerStageDot');
  if (!dot) return;
  const color = opt?.dataset?.color || '';
  dot.style.background = color || 'transparent';
}

function connectedIntegrationOptions(selectedId) {
  const all = INTEGRATIONS.flatMap(p => (p.integrations || []).map(inst => ({
    id: inst.id,
    label: `${p.name}${inst.name ? ` — ${inst.name}` : ''}`,
  })));
  if (!all.length) return '<option value="">— Sin integraciones conectadas —</option>';
  return all.map(inst =>
    `<option value="${inst.id}" ${inst.id == selectedId ? 'selected' : ''}>${escHtml(inst.label)}</option>`
  ).join('');
}

// ── Step rendering ──
function stepSummary(step) {
  const c = step.config || {};
  switch (step.type) {
    case 'message': {
      const preview = c.text ? `"${c.text.slice(0, 40)}${c.text.length > 40 ? '…' : ''}"` : 'Sin texto';
      if (c.channelId && c.channelId !== 'auto') {
        const inst = INTEGRATIONS.flatMap(p => p.integrations || []).find(i => i.id == c.channelId);
        const chanName = inst ? inst.name || inst.providerKey : `Canal ${c.channelId}`;
        return `${preview} · vía ${chanName}`;
      }
      return preview;
    }
    case 'template': {
      if (!c.templateId) return 'Sin plantilla seleccionada';
      const tpl = (_tplItems || []).find(t => t.id == c.templateId);
      if (!tpl) return `Plantilla #${c.templateId} (no encontrada)`;
      const status = tpl.waStatus === 'approved' ? '✓' : `⚠ ${tpl.waStatus}`;
      return `📋 ${tpl.displayName || tpl.name} · ${status}`;
    }
    case 'timer': {
      if (c.days !== undefined || c.hours !== undefined || c.minutes !== undefined || c.seconds !== undefined) {
        const parts = [];
        if (Number(c.days) > 0) parts.push(`${c.days}d`);
        if (Number(c.hours) > 0) parts.push(`${c.hours}h`);
        if (Number(c.minutes) > 0) parts.push(`${c.minutes}m`);
        if (Number(c.seconds) > 0) parts.push(`${c.seconds}s`);
        return parts.length ? `Esperar ${parts.join(' ')}` : 'Sin duración';
      }
      return c.amount ? `Esperar ${c.amount} ${c.unit || 'minutos'}` : 'Sin duración';
    }
    case 'condition': return c.field ? `Si ${c.field} = "${c.value || ''}"` : 'Sin condición';
    case 'stage':     return c.stageName ? `→ ${c.stageName}` : 'Sin etapa';
    case 'tag':       return c.tag ? `#${c.tag}` : 'Sin etiqueta';
    case 'assign':    return c.assignee || 'Sin asignar';
    case 'stop_bot':  return 'El bot deja de responder a este contacto';
    default: return '';
  }
}

function stepIconSvg(type) {
  const icons = {
    message:   `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path d="M3 4h14a1 1 0 011 1v9a1 1 0 01-1 1H5l-3 3V5a1 1 0 011-1z"/></svg>`,
    template:  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M3 8h14"/><path d="M7 12h6"/></svg>`,
    timer:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><circle cx="10" cy="11" r="7"/><path d="M10 7v4l2.5 2.5"/><path d="M8 2h4"/></svg>`,
    condition: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path d="M10 3v14M3 10h14"/><circle cx="10" cy="10" r="3"/></svg>`,
    stage:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><rect x="2" y="5" width="16" height="12" rx="2"/><path d="M2 9h16"/><circle cx="6" cy="14" r="1" fill="currentColor" stroke="none"/></svg>`,
    tag:       `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><path d="M3 3h7l7 7-7 7-7-7V3z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>`,
    assign:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><circle cx="10" cy="7" r="3.5"/><path d="M3 17a7 7 0 0114 0"/></svg>`,
    stop_bot:  `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="17" height="17"><rect x="4" y="4" width="12" height="12" rx="2"/></svg>`,
  };
  return icons[type] || '';
}

function buildStepBody(step) {
  const c = step.config || {};
  const sid = step._id;
  switch (step.type) {
    case 'message':
      return `
        <label>Canal de envío</label>
        <select data-field="channelId" data-sid="${sid}" class="sb-channel-sel">
          <option value="auto" ${(!c.channelId || c.channelId === 'auto') ? 'selected' : ''}>Automático (mismo canal del contacto)</option>
          ${connectedIntegrationOptions(c.channelId)}
        </select>
        <p class="sb-channel-hint" style="font-size:11px;color:var(--text-muted);margin-top:3px;margin-bottom:0">
          "Automático" responde por el canal donde llegó el mensaje. Elige uno específico solo en bots outbound.
        </p>
        <div class="sb-msg-label-row">
          <label>Mensaje</label>
          <button type="button" class="sb-tpl-insert-btn" data-sid="${sid}" title="Inserta el cuerpo de una plantilla básica">📋 Usar plantilla básica</button>
        </div>
        <textarea data-field="text" data-sid="${sid}" rows="4" placeholder="Escribe el mensaje aquí…">${escHtml(c.text || '')}</textarea>
        <p style="font-size:11px;color:var(--text-muted);margin-top:4px">Variables: {nombre} {apellido} {telefono} {email} · Para plantillas WhatsApp API aprobadas usa el step "Enviar plantilla".</p>`;
    case 'template': {
      // Solo plantillas wa_api APROBADAS por Meta — las demás no se pueden enviar.
      const waApproved = (_tplItems || []).filter(t => t.type === 'wa_api' && t.waStatus === 'approved');
      const tplOpts = waApproved.map(t =>
        `<option value="${t.id}" ${c.templateId == t.id ? 'selected' : ''}>${escHtml(t.displayName || t.name)}</option>`
      ).join('');
      const tpl = (_tplItems || []).find(t => t.id == c.templateId);
      let phsHtml = '';
      if (tpl) {
        const max = [...(tpl.body || '').matchAll(/\{\{(\d+)\}\}/g)]
          .map(m => Number(m[1]))
          .reduce((a, b) => Math.max(a, b), 0);
        if (max > 0) {
          const phs = tpl.bodyPlaceholders || [];
          const mv = c.manualValues || [];
          const rows = [];
          for (let i = 0; i < max; i++) {
            const ph = phs[i] || {};
            if (ph.contactField) {
              rows.push(`
                <div class="sb-tpl-ph-row">
                  <span class="sb-tpl-ph-num">{{${i + 1}}}</span>
                  <span class="sb-tpl-ph-auto">${escHtml(ph.label || '(sin nombre)')} → auto del contacto (${escHtml(ph.contactField)})</span>
                </div>`);
            } else {
              rows.push(`
                <div class="sb-tpl-ph-row">
                  <span class="sb-tpl-ph-num">{{${i + 1}}}</span>
                  <input class="sb-tpl-manual" data-sid="${sid}" data-i="${i}" value="${escHtml(mv[i] || '')}" placeholder="${escHtml(ph.label || ph.example || `Valor para {{${i + 1}}}`)}" />
                </div>`);
            }
          }
          phsHtml = `
            <label style="margin-top:12px">Valores fijos (los Manual del template)</label>
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 6px">Los placeholders mapeados al contacto se rellenan solos al enviar.</p>
            <div class="sb-tpl-phs">${rows.join('')}</div>`;
        }
      }
      const noApproved = !waApproved.length
        ? '<p style="font-size:12px;color:#dc2626;margin-top:6px">No tienes plantillas wa_api aprobadas todavía. Ve a Plantillas → crear → Enviar a Meta.</p>'
        : '';
      return `
        <label>Plantilla aprobada por Meta</label>
        <select data-field="templateId" data-sid="${sid}">
          <option value="">— Selecciona —</option>
          ${tplOpts}
        </select>
        ${noApproved}
        ${tpl ? `<div class="sb-tpl-preview">${escHtml((tpl.body || '').slice(0, 200))}${(tpl.body || '').length > 200 ? '…' : ''}</div>` : ''}
        ${phsHtml}`;
    }
    case 'timer': {
      // Backward compat: convert old {amount, unit} to new multi-field format for display
      let _d = Number(c.days) || 0, _h = Number(c.hours) || 0, _m = Number(c.minutes) || 0, _s = Number(c.seconds) || 0;
      if (c.amount && !c.days && !c.hours && !c.minutes && !c.seconds) {
        const amt = Number(c.amount) || 5;
        if (c.unit === 'segundos') _s = amt;
        else if (c.unit === 'horas') _h = amt;
        else if (c.unit === 'días') _d = amt;
        else _m = amt;
      }
      return `
        <label>Tiempo de espera</label>
        <div class="sb-timer-grid">
          <div class="sb-timer-unit">
            <input type="number" data-field="days" data-sid="${sid}" min="0" value="${_d}" />
            <span>días</span>
          </div>
          <div class="sb-timer-unit">
            <input type="number" data-field="hours" data-sid="${sid}" min="0" max="23" value="${_h}" />
            <span>horas</span>
          </div>
          <div class="sb-timer-unit">
            <input type="number" data-field="minutes" data-sid="${sid}" min="0" max="59" value="${_m}" />
            <span>min</span>
          </div>
          <div class="sb-timer-unit">
            <input type="number" data-field="seconds" data-sid="${sid}" min="0" max="59" value="${_s}" />
            <span>seg</span>
          </div>
        </div>`;
    }
    case 'condition':
      return `
        <label>Campo</label>
        <select data-field="field" data-sid="${sid}">
          <option value="tag"      ${c.field==='tag'      ?'selected':''}>Tiene etiqueta</option>
          <option value="pipeline" ${c.field==='pipeline' ?'selected':''}>Está en pipeline</option>
          <option value="message"  ${c.field==='message'  ?'selected':''}>Mensaje contiene</option>
        </select>
        <label>Valor</label>
        <input type="text" data-field="value" data-sid="${sid}" value="${escHtml(c.value||'')}" placeholder="Valor a comparar" />`;
    case 'stage': {
      const _curPl = (PIPELINES || []).find(p => p.id == c.pipelineId);
      const _curStage = _curPl?.stages?.find(s => s.id == c.stageId);
      const _curStageColor = _curStage?.color || '';
      const _curPlColor = _curPl?.color || '';
      const _plLabel = _curPl ? escHtml(_curPl.name) : '— Selecciona pipeline —';
      const _stLabel = _curStage ? escHtml(_curStage.name) : (c.pipelineId ? '— Selecciona etapa —' : '— Primero elige pipeline —');
      return `
        <label>Pipeline</label>
        <button type="button" class="sb-picker-btn sb-pipeline-btn" data-sid="${sid}">
          <span class="sb-picker-dot" data-pl-dot-sid="${sid}" style="background:${_curPlColor || 'transparent'}"></span>
          <span class="sb-picker-label" data-pl-label-sid="${sid}">${_plLabel}</span>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" class="sb-picker-chev"><polyline points="6 8 10 12 14 8"/></svg>
        </button>
        <select data-field="pipelineId" data-sid="${sid}" class="sb-pipeline-sel" hidden>
          <option value="">—</option>
          ${(PIPELINES || []).map(p => `<option value="${p.id}" ${c.pipelineId==p.id?'selected':''}>${escHtml(p.name)}</option>`).join('')}
        </select>
        <label>Etapa</label>
        <button type="button" class="sb-picker-btn sb-stage-btn" data-sid="${sid}">
          <span class="sb-picker-dot" data-dot-sid="${sid}" style="background:${_curStageColor || 'transparent'}"></span>
          <span class="sb-picker-label" data-st-label-sid="${sid}">${_stLabel}</span>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" class="sb-picker-chev"><polyline points="6 8 10 12 14 8"/></svg>
        </button>
        <select data-field="stageId" data-sid="${sid}" class="sb-stage-sel" hidden>
          ${buildStageOptionsWithColor(c.pipelineId, c.stageId)}
        </select>`;
    }
    case 'tag':
      return `
        <label>Etiqueta</label>
        <input type="text" data-field="tag" data-sid="${sid}" value="${escHtml(c.tag||'')}" placeholder="p.ej. interesado" />`;
    case 'assign':
      return `
        <label>Responsable</label>
        <input type="text" data-field="assignee" data-sid="${sid}" value="${escHtml(c.assignee||'')}" placeholder="Nombre del agente" />`;
    case 'stop_bot':
      return `
        <p style="font-size:13px;color:var(--text-muted);margin:10px 0 4px;line-height:1.5">
          A partir de este paso el bot <strong>dejará de responder</strong> a este contacto.<br>
          Un agente podrá reanudarlo manualmente desde la conversación.
        </p>`;
    default: return '';
  }
}

function buildStageOptions(pipelineId, selectedStageId) {
  if (!pipelineId) return '<option value="">— Primero elige pipeline —</option>';
  const pl = (PIPELINES || []).find(p => p.id == pipelineId);
  if (!pl || !pl.stages) return '<option value="">Sin etapas</option>';
  return pl.stages.map(s =>
    `<option value="${s.id}" ${s.id==selectedStageId?'selected':''}>${escHtml(s.name)}</option>`
  ).join('');
}

function buildStageOptionsWithColor(pipelineId, selectedStageId) {
  if (!pipelineId) return '<option value="">— Primero elige pipeline —</option>';
  const pl = (PIPELINES || []).find(p => p.id == pipelineId);
  if (!pl || !pl.stages) return '<option value="">Sin etapas</option>';
  return pl.stages.map(s =>
    `<option value="${s.id}" data-color="${s.color || ''}" ${s.id==selectedStageId?'selected':''}>${escHtml(s.name)}</option>`
  ).join('');
}

let _sbInsertAfter = null; // sid tras el cual insertar, null = al final

function renderStepsFlow() {
  const flow = document.getElementById('sbStepsFlow');
  if (!flow) return;

  const hasStopBot = sbSteps.some(s => s.type === 'stop_bot');
  const lastIsStop = sbSteps.length > 0 && sbSteps[sbSteps.length - 1].type === 'stop_bot';

  // Deshabilitar botón "Agregar módulo" si el último paso es stop_bot
  const addBtn = document.getElementById('sbAddStepBtn');
  if (addBtn) {
    addBtn.disabled = lastIsStop;
    addBtn.title = lastIsStop ? 'No se pueden agregar pasos después de "Parar bot"' : '';
  }

  flow.innerHTML = sbSteps.map((step, i) => {
    const prevIsStop = i > 0 && sbSteps[i - 1].type === 'stop_bot';
    const insertAfterTarget = i === 0 ? '__top__' : sbSteps[i - 1]._id;
    const showInsert = i === 0 || !prevIsStop;
    return `
    <div class="sb-step-wrap">
      <div class="sb-step-connector">
        ${showInsert ? `<button class="sb-insert-between" data-insert-after="${insertAfterTarget}" title="Insertar módulo aquí">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><line x1="8" y1="2" x2="8" y2="14"/><line x1="2" y1="8" x2="14" y2="8"/></svg>
        </button>` : ''}
      </div>
      <div class="sb-step-card" data-sid="${step._id}">
        <div class="sb-step-header" data-toggle-sid="${step._id}">
          <div class="sb-step-icon type-${step.type}">${stepIconSvg(step.type)}</div>
          <div class="sb-step-info">
            <div class="sb-step-title">${SB_STEP_LABELS[step.type] || step.type}</div>
            <div class="sb-step-summary">${stepSummary(step)}</div>
          </div>
          <button class="sb-step-del" data-del-sid="${step._id}" aria-label="Eliminar paso">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="15" height="15"><line x1="4" y1="4" x2="16" y2="16"/><line x1="16" y1="4" x2="4" y2="16"/></svg>
          </button>
        </div>
        <div class="sb-step-body" data-body-sid="${step._id}">
          ${buildStepBody(step)}
        </div>
      </div>
    </div>`;
  }).join('');

  flow.querySelectorAll('.sb-step-body').forEach(b => b.classList.add('is-open'));
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function collectStepConfig(sid) {
  const body = document.querySelector(`[data-body-sid="${sid}"]`);
  if (!body) return {};
  const cfg = {};
  body.querySelectorAll('[data-field]').forEach(el => {
    cfg[el.dataset.field] = el.value;
  });
  // Attach stage name for display
  if (cfg.stageId) {
    const stageEl = body.querySelector('.sb-stage-sel');
    cfg.stageName = stageEl ? stageEl.options[stageEl.selectedIndex]?.text : '';
  }
  // Template steps — manualValues array indexed por placeholder
  const mvInputs = body.querySelectorAll('.sb-tpl-manual');
  if (mvInputs.length) {
    cfg.manualValues = [];
    mvInputs.forEach(inp => {
      const i = Number(inp.dataset.i);
      cfg.manualValues[i] = inp.value;
    });
  }
  return cfg;
}

function collectAllSteps() {
  return sbSteps.map(step => ({
    ...step,
    config: collectStepConfig(step._id),
  }));
}

function setupBot() {
  // Back button
  document.getElementById('botBackBtn')?.addEventListener('click', () => {
    closeBotBuilder();
    loadSalsbots();
  });

  // Create buttons
  ['botCreateBtn', 'botCreateBtn2'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => openBotBuilder(null));
  });

  // Open existing bot on row click
  document.getElementById('botList')?.addEventListener('click', (e) => {
    // No abrir el builder si el usuario clickeó el botón de eliminar o el toggle
    if (e.target.closest('.sb-del-btn')) return;
    if (e.target.closest('.sb-toggle')) return;
    const row = e.target.closest('.bot-list-row');
    if (!row) return;
    const id = Number(row.dataset.botId);
    const bot = sbBots.find(b => b.id === id);
    if (bot) openBotBuilder(bot);
  });

  // Enable toggle inline (list)
  document.getElementById('botList')?.addEventListener('change', async (e) => {
    const tog = e.target.closest('.sb-enabled-toggle');
    if (!tog) return;
    const id = Number(tog.dataset.id);
    try {
      await api('PATCH', `/api/bot/${id}`, { enabled: tog.checked ? 1 : 0 });
      const bot = sbBots.find(b => b.id === id);
      if (bot) bot.enabled = tog.checked;
    } catch (err) { toast(err.message, 'error'); tog.checked = !tog.checked; }
  });

  // Delete bot (list)
  document.getElementById('botList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.sb-del-btn');
    if (!btn) return;
    if (!confirm('¿Eliminar este bot?')) return;
    const id = Number(btn.dataset.id);
    try {
      await api('DELETE', `/api/bot/${id}`);
      await loadSalsbots();
      toast('Bot eliminado', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Trigger type change
  document.getElementById('sbTriggerType')?.addEventListener('change', updateTriggerValueVisibility);

  // Pipeline selector en trigger pipeline_stage → recarga etapas
  document.getElementById('sbTriggerPipeline')?.addEventListener('change', e => {
    updateTriggerStageOptions(Number(e.target.value));
  });

  // Stage selector → update colored dot
  document.getElementById('sbTriggerStage')?.addEventListener('change', e => {
    updateTriggerStageDot(e.target.options[e.target.selectedIndex]);
  });

  // Add step button (al final)
  document.getElementById('sbAddStepBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _sbInsertAfter = null; // al final
    const picker = document.getElementById('sbStepPicker');
    picker.hidden = !picker.hidden;
  });

  // Insert between button (delegado en el flow)
  document.getElementById('sbStepsFlow')?.addEventListener('click', (e) => {
    const insertBtn = e.target.closest('.sb-insert-between');
    if (!insertBtn) return;
    e.stopPropagation();
    _sbInsertAfter = insertBtn.dataset.insertAfter;
    const picker = document.getElementById('sbStepPicker');
    // Posicionar el picker cerca del botón
    const rect = insertBtn.getBoundingClientRect();
    const builderRect = document.getElementById('sbStepsFlow').closest('.sb-canvas')?.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 6}px`;
    picker.style.left = `${rect.left - 60}px`;
    picker.style.removeProperty('width');
    picker.hidden = false;
  });

  // Pick step type
  document.getElementById('sbStepPicker')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.sb-step-type-btn');
    if (!btn) return;
    document.getElementById('sbStepPicker').hidden = true;
    document.getElementById('sbStepPicker').style.cssText = '';
    const type = btn.dataset.type;
    sbStepCounter++;
    const newStep = { _id: `s${sbStepCounter}`, type, config: {} };

    if (_sbInsertAfter === '__top__') {
      sbSteps.unshift(newStep);
      _sbInsertAfter = null;
    } else if (_sbInsertAfter) {
      const idx = sbSteps.findIndex(s => s._id === _sbInsertAfter);
      if (idx !== -1 && sbSteps[idx].type !== 'stop_bot') {
        sbSteps.splice(idx + 1, 0, newStep);
      } else {
        sbSteps.push(newStep);
      }
      _sbInsertAfter = null;
    } else {
      sbSteps.push(newStep);
    }

    renderStepsFlow();
    // Scroll al nuevo paso
    const flow = document.getElementById('sbStepsFlow');
    const newCard = flow?.querySelector(`[data-sid="${newStep._id}"]`);
    newCard?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Close picker on outside click
  document.addEventListener('click', (e) => {
    const picker = document.getElementById('sbStepPicker');
    if (picker && !picker.hidden && !e.target.closest('.sb-add-step-wrap') && !e.target.closest('.sb-insert-between')) {
      picker.hidden = true;
      picker.style.cssText = '';
      _sbInsertAfter = null;
    }
  });

  // Toggle step body open/close
  document.getElementById('sbStepsFlow')?.addEventListener('click', (e) => {
    // Delete wins — check first and bail before toggle
    const delBtn = e.target.closest('[data-del-sid]');
    if (delBtn) {
      const sid = delBtn.dataset.delSid;
      sbSteps = sbSteps.filter(s => s._id !== sid);
      renderStepsFlow();
      return;
    }

    // Toggle body open/closed on header click
    const header = e.target.closest('[data-toggle-sid]');
    if (!header) return;
    const sid = header.dataset.toggleSid;
    const body = document.querySelector(`[data-body-sid="${sid}"]`);
    if (body) body.classList.toggle('is-open');
  });

  // Pipeline → stage cascade in step body
  document.getElementById('sbStepsFlow')?.addEventListener('change', (e) => {
    const plSel = e.target.closest('.sb-pipeline-sel');
    if (plSel) {
      const sid = plSel.dataset.sid;
      const stageSel = document.querySelector(`.sb-stage-sel[data-sid="${sid}"]`);
      if (stageSel) {
        stageSel.innerHTML = buildStageOptionsWithColor(plSel.value, null);
        stageSel.value = '';
      }
      const dot = document.querySelector(`.sb-picker-dot[data-dot-sid="${sid}"]`);
      if (dot) dot.style.background = 'transparent';
      const stLabel = document.querySelector(`.sb-picker-label[data-st-label-sid="${sid}"]`);
      if (stLabel) stLabel.textContent = plSel.value ? '— Selecciona etapa —' : '— Primero elige pipeline —';
      return;
    }
    const stageSel = e.target.closest('.sb-stage-sel');
    if (stageSel) {
      const sid = stageSel.dataset.sid;
      const dot = document.querySelector(`.sb-picker-dot[data-dot-sid="${sid}"]`);
      const opt = stageSel.options[stageSel.selectedIndex];
      if (dot) dot.style.background = opt?.dataset?.color || 'transparent';
    }
  });

  // Pipeline / Stage picker buttons (replace native select dropdowns)
  document.getElementById('sbStepsFlow')?.addEventListener('click', (e) => {
    const plBtn = e.target.closest('.sb-pipeline-btn');
    if (plBtn) {
      e.preventDefault();
      const sid = plBtn.dataset.sid;
      const sel = document.querySelector(`.sb-pipeline-sel[data-sid="${sid}"]`);
      if (!sel) return;
      openOptionPicker({
        title: 'Selecciona un pipeline',
        options: (PIPELINES || []).map(p => ({ value: p.id, label: p.name, color: p.color || '#94a3b8' })),
        currentValue: sel.value,
        onSelect: (val) => {
          if (String(val) === String(sel.value)) return;
          sel.value = val;
          const p = (PIPELINES || []).find(x => String(x.id) === String(val));
          const plLabel = document.querySelector(`.sb-picker-label[data-pl-label-sid="${sid}"]`);
          const plDot = document.querySelector(`.sb-picker-dot[data-pl-dot-sid="${sid}"]`);
          if (plLabel && p) plLabel.textContent = p.name;
          if (plDot) plDot.style.background = p?.color || 'transparent';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          sel.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      return;
    }
    const stBtn = e.target.closest('.sb-stage-btn');
    if (stBtn) {
      e.preventDefault();
      const sid = stBtn.dataset.sid;
      const stageSel = document.querySelector(`.sb-stage-sel[data-sid="${sid}"]`);
      const plSel = document.querySelector(`.sb-pipeline-sel[data-sid="${sid}"]`);
      if (!stageSel || !plSel) return;
      const pipeline = (PIPELINES || []).find(p => String(p.id) === String(plSel.value));
      if (!pipeline) { toast('Primero selecciona un pipeline', 'error'); return; }
      const stages = Array.isArray(pipeline.stages) ? pipeline.stages : [];
      if (!stages.length) { toast('Este pipeline no tiene etapas', 'error'); return; }
      openOptionPicker({
        title: `Etapa de "${pipeline.name}"`,
        options: stages.map(s => ({ value: s.id, label: s.name, color: s.color || '#94a3b8' })),
        currentValue: stageSel.value,
        onSelect: (val) => {
          if (String(val) === String(stageSel.value)) return;
          stageSel.value = val;
          const stage = stages.find(s => String(s.id) === String(val));
          const stLabel = document.querySelector(`.sb-picker-label[data-st-label-sid="${sid}"]`);
          const dot = document.querySelector(`.sb-picker-dot[data-dot-sid="${sid}"]`);
          if (stLabel && stage) stLabel.textContent = stage.name;
          if (dot) dot.style.background = stage?.color || 'transparent';
          stageSel.dispatchEvent(new Event('change', { bubbles: true }));
          stageSel.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    }
  });

  // Update summary on input change
  document.getElementById('sbStepsFlow')?.addEventListener('input', (e) => {
    const el = e.target.closest('[data-sid]');
    if (!el) return;
    const sid = el.dataset.sid;
    const step = sbSteps.find(s => s._id === sid);
    if (!step) return;
    step.config = collectStepConfig(sid);
    const card = document.querySelector(`.sb-step-card[data-sid="${sid}"]`);
    const sumEl = card?.querySelector('.sb-step-summary');
    if (sumEl) sumEl.textContent = stepSummary(step);
  });

  // Delete bot desde el builder
  document.getElementById('botBuilderDelete')?.addEventListener('click', async () => {
    if (!sbCurrentId) return;
    const bot = sbBots.find(b => b.id === sbCurrentId);
    if (!confirm(`¿Eliminar el bot "${bot?.name || ''}"? Lo podrás recuperar de la Papelera por 30 días.`)) return;
    try {
      await api('DELETE', `/api/bot/${sbCurrentId}`);
      sbCurrentId = null;
      document.getElementById('botBuilder').hidden = true;
      document.getElementById('botListView').hidden = false;
      await loadSalsbots();
      toast('Bot enviado a la papelera', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Save bot
  document.getElementById('botBuilderSave')?.addEventListener('click', async () => {
    const name = document.getElementById('botBuilderName').value.trim();
    if (!name) { toast('Escribe un nombre para el bot', 'error'); return; }
    const enabled = document.getElementById('botBuilderEnabled').checked ? 1 : 0;
    const trigger_type = document.getElementById('sbTriggerType').value;
    let trigger_value = document.getElementById('sbTriggerValue').value.trim();
    if (trigger_type === 'pipeline_stage') {
      trigger_value = document.getElementById('sbTriggerStage')?.value || '';
    }
    const steps = collectAllSteps().map(({ _id, ...rest }) => rest);
    try {
      const payload = { name, enabled, trigger_type, trigger_value, steps, tagIds: sbTagIds };
      if (sbCurrentId) {
        await api('PATCH', `/api/bot/${sbCurrentId}`, payload);
      } else {
        const data = await api('POST', '/api/bot', payload);
        sbCurrentId = data.item.id;
      }
      toast('Bot guardado', 'success');
      await loadSalsbots();
      closeBotBuilder();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ─── Tag filter (botón "Todos" + cada tag) ───
  document.getElementById('botTagFilters')?.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-bot-tag-filter]');
    if (filterBtn) {
      const v = filterBtn.dataset.botTagFilter;
      _botTagFilter = v === '' ? null : Number(v);
      renderBotList();
      return;
    }
    if (e.target.closest('#botTagManageBtn')) openBotTagsManager();
  });

  // ─── Selector de orden de bots ───
  document.getElementById('botTagFilters')?.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'botSortSelect') {
      _botSort = e.target.value;
      renderBotList();
    }
  });

  // ─── Builder: + Etiqueta + remove pill ───
  document.getElementById('botBuilderTags')?.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-tag]');
    if (remove) {
      const id = Number(remove.dataset.removeTag);
      sbTagIds = sbTagIds.filter(x => x !== id);
      renderBotBuilderTags();
      return;
    }
    if (e.target.closest('#botBuilderAddTagBtn')) openBotBuilderTagPicker();
  });

  // Switch v1/v2 del layout de la lista de bots
  document.addEventListener('click', (e) => {
    const layoutBtn = e.target.closest('[data-bot-layout]');
    if (layoutBtn) {
      setBotListLayout(layoutBtn.dataset.botLayout);
    }
  });

  // Botón "Usar plantilla básica" dentro del step "Enviar mensaje".
  // Delegamos a nivel de botBuilder porque las step-cards se re-renderizan.
  document.getElementById('botBuilder')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.sb-tpl-insert-btn');
    if (!btn) return;
    e.preventDefault();
    const sid = btn.dataset.sid;
    const textarea = document.querySelector(`textarea[data-sid="${sid}"][data-field="text"]`);
    if (!textarea) return;
    openTplPickerForBotMessage(btn, textarea);
  });

  // ─── Tag manager modal listeners ───
  document.querySelectorAll('[data-close-bot-tags]').forEach(el => {
    el.addEventListener('click', closeBotTagsManager);
  });
  document.getElementById('botTagCreateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameEl  = document.getElementById('botTagNewName');
    const colorEl = document.querySelector('#botTagNewColors .bot-tag-swatch.is-selected');
    const name = (nameEl?.value || '').trim();
    const color = colorEl?.dataset.color || BOT_TAG_PALETTE[0];
    if (!name) { toast('Escribe un nombre', 'error'); return; }
    try {
      await api('POST', '/api/bot-tags', { name, color });
      nameEl.value = '';
      await loadBotTags();
      renderBotTagsManagerList();
      renderBotTagFilters();
      renderBotBuilderTags();
      toast('Etiqueta creada', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  document.getElementById('botTagsManagerList')?.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-edit-tag]');
    if (editBtn) {
      _botTagEditingId = Number(editBtn.dataset.editTag);
      const cur = _botTags.find(t => t.id === _botTagEditingId);
      if (cur) cur._draftColor = cur.color;
      renderBotTagsManagerList();
      setTimeout(() => document.querySelector('.tpl-tag-row--editing .bot-tag-edit-name')?.focus(), 50);
      return;
    }
    // Color en modo edición → solo cambia draft, no guarda
    const editColorBtn = e.target.closest('[data-bot-tag-edit-color]');
    if (editColorBtn) {
      const cur = _botTags.find(t => t.id === _botTagEditingId);
      if (cur) cur._draftColor = editColorBtn.dataset.botTagEditColor;
      renderBotTagsManagerList();
      setTimeout(() => document.querySelector('.tpl-tag-row--editing .bot-tag-edit-name')?.focus(), 50);
      return;
    }
    // Guardar edición (nombre + color)
    const saveBtn = e.target.closest('[data-save-bot-tag]');
    if (saveBtn) {
      const id = Number(saveBtn.dataset.saveBotTag);
      const cur = _botTags.find(t => t.id === id);
      const newName = document.querySelector('.tpl-tag-row--editing .bot-tag-edit-name')?.value.trim();
      if (!newName) { toast('El nombre no puede quedar vacío', 'error'); return; }
      try {
        await api('PUT', `/api/bot-tags/${id}`, { name: newName, color: cur._draftColor || cur.color });
        await loadBotTags();
        _botTagEditingId = null;
        renderBotTagsManagerList();
        renderBotTagFilters();
        renderBotList();
        renderBotBuilderTags();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    // Cancelar
    const cancelBtn = e.target.closest('[data-cancel-bot-tag]');
    if (cancelBtn) {
      _botTagEditingId = null;
      renderBotTagsManagerList();
      return;
    }
    const colorBtn = e.target.closest('[data-tag-color-pick]');
    if (colorBtn) {
      const id    = Number(colorBtn.dataset.tagColorPick);
      const color = colorBtn.dataset.color;
      const t = _botTags.find(x => x.id === id);
      if (!t) return;
      try {
        await api('PUT', `/api/bot-tags/${id}`, { name: t.name, color });
        await loadBotTags();
        renderBotTagsManagerList();
        renderBotTagFilters();
        renderBotList();
        renderBotBuilderTags();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
    const delBtn = e.target.closest('[data-delete-tag]');
    if (delBtn) {
      const id = Number(delBtn.dataset.deleteTag);
      const t = _botTags.find(x => x.id === id);
      if (!t) return;
      if (!confirm(`¿Eliminar la etiqueta "${t.name}"?\nSe quitará de todos los bots que la tengan.`)) return;
      try {
        await api('DELETE', `/api/bot-tags/${id}`);
        if (_botTagFilter === id) _botTagFilter = null;
        sbTagIds = sbTagIds.filter(x => x !== id);
        await loadBotTags();
        await loadSalsbots();
        renderBotTagsManagerList();
        renderBotBuilderTags();
        toast('Etiqueta eliminada', 'success');
      } catch (err) { toast(err.message, 'error'); }
    }
  });
}

function renderBotBuilderTags() {
  const root = document.getElementById('botBuilderTags');
  if (!root) return;
  const assigned = _botTags.filter(t => sbTagIds.includes(t.id));
  const pills = assigned.map(t => `
    <span class="bot-tag-pill" style="background:${escHtml(t.color)}1a;color:${escHtml(t.color)};border-color:${escHtml(t.color)}66">
      <span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>
      ${escHtml(t.name)}
      <button type="button" class="bot-tag-remove" data-remove-tag="${t.id}" aria-label="Quitar">×</button>
    </span>
  `).join('');
  root.innerHTML = `
    ${pills}
    <button type="button" class="bot-tag-add-btn" id="botBuilderAddTagBtn">+ Etiqueta</button>`;
}

function openBotBuilderTagPicker() {
  const available = _botTags.filter(t => !sbTagIds.includes(t.id));
  if (!_botTags.length) {
    openBotTagsManager();
    return;
  }
  if (!available.length) {
    toast('Ya asignaste todas las etiquetas a este bot', 'info');
    return;
  }
  openOptionPicker({
    title: 'Agregar etiqueta',
    options: available.map(t => ({ value: t.id, label: t.name, color: t.color })),
    currentValue: null,
    onSelect: (val) => {
      const id = Number(val);
      if (!sbTagIds.includes(id)) sbTagIds.push(id);
      renderBotBuilderTags();
    }
  });
}

function openBotTagsManager() {
  const modal = document.getElementById('botTagsManagerModal');
  if (!modal) return;
  renderBotTagPalette();
  renderBotTagsManagerList();
  modal.hidden = false;
}

function closeBotTagsManager() {
  const modal = document.getElementById('botTagsManagerModal');
  if (modal) modal.hidden = true;
}

function renderBotTagPalette() {
  const root = document.getElementById('botTagNewColors');
  if (!root) return;
  root.innerHTML = BOT_TAG_PALETTE.map((c, i) => `
    <button type="button" class="bot-tag-swatch ${i === 0 ? 'is-selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>
  `).join('');
  root.addEventListener('click', (e) => {
    const sw = e.target.closest('.bot-tag-swatch');
    if (!sw) return;
    root.querySelectorAll('.bot-tag-swatch').forEach(b => b.classList.remove('is-selected'));
    sw.classList.add('is-selected');
  }, { once: false });
}

let _botTagEditingId = null;
function renderBotTagsManagerList() {
  const root = document.getElementById('botTagsManagerList');
  if (!root) return;
  if (!_botTags.length) {
    root.innerHTML = '<div class="bot-tag-manager-empty">Aún no hay etiquetas. Crea la primera arriba.</div>';
    return;
  }
  root.innerHTML = _botTags.map(t => {
    if (_botTagEditingId === t.id) {
      return `
        <div class="bot-tag-manager-row tpl-tag-row--editing" data-id="${t.id}">
          <input type="text" class="int-input bot-tag-edit-name tpl-tag-edit-name" value="${escHtml(t.name)}" maxlength="32" />
          <div class="bot-tag-row-colors">
            ${BOT_TAG_PALETTE.map(c => `<button type="button" class="bot-tag-swatch-sm ${c === (t._draftColor || t.color) ? 'is-selected' : ''}" data-bot-tag-edit-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}
          </div>
          <div class="bot-tag-row-actions">
            <button type="button" class="btn btn--sm btn--primary" data-save-bot-tag="${t.id}">Guardar</button>
            <button type="button" class="btn btn--sm btn--secondary" data-cancel-bot-tag="${t.id}">Cancelar</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="bot-tag-manager-row" data-id="${t.id}">
        <div class="bot-tag-pill" style="${tplTagPillStyle(t.color)}">
          <span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>
          ${escHtml(t.name)}
        </div>
        <div class="bot-tag-row-colors">
          ${BOT_TAG_PALETTE.map(c => `<button type="button" class="bot-tag-swatch-sm ${c === t.color ? 'is-selected' : ''}" data-tag-color-pick="${t.id}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}
        </div>
        <div class="bot-tag-row-actions">
          <button type="button" class="icon-btn icon-btn--ghost" data-edit-tag="${t.id}" aria-label="Editar nombre y color">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" class="icon-btn icon-btn--ghost" data-delete-tag="${t.id}" aria-label="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ════════════════════════════════
// Etiquetas de plantillas (mismo patrón que bot tags)
// ════════════════════════════════
let _tplTagEditingId = null; // id de la tag actualmente en modo edición inline
const TPL_TAG_PALETTE = [
  '#94a3b8', // gris
  '#3b82f6', // azul
  '#10b981', // verde
  '#f59e0b', // ámbar
  '#ef4444', // rojo
  '#8b5cf6', // violeta
  '#ec4899', // rosa
  '#14b8a6', // teal
  '#f97316', // naranja
  '#0f172a', // negro (texto blanco)
  '#facc15', // amarillo brillante
  '#84cc16', // lima
  '#06b6d4', // cian
  '#d946ef', // fucsia
  '#92400e', // café
];

// Calcula si un color hex es "oscuro" (luminance < 128) — usado para decidir
// si la pill debe llevar fondo sólido + texto blanco (color oscuro) o fondo
// tintado + texto color (color claro).
function isDarkColor(hex) {
  if (!hex) return false;
  const c = String(hex).replace('#', '');
  if (c.length !== 6) return false;
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  if ([r, g, b].some(x => Number.isNaN(x))) return false;
  // YIQ luminance — pondera verde más alto porque el ojo humano es más sensible al verde
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq < 140;  // umbral conservador para que el azul oscuro también caiga en "dark"
}

// Devuelve el style inline para una pill, escogiendo contraste adecuado:
// - color oscuro → bg sólido del color + texto blanco
// - color claro → bg tintado 10% + texto del color (legible sobre tinte claro)
function tplTagPillStyle(color) {
  const c = color || '#94a3b8';
  if (isDarkColor(c)) {
    return `background:${escHtml(c)};color:#fff;border-color:${escHtml(c)}`;
  }
  return `background:${escHtml(c)}1a;color:${escHtml(c)};border-color:${escHtml(c)}66`;
}

function renderTplTagsPickers() {
  const root = document.getElementById('tplTagsPickers');
  if (!root) return;
  if (!_tplTags.length) {
    root.innerHTML = '<p class="tpl-hint-inline">No tienes etiquetas. Crea una desde Plantillas → botón "Etiquetas".</p>';
    return;
  }
  root.innerHTML = _tplTags.map(t => {
    const on = _tplDraftTagIds.includes(t.id);
    const styleStr = on
      ? tplTagPillStyle(t.color)
      : `background:${escHtml(t.color)}12;color:${escHtml(t.color)};border-color:${escHtml(t.color)}66`;
    return `<button type="button" class="bot-tag-pill ${on ? 'is-on' : 'is-off'}" data-toggle-tag="${t.id}" style="${styleStr}"><span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>${escHtml(t.name)}</button>`;
  }).join('');
}

function openTplTagsManager() {
  const modal = document.getElementById('tplTagsManagerModal');
  if (!modal) return;
  renderTplTagPalette();
  renderTplTagsManagerList();
  modal.hidden = false;
}
function closeTplTagsManager() {
  const modal = document.getElementById('tplTagsManagerModal');
  if (modal) modal.hidden = true;
}
function renderTplTagPalette() {
  const root = document.getElementById('tplTagNewColors');
  if (!root) return;
  root.innerHTML = TPL_TAG_PALETTE.map((c, i) => `
    <button type="button" class="bot-tag-swatch ${i === 0 ? 'is-selected' : ''}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>
  `).join('');
}
function renderTplTagsManagerList() {
  const root = document.getElementById('tplTagsManagerList');
  if (!root) return;
  if (!_tplTags.length) {
    root.innerHTML = '<div class="bot-tag-manager-empty">Aún no hay etiquetas. Crea la primera arriba.</div>';
    return;
  }
  root.innerHTML = _tplTags.map(t => {
    if (_tplTagEditingId === t.id) {
      // Modo edición inline: input nombre + paleta de colores + guardar/cancelar
      return `
        <div class="bot-tag-manager-row tpl-tag-row--editing" data-id="${t.id}">
          <input type="text" class="int-input tpl-tag-edit-name" value="${escHtml(t.name)}" maxlength="32" />
          <div class="bot-tag-row-colors">
            ${TPL_TAG_PALETTE.map(c => `<button type="button" class="bot-tag-swatch-sm ${c === (t._draftColor || t.color) ? 'is-selected' : ''}" data-tpl-tag-edit-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}
          </div>
          <div class="bot-tag-row-actions">
            <button type="button" class="btn btn--sm btn--primary" data-save-tpl-tag="${t.id}">Guardar</button>
            <button type="button" class="btn btn--sm btn--secondary" data-cancel-tpl-tag="${t.id}">Cancelar</button>
          </div>
        </div>
      `;
    }
    return `
      <div class="bot-tag-manager-row" data-id="${t.id}">
        <div class="bot-tag-pill" style="${tplTagPillStyle(t.color)}">
          <span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>
          ${escHtml(t.name)}
        </div>
        <div class="bot-tag-row-colors">
          ${TPL_TAG_PALETTE.map(c => `<button type="button" class="bot-tag-swatch-sm ${c === t.color ? 'is-selected' : ''}" data-tpl-tag-color-pick="${t.id}" data-color="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}
        </div>
        <div class="bot-tag-row-actions">
          <button type="button" class="icon-btn icon-btn--ghost" data-edit-tpl-tag="${t.id}" aria-label="Editar nombre y color">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button type="button" class="icon-btn icon-btn--ghost" data-delete-tpl-tag="${t.id}" aria-label="Eliminar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function createTplTag(name, color) {
  await api('POST', '/api/template-tags', { name, color });
  await loadTemplateTags();
  renderTplTagsManagerList();
  renderTplTagsPickers();
  renderTemplates();
}
async function updateTplTag(id, fields) {
  await api('PUT', `/api/template-tags/${id}`, fields);
  await loadTemplateTags();
  renderTplTagsManagerList();
  renderTplTagsPickers();
  renderTemplates();
}
async function deleteTplTag(id) {
  if (!confirm('¿Eliminar esta etiqueta? Se quitará de todas las plantillas.')) return;
  await api('DELETE', `/api/template-tags/${id}`);
  // Quitar de tags en cache local
  _tplItems.forEach(t => { if (Array.isArray(t.tags)) t.tags = t.tags.filter(x => x.id !== id); });
  _tplDraftTagIds = _tplDraftTagIds.filter(x => x !== id);
  if (_tplTagFilter === id) _tplTagFilter = null;
  await loadTemplateTags();
  renderTplTagsManagerList();
  renderTplTagsPickers();
  renderTemplates();
}

// ════════════════════════════════
// MI CUENTA
// ════════════════════════════════
let _profile = {};

async function loadProfile() {
  try {
    const data = await api('GET', '/api/settings/profile');
    _profile = data.profile || {};
    applyProfileToUI();
  } catch (e) { console.error('loadProfile', e); }
}

function applyProfileToUI() {
  const p = _profile;
  const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Reelance';
  const role = p.role || 'Admin';

  // Sidebar
  const sidebarName = document.getElementById('sidebarName');
  const sidebarRole = document.getElementById('sidebarRole');
  if (sidebarName) sidebarName.textContent = name;
  if (sidebarRole) sidebarRole.textContent = role;

  // Avatar: use photo URL if set, otherwise initials
  const avatarImg = document.getElementById('sidebarAvatar');
  if (avatarImg && p.avatarUrl) avatarImg.src = p.avatarUrl;
}

function openAccountView() {
  const p = _profile;
  document.getElementById('accFirstName').value  = p.firstName  || '';
  document.getElementById('accLastName').value   = p.lastName   || '';
  document.getElementById('accUsername').value   = p.username   || '';
  document.getElementById('accPhone').value      = p.phone      || '';
  document.getElementById('accEmail').value      = p.email      || '';

  const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Reelance';
  document.getElementById('accountDisplayName').textContent = name;
  const img = document.getElementById('accountAvatarImg');
  const initials = document.getElementById('accountAvatarInitials');
  if (p.avatarUrl) {
    img.src = p.avatarUrl;
    img.hidden = false;
    initials.hidden = true;
  } else {
    const parts = name.split(' ');
    initials.textContent = (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
    img.hidden = true;
    initials.hidden = false;
  }

  ['accCurrentPass','accNewPass','accConfirmPass'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('accPassError').hidden = true;

  showView('cuenta');
}

function setupAccount() {
  document.getElementById('navAdvisorInfo')?.addEventListener('click', openAccountView);

  // Save profile
  document.getElementById('accSaveProfile')?.addEventListener('click', async () => {
    const patch = {
      firstName:  document.getElementById('accFirstName').value.trim(),
      lastName:   document.getElementById('accLastName').value.trim(),
      username:   document.getElementById('accUsername').value.trim(),
      phone:      document.getElementById('accPhone').value.trim(),
      email:      document.getElementById('accEmail').value.trim(),
      role:       _profile.role || 'Admin',
      avatarUrl:  _profile.avatarUrl || '',
    };
    try {
      const data = await api('PATCH', '/api/settings/profile', patch);
      _profile = data.profile;
      applyProfileToUI();
      // Update modal display name live
      const name = [patch.firstName, patch.lastName].filter(Boolean).join(' ') || 'Reelance';
      document.getElementById('accountDisplayName').textContent = name;
      toast('Perfil guardado', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Change password (UI validation only — requires auth backend to actually enforce)
  document.getElementById('accSavePassword')?.addEventListener('click', async () => {
    const current  = document.getElementById('accCurrentPass').value;
    const next     = document.getElementById('accNewPass').value;
    const confirm  = document.getElementById('accConfirmPass').value;
    const errEl    = document.getElementById('accPassError');
    errEl.hidden   = true;

    if (!current) { errEl.textContent = 'Ingresa tu contraseña actual.'; errEl.hidden = false; return; }
    if (next.length < 8) { errEl.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; errEl.hidden = false; return; }
    if (next !== confirm) { errEl.textContent = 'Las contraseñas no coinciden.'; errEl.hidden = false; return; }

    try {
      await api('PATCH', '/api/settings/profile', { ..._profile, _passwordChange: { current, next } });
      ['accCurrentPass','accNewPass','accConfirmPass'].forEach(id => { document.getElementById(id).value = ''; });
      toast('Contraseña actualizada', 'success');
    } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  });
}

// ════════════════════════════════
// PIPELINES KANBAN
// ════════════════════════════════
let PL_ACTIVE_ID = null;   // pipeline seleccionado en el tablero
let PL_MANAGE_ID = null;   // pipeline abierto en el modal de gestión
let PL_EXP_CACHE = [];     // expedientes para el kanban
let PL_SEARCH   = '';      // filtro texto del kanban (legacy, aliased below)
let PL_SORT     = 'createdAt'; // orden del kanban
let PL_FILTERS  = { q: '', searchIn: 'all', tags: [], fieldValues: {} };

// Estado drag-and-drop del kanban (módulo-level para que los listeners del board no se dupliquen)
let _kdDragId           = null;
let _kdOriginPipeline   = null;
let _kdHoveredCol       = null;
let _kdTabTimer         = null;
let _kdBoardListenersSet = false;
let _kdColDragId        = null;  // stage id being reordered via column drag
let _kdPipelineDragId   = null;  // pipeline id being reordered via tab drag
let EXP_FILTERS = { q: '', searchIn: 'all', tags: [], fieldValues: {} };

async function loadPipelinesKanban() {
  try {
    const [plData, expData] = await Promise.all([
      api('GET', '/api/pipelines'),
      api('GET', '/api/expedients?pageSize=500'),
    ]);
    PIPELINES = plData.items;
    PL_EXP_CACHE = expData.items || [];
    if (!PL_ACTIVE_ID && PIPELINES.length) {
      const savedId = Number(localStorage.getItem('lastPipelineId'));
      PL_ACTIVE_ID = (savedId && PIPELINES.some(p => p.id === savedId)) ? savedId : PIPELINES[0].id;
    }
    renderPipelineTabs();
    renderPipelinesBoard();
  } catch (e) { console.error('loadPipelinesKanban', e); }
}

function plIconSvg(iconKey, color, size = 14) {
  if (!iconKey || !PL_ICONS[iconKey]) return null;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${escHtml(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${size}" height="${size}">${PL_ICONS[iconKey]}</svg>`;
}

function renderPipelineTabs() {
  const tabs = document.getElementById('plTabs');
  if (!tabs) return;
  if (PL_ACTIVE_ID) localStorage.setItem('lastPipelineId', PL_ACTIVE_ID);
  tabs.innerHTML = PIPELINES.map(p => {
    const icon = plIconSvg(p.icon, p.color, 14);
    return `
    <button class="pl-tab ${p.id === PL_ACTIVE_ID ? 'is-active' : ''}" data-pl-id="${p.id}">
      <span class="pl-tab-drag-handle" title="Arrastra para reordenar">
        <svg width="8" height="12" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/><circle cx="2.5" cy="7" r="1.5"/><circle cx="7.5" cy="7" r="1.5"/><circle cx="2.5" cy="11.5" r="1.5"/><circle cx="7.5" cy="11.5" r="1.5"/></svg>
      </span>
      ${icon ? `<span class="pl-tab-icon">${icon}</span>` : `<span class="pl-tab-dot" style="background:${p.color}"></span>`}
      ${escHtml(p.name)}
    </button>`;
  }).join('');
}

function renderPipelinesBoard() {
  const board = document.getElementById('plBoard');
  const empty = document.getElementById('plEmpty');
  if (!board) return;

  if (!PIPELINES.length) {
    board.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  board.hidden = false;
  if (empty) empty.hidden = true;

  const pipeline = PIPELINES.find(p => p.id === PL_ACTIVE_ID) || PIPELINES[0];
  if (!pipeline) return;

  // Filter + sort
  const filtered = applyExpFiltersClient(PL_EXP_CACHE.filter(e => e.pipelineId === pipeline.id), PL_FILTERS);
  filtered.sort((a, b) => {
    if (PL_SORT === 'name')      return (a.name || '').localeCompare(b.name || '');
    if (PL_SORT === 'nameDesc')  return (b.name || '').localeCompare(a.name || '');
    if (PL_SORT === 'updatedAt') return (b.updatedAt || 0) - (a.updatedAt || 0);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  const expByStage = {};
  for (const s of pipeline.stages) expByStage[s.id] = [];
  for (const e of filtered) {
    if (expByStage[e.stageId]) expByStage[e.stageId].push(e);
  }

  board.innerHTML = pipeline.stages.map(stage => {
    const cards = expByStage[stage.id] || [];
    return `
      <div class="pl-column" data-stage-id="${stage.id}" data-drop-stage="${stage.id}">
        <div class="pl-col-header">
          <span class="pl-col-drag-handle" title="Arrastra para reordenar columna">
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.5"/><circle cx="7.5" cy="2.5" r="1.5"/><circle cx="2.5" cy="7" r="1.5"/><circle cx="7.5" cy="7" r="1.5"/><circle cx="2.5" cy="11.5" r="1.5"/><circle cx="7.5" cy="11.5" r="1.5"/></svg>
          </span>
          <span class="pl-col-dot" style="background:${stage.color}"></span>
          <span class="pl-col-name">${escHtml(stage.name)}</span>
          <span class="pl-col-count">${cards.length}</span>
        </div>
        <div class="pl-col-body">
          ${cards.length ? cards.map(e => `
            <div class="pl-card" data-exp-id="${e.id}" draggable="true">
              <div class="pl-card-name ${e.nameIsAuto ? 'is-auto-name' : ''}">${escHtml(e.name || 'Sin nombre')}</div>
              <div class="pl-card-contact">${escHtml(e.contactName || '—')}</div>
              <div class="pl-card-footer">
                <div class="pl-card-tags">${(e.tags || []).slice(0,2).map(t => `<span class="pl-card-tag">${escHtml(t)}</span>`).join('')}</div>
                <span class="pl-card-date">${fmtDate(e.createdAt)}</span>
              </div>
            </div>
          `).join('') : `<div class="pl-col-empty">Sin expedientes</div>`}
        </div>
      </div>`;
  }).join('');

  setupKanbanDragDrop();
}

function _kdClearHighlight() {
  if (_kdHoveredCol) { _kdHoveredCol.classList.remove('drag-over'); _kdHoveredCol = null; }
}
function _kdSetHighlight(col) {
  if (col === _kdHoveredCol) return;
  _kdClearHighlight();
  if (col) { col.classList.add('drag-over'); _kdHoveredCol = col; }
}

function setupKanbanDragDrop() {
  const board = document.getElementById('plBoard');
  if (!board) return;

  // ── Listeners del board: solo se registran UNA VEZ ──
  if (!_kdBoardListenersSet) {
    _kdBoardListenersSet = true;

    document.addEventListener('dragover', e => {
      if (!e.target.closest('#plBoard')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (_kdColDragId) {
        // Column reorder: highlight target column header only
        const targetCol = e.target.closest('.pl-column');
        document.querySelectorAll('#plBoard .pl-column').forEach(c =>
          c.classList.toggle('col-drag-over', c === targetCol && Number(c.dataset.stageId) !== _kdColDragId)
        );
        return;
      }
      _kdSetHighlight(e.target.closest('.pl-column'));
    });

    document.addEventListener('dragleave', e => {
      const board = document.getElementById('plBoard');
      if (board && !board.contains(e.relatedTarget)) _kdClearHighlight();
    });

    document.addEventListener('drop', async e => {
      const board = document.getElementById('plBoard');
      if (!board) return;

      // ── Column reorder drop ──
      if (_kdColDragId) {
        e.preventDefault();
        document.querySelectorAll('#plBoard .pl-column').forEach(c => c.classList.remove('col-drag-over'));
        const targetCol = e.target.closest('.pl-column');
        const fromId = _kdColDragId;
        _kdColDragId = null;
        if (!targetCol || !board.contains(targetCol)) return;
        const toId = Number(targetCol.dataset.stageId);
        if (fromId === toId) return;

        const cols   = [...board.querySelectorAll('.pl-column')];
        const ids    = cols.map(c => Number(c.dataset.stageId));
        const fromIdx = ids.indexOf(fromId);
        const toIdx   = ids.indexOf(toId);
        ids.splice(fromIdx, 1);
        ids.splice(toIdx, 0, fromId);

        // Instant DOM reorder
        const dragCol = cols[fromIdx];
        const dropCol = cols[toIdx];
        if (fromIdx < toIdx) dropCol.after(dragCol);
        else dropCol.before(dragCol);

        try {
          await api('POST', `/api/pipelines/${PL_ACTIVE_ID}/stages/reorder`, { order: ids });
          const pl = PIPELINES.find(p => p.id === PL_ACTIVE_ID);
          if (pl) pl.stages.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        } catch (err) { toast(err.message, 'error'); await loadPipelinesKanban(); }
        return;
      }

      // ── Card drop ──
      const col = e.target.closest('.pl-column');
      if (!col || !board.contains(col)) return;
      e.preventDefault();
      _kdClearHighlight();

      const stageId = Number(col.dataset.dropStage);
      const expId   = _kdDragId || Number(e.dataTransfer.getData('text/plain') || 0);
      if (!expId || !stageId) return;

      const exp = PL_EXP_CACHE.find(x => x.id === expId);
      if (!exp) return;

      const newPipelineId = PL_ACTIVE_ID;
      if (exp.stageId === stageId && exp.pipelineId === newPipelineId) { _kdDragId = null; return; }

      _kdDragId = null;
      _kdOriginPipeline = null;

      const patch = { stageId };
      if (exp.pipelineId !== newPipelineId) patch.pipelineId = newPipelineId;

      try {
        await api('PATCH', `/api/expedients/${expId}`, patch);
        exp.stageId = stageId;
        if (patch.pipelineId) exp.pipelineId = newPipelineId;
        renderPipelineTabs();
        renderPipelinesBoard();
        if (patch.pipelineId) {
          const pl    = PIPELINES.find(p => p.id === newPipelineId);
          const stage = pl?.stages?.find(s => s.id === stageId);
          toast(`Movido a ${pl?.name} → ${stage?.name || ''}`, 'success');
        }
      } catch (err) {
        toast('Error al mover: ' + err.message, 'error');
      }
    });
  }

  // ── Listeners de columnas (reordenar): se re-registran en cada render ──
  board.querySelectorAll('.pl-col-drag-handle').forEach(handle => {
    handle.addEventListener('mousedown', () => {
      const col = handle.closest('.pl-column');
      if (col) col.draggable = true;
    });
    // Ensure draggable resets if no drag happens
    handle.addEventListener('mouseup', () => {
      const col = handle.closest('.pl-column');
      if (col && !_kdColDragId) col.draggable = false;
    });
  });
  board.querySelectorAll('.pl-column').forEach(col => {
    col.addEventListener('dragstart', e => {
      if (!col.draggable) return;
      _kdColDragId = Number(col.dataset.stageId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'col:' + _kdColDragId);
      setTimeout(() => col.classList.add('is-col-dragging'), 0);
      e.stopPropagation(); // don't let card handler also fire
    });
    col.addEventListener('dragend', () => {
      col.draggable = false;
      col.classList.remove('is-col-dragging');
      document.querySelectorAll('#plBoard .pl-column').forEach(c => c.classList.remove('col-drag-over'));
      _kdColDragId = null;
    });
  });

  // ── Listeners de tarjetas: se re-registran en cada render ──
  board.querySelectorAll('.pl-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', e => {
      _kdDragId = Number(card.dataset.expId);
      _kdOriginPipeline = PL_ACTIVE_ID;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(_kdDragId));
      setTimeout(() => card.classList.add('is-dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      _kdClearHighlight();
      clearTimeout(_kdTabTimer);
      if (_kdDragId && _kdOriginPipeline && PL_ACTIVE_ID !== _kdOriginPipeline) {
        PL_ACTIVE_ID = _kdOriginPipeline;
        renderPipelineTabs();
        renderPipelinesBoard();
      }
      _kdDragId = null;
      _kdOriginPipeline = null;
    });
  });
}

const PL_ICONS = {
  building:   `<path d="M3 21V7l9-4 9 4v14"/><path d="M9 21v-6h6v6"/><path d="M9 9h.01M15 9h.01M9 13h.01M15 13h.01"/>`,
  briefcase:  `<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>`,
  barchart:   `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  target:     `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>`,
  star:       `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  trophy:     `<path d="M6 9H4a2 2 0 010-4h2"/><path d="M18 9h2a2 2 0 000-4h-2"/><path d="M6 5h12v7a6 6 0 01-12 0V5z"/><path d="M9 21h6m-3-3v3"/>`,
  users:      `<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75"/>`,
  package:    `<polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>`,
  cart:       `<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>`,
  phone:      `<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.63A2 2 0 012 1.84h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/>`,
  mail:       `<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>`,
  wrench:     `<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>`,
  bulb:       `<line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/>`,
  bell:       `<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>`,
  home:       `<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`,
  car:        `<rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`,
  clipboard:  `<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>`,
  calendar:   `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  rocket:     `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>`,
  dollar:     `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>`,
  handshake:  `<path d="M20.42 4.58a5.4 5.4 0 00-7.65 0l-.77.78-.77-.78a5.4 5.4 0 00-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z"/>`,
  graduation: `<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>`,
  truck:      `<rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>`,
  globe:      `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>`,
  settings:   `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>`,
};

function _updatePlIconPreview(iconKey, color) {
  const preview = document.getElementById('plIconPreview');
  if (!preview) return;
  if (iconKey && PL_ICONS[iconKey]) {
    preview.setAttribute('stroke', color);
    preview.innerHTML = PL_ICONS[iconKey];
  } else {
    preview.setAttribute('stroke', color);
    preview.innerHTML = `<circle cx="12" cy="12" r="10"/>`;
  }
}

function openManageModal(pipeline) {
  PL_MANAGE_ID = pipeline ? pipeline.id : null;
  document.getElementById('plManageTitle').textContent = pipeline ? 'Editar pipeline' : 'Nuevo pipeline';
  document.getElementById('plManageName').value = pipeline ? pipeline.name : '';
  document.getElementById('plManageColor').value = pipeline ? pipeline.color : '#2563eb';
  // Icono
  const iconBtn = document.getElementById('plIconBtn');
  const iconPreview = document.getElementById('plIconPreview');
  const iconInput = document.getElementById('plManageIcon');
  const currentColor = pipeline?.color || '#2563eb';
  const currentIcon = pipeline?.icon || '';
  if (iconInput) iconInput.value = currentIcon;
  _updatePlIconPreview(currentIcon, currentColor);
  // Renderizar opciones del picker
  const dropdown = document.getElementById('plIconDropdown');
  if (dropdown) {
    dropdown.innerHTML = `
      <button class="pl-icon-option pl-icon-clear ${!currentIcon ? 'is-active' : ''}" data-icon="">Sin icono</button>
      ${Object.entries(PL_ICONS).map(([key, _]) => `
        <button class="pl-icon-option ${key === currentIcon ? 'is-active' : ''}" data-icon="${key}" title="${key}">
          ${plIconSvg(key, currentColor, 18) || ''}
        </button>`).join('')}
    `;
    dropdown.querySelectorAll('.pl-icon-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.icon;
        const color = document.getElementById('plManageColor')?.value || '#2563eb';
        if (iconInput) iconInput.value = val;
        _updatePlIconPreview(val, color);
        dropdown.querySelectorAll('.pl-icon-option').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        dropdown.hidden = true;
      });
    });
  }
  // Live-update icon color when color picker changes
  document.getElementById('plManageColor')?.addEventListener('input', (e) => {
    const icon = document.getElementById('plManageIcon')?.value || '';
    _updatePlIconPreview(icon, e.target.value);
    // also update options in dropdown
    dropdown?.querySelectorAll('.pl-icon-option[data-icon]:not([data-icon=""])').forEach(btn => {
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('stroke', e.target.value);
    });
  });
  document.getElementById('plDeletePipelineBtn').hidden = !pipeline;
  renderStagesList(pipeline ? pipeline.stages : []);
  document.getElementById('plNewStageRow').hidden = true;
  document.getElementById('plManageModal').hidden = false;
}

function setupIconPicker() {
  const btn = document.getElementById('plIconBtn');
  const dropdown = document.getElementById('plIconDropdown');
  if (!btn || !dropdown) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !dropdown.contains(e.target)) dropdown.hidden = true;
  });
}

function closeManageModal() {
  document.getElementById('plManageModal').hidden = true;
  PL_MANAGE_ID = null;
}

function renderStagesList(stages) {
  const KIND_LABELS = { in_progress: 'En progreso', won: 'Ganado', lost: 'Perdido' };
  const botOptions = sbBots.map(b => `<option value="${b.id}">${escHtml(b.name)}</option>`).join('');
  document.getElementById('plStagesList').innerHTML = stages.map(s => {
    const bot = sbBots.find(b => b.id === s.bot_id);
    const botLabel = bot ? escHtml(bot.name) : 'Sin bot';
    return `
    <div class="pl-stage-row" data-stage-id="${s.id}" draggable="true">
      <span class="pl-stage-drag-handle" title="Arrastra para reordenar">
        <svg viewBox="0 0 16 24" fill="currentColor" width="10" height="16"><circle cx="5" cy="5" r="1.6"/><circle cx="11" cy="5" r="1.6"/><circle cx="5" cy="12" r="1.6"/><circle cx="11" cy="12" r="1.6"/><circle cx="5" cy="19" r="1.6"/><circle cx="11" cy="19" r="1.6"/></svg>
      </span>
      <span class="pl-stage-color-dot" style="background:${s.color}"></span>
      <span class="pl-stage-name">${escHtml(s.name)}</span>
      <span class="pl-stage-kind">${KIND_LABELS[s.kind] || s.kind}</span>
      <button class="pl-stage-bot-chip ${bot ? 'has-bot' : ''}" data-stage-bot-toggle="${s.id}" title="Bot asignado a esta etapa">
        <svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><rect x="3" y="7" width="14" height="10" rx="2"/><path d="M7 7V5a3 3 0 016 0v2"/><circle cx="7.5" cy="12" r="1.5"/><circle cx="12.5" cy="12" r="1.5"/></svg>
        ${botLabel}
      </button>
      <button class="pl-stage-edit-btn" data-stage-edit-toggle="${s.id}" title="Editar etapa">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M14.7 3.3a1 1 0 011.4 1.4l-9.8 9.8-2.8.7.7-2.8z"/></svg>
      </button>
      <button class="pl-stage-del" data-del-stage="${s.id}" title="Eliminar etapa">×</button>
    </div>
    <div class="pl-stage-edit-row" id="pl-edit-${s.id}" hidden>
      <input type="color" value="${s.color}" class="pl-stage-edit-color" data-edit-color-for="${s.id}" />
      <input type="text" value="${escHtml(s.name)}" class="form-input pl-stage-edit-name" data-edit-name-for="${s.id}" maxlength="60" />
      <select class="pl-stage-edit-kind" data-edit-kind-for="${s.id}">
        <option value="in_progress" ${s.kind==='in_progress'?'selected':''}>En progreso</option>
        <option value="won" ${s.kind==='won'?'selected':''}>Ganado</option>
        <option value="lost" ${s.kind==='lost'?'selected':''}>Perdido</option>
      </select>
      <button class="btn btn--primary btn--sm" data-save-stage="${s.id}">Guardar</button>
      <button class="btn btn--ghost btn--sm" data-cancel-stage-edit="${s.id}">×</button>
    </div>
    <div class="pl-stage-bot-row" id="pl-bot-${s.id}" hidden>
      <label style="font-size:12px;font-weight:600;white-space:nowrap">Bot en esta etapa:</label>
      <select class="pl-stage-bot-select" data-bot-select-for="${s.id}">
        <option value="">Sin bot</option>
        ${botOptions}
      </select>
      <button class="btn btn--primary btn--sm" data-save-bot="${s.id}">Asignar</button>
      <button class="btn btn--ghost btn--sm" data-cancel-bot="${s.id}">×</button>
    </div>`;
  }).join('') || '<p style="font-size:12px;color:var(--text-muted)">Sin etapas aún.</p>';

  // Pre-select current bot
  stages.forEach(s => {
    const sel = document.querySelector(`[data-bot-select-for="${s.id}"]`);
    if (sel && s.bot_id) sel.value = s.bot_id;
  });
}

// ════════════════════════════════
// FILTER PANEL (kanban + expedients)
// ════════════════════════════════

function applyExpFiltersClient(items, state) {
  const { q, searchIn, tags, fieldValues } = state;
  const lq = (q || '').trim().toLowerCase();
  return items.filter(e => {
    if (lq) {
      const name    = (e.name || '').toLowerCase();
      const contact = (e.contactName || '').toLowerCase();
      const matches = searchIn === 'name'    ? name.includes(lq)
                    : searchIn === 'contact' ? contact.includes(lq)
                    : name.includes(lq) || contact.includes(lq);
      if (!matches) return false;
    }
    if (tags.length && !tags.every(t => (e.tags || []).includes(t))) return false;
    for (const [fid, fval] of Object.entries(fieldValues || {})) {
      if (!fval) continue;
      const saved = (e.fieldValues || []).find(fv => String(fv.fieldId) === String(fid));
      if (!saved || !saved.value.toLowerCase().includes(fval.toLowerCase())) return false;
    }
    return true;
  });
}

function countActiveFilters(state) {
  let n = 0;
  if (state.searchIn !== 'all') n++;
  n += (state.tags || []).length;
  n += Object.values(state.fieldValues || {}).filter(v => v !== '').length;
  return n;
}

function updateFilterBadge(prefix) {
  const state = prefix === 'pl' ? PL_FILTERS : EXP_FILTERS;
  const n = countActiveFilters(state);
  const badge = document.getElementById(`${prefix}FilterBadge`);
  const btn   = document.getElementById(`${prefix}FilterBtn`);
  if (badge) { badge.textContent = n; badge.hidden = n === 0; }
  if (btn)   btn.classList.toggle('has-filters', n > 0);
}

function renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange }) {
  if (!panelEl) return;

  const fieldHtml = fieldDefs.map(def => {
    const val = state.fieldValues[def.id] ?? '';
    let inputHtml;
    if (def.fieldType === 'boolean') {
      inputHtml = `<div class="kf-tri-toggle">
        ${[['', 'Todos'], ['1', 'Activo'], ['0', 'Inactivo']].map(([v, l]) =>
          `<button class="kf-tri-opt ${val === v ? 'is-active' : ''}" data-fv-id="${def.id}" data-fv-val="${v}">${l}</button>`
        ).join('')}
      </div>`;
    } else if (def.fieldType === 'select' && def.options?.length) {
      inputHtml = `<select class="kf-input" data-fv-sel="${def.id}">
        <option value="">Todos</option>
        ${def.options.map(o => `<option value="${escapeHtml(o)}"${val===o?' selected':''}>${escapeHtml(o)}</option>`).join('')}
      </select>`;
    } else if (def.fieldType === 'datetime' || def.fieldType === 'date') {
      inputHtml = `<input class="kf-input kf-date-input" type="date" value="${escapeHtml(val)}" data-fv-inp="${def.id}" />`;
    } else if (def.fieldType === 'number') {
      inputHtml = `<input class="kf-input" type="number" placeholder="Valor…" value="${escapeHtml(val)}" data-fv-inp="${def.id}" />`;
    } else {
      inputHtml = `<input class="kf-input" type="text" placeholder="Buscar…" value="${escapeHtml(val)}" data-fv-inp="${def.id}" />`;
    }
    return `<div class="kf-field-row"><span class="kf-field-label">${escapeHtml(def.label)}</span>${inputHtml}</div>`;
  }).join('');

  panelEl.innerHTML = `
    <div class="kf-section">
      <div class="kf-section-title">Buscar en</div>
      <div class="kf-si-row">
        ${[['all','Todo'],['name','Nombre lead'],['contact','Contacto'],['phone','Teléfono'],['email','Email']].map(([v,l])=>
          `<button class="kf-si-btn ${state.searchIn===v?'is-active':''}" data-si="${v}">${l}</button>`
        ).join('')}
      </div>
    </div>
    ${tags.length ? `
    <div class="kf-section">
      <div class="kf-section-title">Etiquetas</div>
      <div class="kf-tag-chips">
        ${tags.map(t=>`<button class="kf-tag-chip ${(state.tags||[]).includes(t)?'is-active':''}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join('')}
      </div>
    </div>` : ''}
    ${fieldDefs.length ? `
    <div class="kf-section">
      <div class="kf-section-title">Campos personalizados</div>
      ${fieldHtml}
    </div>` : ''}
    <div class="kf-footer">
      <button class="kf-clear-btn">Limpiar filtros</button>
    </div>`;

  panelEl.querySelectorAll('[data-si]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); state.searchIn = btn.dataset.si; onChange(state); renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange }); });
  });
  panelEl.querySelectorAll('[data-tag]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); const t = btn.dataset.tag; state.tags = (state.tags||[]).includes(t) ? state.tags.filter(x=>x!==t) : [...(state.tags||[]), t]; onChange(state); renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange }); });
  });
  panelEl.querySelectorAll('[data-fv-id]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); state.fieldValues[btn.dataset.fvId] = btn.dataset.fvVal; onChange(state); renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange }); });
  });
  let _fvDeb = {};
  panelEl.querySelectorAll('[data-fv-inp]').forEach(inp => {
    const handler = (e) => {
      e.stopPropagation();
      clearTimeout(_fvDeb[inp.dataset.fvInp]);
      _fvDeb[inp.dataset.fvInp] = setTimeout(() => {
        state.fieldValues[inp.dataset.fvInp] = inp.value.trim();
        onChange(state);
      }, inp.type === 'date' ? 0 : 250);
    };
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
  });
  panelEl.querySelectorAll('[data-fv-sel]').forEach(sel => {
    sel.addEventListener('change', (e) => { e.stopPropagation(); state.fieldValues[sel.dataset.fvSel] = sel.value; onChange(state); });
  });
  panelEl.querySelector('.kf-clear-btn')?.addEventListener('click', (e) => { e.stopPropagation(); state.searchIn='all'; state.tags=[]; state.fieldValues={}; onChange(state); renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange }); });
}

function openFilterPanel(prefix, tags) {
  const panelEl = document.getElementById(`${prefix}FilterPanel`);
  if (!panelEl || !panelEl.hidden) return;
  const state    = prefix === 'pl' ? PL_FILTERS : EXP_FILTERS;
  const fieldDefs = (EXP_FIELD_DEFS || []).filter(d => d.entity === 'expedient' || !d.entity);
  const onChange = (s) => {
    updateFilterBadge(prefix);
    if (prefix === 'pl') { PL_FILTERS = s; renderPipelinesBoard(); }
    else { EXP_FILTERS = s; EXP_STATE.page = 1; loadExpedients(); }
  };
  renderFilterPanel(panelEl, { tags, fieldDefs, state, onChange });
  panelEl.hidden = false;
}

function closeFilterPanel(prefix) {
  const panelEl = document.getElementById(`${prefix}FilterPanel`);
  if (panelEl) panelEl.hidden = true;
}

function setupFilterButtons() {
  // Close panels on outside click
  document.addEventListener('click', (e) => {
    // pl panel anchored to topbar search wrap + extras
    const plPanel  = document.getElementById('plFilterPanel');
    const plAnchor = document.getElementById('topbarSearchWrap');
    const plExtras = document.getElementById('topbarPlExtras');
    const plBtn    = document.getElementById('plFilterBtn');
    if (plPanel && !plPanel.hidden) {
      if (!plAnchor?.contains(e.target) && !plExtras?.contains(e.target)) plPanel.hidden = true;
    }
    // exp panel — anchored to topbar search + topbar exp extras
    const expPanel   = document.getElementById('expFilterPanel');
    const expAnchor  = document.getElementById('topbarSearchWrap');
    const expExtras  = document.getElementById('topbarExpExtras');
    const expBtn     = document.getElementById('expFilterBtn');
    if (expPanel && !expPanel.hidden) {
      if (!expAnchor?.contains(e.target) && !expExtras?.contains(e.target) && !expBtn?.contains(e.target)) expPanel.hidden = true;
    }
  });

  // Pipeline filter button
  document.getElementById('plFilterBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const panel = document.getElementById('plFilterPanel');
    if (!panel.hidden) { panel.hidden = true; return; }
    await loadExpFieldDefs();
    // tags from current cache
    const allTags = [...new Set(PL_EXP_CACHE.flatMap(e => e.tags || []))].sort();
    openFilterPanel('pl', allTags);
  });

  // Expedients filter button
  document.getElementById('expFilterBtn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const panel = document.getElementById('expFilterPanel');
    if (!panel.hidden) { panel.hidden = true; return; }
    await loadExpFieldDefs();
    let tags = [];
    try { const d = await api('GET', '/api/expedients/tags'); tags = d.items || []; } catch (_) {}
    openFilterPanel('exp', tags);
  });
}

function setupPipelines() {
  // Topbar search drives pipeline filter when in pipelines view
  let _plSearchDebounce;
  document.getElementById('topbarSearchInput')?.addEventListener('input', e => {
    if (document.body.dataset.viewActive !== 'pipelines') return;
    clearTimeout(_plSearchDebounce);
    _plSearchDebounce = setTimeout(() => {
      PL_FILTERS.q = e.target.value;
      PL_SEARCH = PL_FILTERS.q;
      updateFilterBadge('pl');
      renderPipelinesBoard();
    }, 200);
  });

  // Board sort
  document.getElementById('plBoardSort')?.addEventListener('change', e => {
    PL_SORT = e.target.value;
    renderPipelinesBoard();
  });

  // Tab switch
  document.getElementById('plTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-pl-id]');
    if (!btn) return;
    PL_ACTIVE_ID = Number(btn.dataset.plId);
    renderPipelineTabs();
    renderPipelinesBoard();
  });

  // Tab drag-to-reorder: mousedown on handle → enable draggable, then handle dragstart/end
  document.getElementById('plTabs')?.addEventListener('mousedown', e => {
    const handle = e.target.closest('.pl-tab-drag-handle');
    if (!handle) return;
    const tab = handle.closest('.pl-tab');
    if (tab) tab.draggable = true;
  });
  document.getElementById('plTabs')?.addEventListener('mouseup', e => {
    const tab = e.target.closest('.pl-tab');
    if (tab && !_kdPipelineDragId) tab.draggable = false;
  });
  document.getElementById('plTabs')?.addEventListener('dragstart', e => {
    const tab = e.target.closest('.pl-tab[draggable]');
    if (!tab) return;
    _kdPipelineDragId = Number(tab.dataset.plId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'pl:' + _kdPipelineDragId);
    setTimeout(() => tab.classList.add('is-pl-dragging'), 0);
    e.stopPropagation();
  });
  document.getElementById('plTabs')?.addEventListener('dragend', e => {
    const tab = e.target.closest('.pl-tab');
    if (tab) { tab.draggable = false; tab.classList.remove('is-pl-dragging'); }
    document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('pl-tab-drop-target'));
    _kdPipelineDragId = null;
  });

  // Drag sobre tab de pipeline → reorder si es pipeline drag, switch si es card drag
  let _tabHoverId = null;

  document.getElementById('plTabs')?.addEventListener('dragover', e => {
    const btn = e.target.closest('[data-pl-id]');
    if (!btn) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    // Pipeline reorder mode
    if (_kdPipelineDragId) {
      document.querySelectorAll('.pl-tab').forEach(t =>
        t.classList.toggle('pl-tab-drop-target', t === btn && Number(t.dataset.plId) !== _kdPipelineDragId)
      );
      return;
    }

    // Card drag over tab → switch pipeline after 400ms
    document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('drag-over'));
    btn.classList.add('drag-over');
    const hoverPipelineId = Number(btn.dataset.plId);
    if (hoverPipelineId === _tabHoverId) return;
    _tabHoverId = hoverPipelineId;
    clearTimeout(_kdTabTimer);
    _kdTabTimer = setTimeout(() => {
      if (PL_ACTIVE_ID !== hoverPipelineId) {
        PL_ACTIVE_ID = hoverPipelineId;
        renderPipelineTabs();
        renderPipelinesBoard();
      }
    }, 400);
  });

  document.getElementById('plTabs')?.addEventListener('dragleave', e => {
    if (!document.getElementById('plTabs').contains(e.relatedTarget)) {
      clearTimeout(_kdTabTimer);
      _tabHoverId = null;
      document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('drag-over', 'pl-tab-drop-target'));
    }
  });

  // Drop en tab
  document.getElementById('plTabs')?.addEventListener('drop', async e => {
    const btn = e.target.closest('[data-pl-id]');
    if (!btn) return;
    e.preventDefault();
    clearTimeout(_kdTabTimer);
    document.querySelectorAll('.pl-tab').forEach(t => t.classList.remove('drag-over', 'pl-tab-drop-target'));

    // Pipeline reorder
    if (_kdPipelineDragId) {
      const fromId = _kdPipelineDragId;
      const toId   = Number(btn.dataset.plId);
      _kdPipelineDragId = null;
      if (fromId === toId) return;

      const tabs  = [...document.querySelectorAll('#plTabs .pl-tab')];
      const ids   = tabs.map(t => Number(t.dataset.plId));
      const fromIdx = ids.indexOf(fromId);
      const toIdx   = ids.indexOf(toId);
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, fromId);

      // Instant DOM reorder
      const dragTab = tabs[fromIdx];
      const dropTab = tabs[toIdx];
      if (fromIdx < toIdx) dropTab.after(dragTab);
      else dropTab.before(dragTab);

      PIPELINES.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

      try {
        await api('POST', '/api/pipelines/reorder', { order: ids });
      } catch (err) { toast(err.message, 'error'); await loadPipelinesKanban(); }
      return;
    }

    // Card drop onto tab → move to first stage of that pipeline
    const targetPipelineId = Number(btn.dataset.plId);
    const expId = Number(e.dataTransfer.getData('text/plain') || 0) || _kdDragId;
    if (!expId || !targetPipelineId) return;

    const exp = PL_EXP_CACHE.find(x => x.id === expId);
    if (!exp || exp.pipelineId === targetPipelineId) return;

    const targetPipeline = PIPELINES.find(p => p.id === targetPipelineId);
    const firstStage = targetPipeline?.stages?.[0];
    if (!firstStage) { toast('El pipeline no tiene etapas', 'error'); return; }

    try {
      await api('PATCH', `/api/expedients/${expId}`, { pipelineId: targetPipelineId, stageId: firstStage.id });
      exp.pipelineId   = targetPipelineId;
      exp.stageId      = firstStage.id;
      PL_ACTIVE_ID     = targetPipelineId;
      renderPipelineTabs();
      renderPipelinesBoard();
      toast(`Movido a ${targetPipeline.name} → ${firstStage.name}`, 'success');
    } catch (err) {
      toast('Error al mover: ' + err.message, 'error');
    }
    _kdDragId = null;
  });

  // Open manage from topbar button (edits active pipeline)
  document.getElementById('plManageBtn')?.addEventListener('click', () => {
    const pl = PIPELINES.find(p => p.id === PL_ACTIVE_ID);
    openManageModal(pl || null);
  });

  // New pipeline
  ['plNewPipelineBtn', 'plNewPipelineBtn2'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => openManageModal(null));
  });

  // Close modal
  document.getElementById('plManageModal')?.addEventListener('click', e => {
    if (e.target.hasAttribute('data-close-pl-manage') || e.target === document.getElementById('plManageModal')) closeManageModal();
  });

  // Add stage row
  document.getElementById('plAddStageBtn')?.addEventListener('click', () => {
    document.getElementById('plNewStageRow').hidden = false;
    document.getElementById('plNewStageName').focus();
  });
  document.getElementById('plCancelNewStageBtn')?.addEventListener('click', () => {
    document.getElementById('plNewStageRow').hidden = true;
    document.getElementById('plNewStageName').value = '';
  });

  // Save new stage
  document.getElementById('plSaveNewStageBtn')?.addEventListener('click', async () => {
    if (!PL_MANAGE_ID) { toast('Guarda el pipeline primero', 'warning'); return; }
    const name = document.getElementById('plNewStageName').value.trim();
    const color = document.getElementById('plNewStageColor').value;
    const kind = document.getElementById('plNewStageKind').value;
    if (!name) { toast('Escribe el nombre de la etapa', 'error'); return; }
    try {
      await api('POST', `/api/pipelines/${PL_MANAGE_ID}/stages`, { name, color, kind });
      document.getElementById('plNewStageRow').hidden = true;
      document.getElementById('plNewStageName').value = '';
      await loadPipelinesKanban();
      const updated = PIPELINES.find(p => p.id === PL_MANAGE_ID);
      if (updated) renderStagesList(updated.stages);
      toast('Etapa agregada', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Stage list: delegated handler for delete / edit-toggle / bot-toggle / save-edit / save-bot
  document.getElementById('plStagesList')?.addEventListener('click', async e => {
    // Delete
    const delBtn = e.target.closest('[data-del-stage]');
    if (delBtn) {
      if (!confirm('¿Eliminar esta etapa?')) return;
      try {
        await api('DELETE', `/api/pipelines/stages/${delBtn.dataset.delStage}`);
        await loadPipelinesKanban();
        const updated = PIPELINES.find(p => p.id === PL_MANAGE_ID);
        if (updated) renderStagesList(updated.stages);
        toast('Etapa eliminada', 'success');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    // Toggle edit row
    const editToggle = e.target.closest('[data-stage-edit-toggle]');
    if (editToggle) {
      const id = editToggle.dataset.stageEditToggle;
      const row = document.getElementById(`pl-edit-${id}`);
      if (row) row.hidden = !row.hidden;
      return;
    }

    // Cancel edit
    const cancelEdit = e.target.closest('[data-cancel-stage-edit]');
    if (cancelEdit) {
      const row = document.getElementById(`pl-edit-${cancelEdit.dataset.cancelStageEdit}`);
      if (row) row.hidden = true;
      return;
    }

    // Save stage edit
    const saveStage = e.target.closest('[data-save-stage]');
    if (saveStage) {
      const id = saveStage.dataset.saveStage;
      const name  = document.querySelector(`[data-edit-name-for="${id}"]`)?.value.trim();
      const color = document.querySelector(`[data-edit-color-for="${id}"]`)?.value;
      const kind  = document.querySelector(`[data-edit-kind-for="${id}"]`)?.value;
      if (!name) { toast('El nombre no puede estar vacío', 'error'); return; }
      try {
        await api('PATCH', `/api/pipelines/stages/${id}`, { name, color, kind });
        await loadPipelinesKanban();
        const updated = PIPELINES.find(p => p.id === PL_MANAGE_ID);
        if (updated) renderStagesList(updated.stages);
        toast('Etapa actualizada', 'success');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    // Toggle bot row
    const botToggle = e.target.closest('[data-stage-bot-toggle]');
    if (botToggle) {
      const id = botToggle.dataset.stageBotToggle;
      const row = document.getElementById(`pl-bot-${id}`);
      if (row) row.hidden = !row.hidden;
      return;
    }

    // Cancel bot
    const cancelBot = e.target.closest('[data-cancel-bot]');
    if (cancelBot) {
      const row = document.getElementById(`pl-bot-${cancelBot.dataset.cancelBot}`);
      if (row) row.hidden = true;
      return;
    }

    // Save bot assignment
    const saveBot = e.target.closest('[data-save-bot]');
    if (saveBot) {
      const id  = saveBot.dataset.saveBot;
      const sel = document.querySelector(`[data-bot-select-for="${id}"]`);
      const botId = sel?.value ? Number(sel.value) : null;
      try {
        await api('PATCH', `/api/pipelines/stages/${id}`, { bot_id: botId });
        await loadPipelinesKanban();
        const updated = PIPELINES.find(p => p.id === PL_MANAGE_ID);
        if (updated) renderStagesList(updated.stages);
        toast(botId ? 'Bot asignado a la etapa' : 'Bot desvinculado', 'success');
      } catch (err) { toast(err.message, 'error'); }
      return;
    }
  });

  // Stage drag-to-reorder inside manage modal
  document.getElementById('plStagesList')?.addEventListener('dragstart', e => {
    const row = e.target.closest('.pl-stage-row[draggable]');
    if (!row) return;
    e.dataTransfer.setData('text/plain', row.dataset.stageId);
    row.classList.add('is-dragging');
  });
  document.getElementById('plStagesList')?.addEventListener('dragend', e => {
    document.querySelectorAll('.pl-stage-row').forEach(r => r.classList.remove('is-dragging', 'drag-over-stage'));
  });
  document.getElementById('plStagesList')?.addEventListener('dragover', e => {
    e.preventDefault();
    const row = e.target.closest('.pl-stage-row');
    if (!row) return;
    document.querySelectorAll('.pl-stage-row').forEach(r => r.classList.remove('drag-over-stage'));
    row.classList.add('drag-over-stage');
  });
  document.getElementById('plStagesList')?.addEventListener('drop', async e => {
    e.preventDefault();
    const dragId = Number(e.dataTransfer.getData('text/plain'));
    const dropRow = e.target.closest('.pl-stage-row');
    document.querySelectorAll('.pl-stage-row').forEach(r => r.classList.remove('is-dragging', 'drag-over-stage'));
    if (!dropRow || !dragId || !PL_MANAGE_ID) return;
    const dropId = Number(dropRow.dataset.stageId);
    if (dragId === dropId) return;

    // Reorder locally then persist
    const rows = [...document.querySelectorAll('#plStagesList .pl-stage-row')];
    const ids = rows.map(r => Number(r.dataset.stageId));
    const fromIdx = ids.indexOf(dragId);
    const toIdx = ids.indexOf(dropId);
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, dragId);

    // Move DOM node immediately for instant feedback
    const dragNode = rows[fromIdx];
    const dropNode = rows[toIdx];
    if (fromIdx < toIdx) dropNode.after(dragNode);
    else dropNode.before(dragNode);

    try {
      await api('POST', `/api/pipelines/${PL_MANAGE_ID}/stages/reorder`, { order: ids });
      await loadPipelinesKanban();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Save pipeline (create or update)
  document.getElementById('plSavePipelineBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('plManageName').value.trim();
    const color = document.getElementById('plManageColor').value;
    const icon = document.getElementById('plManageIcon')?.value || null;
    if (!name) { toast('Escribe el nombre del pipeline', 'error'); return; }
    try {
      if (PL_MANAGE_ID) {
        await api('PATCH', `/api/pipelines/${PL_MANAGE_ID}`, { name, color, icon });
        toast('Pipeline actualizado', 'success');
      } else {
        const data = await api('POST', '/api/pipelines', { name, color, icon });
        PL_MANAGE_ID = data.item.id;
        PL_ACTIVE_ID = data.item.id;
        toast('Pipeline creado', 'success');
        document.getElementById('plDeletePipelineBtn').hidden = false;
      }
      await loadPipelinesKanban();
      closeManageModal();
    } catch (err) { toast(err.message, 'error'); }
  });

  // Delete pipeline
  document.getElementById('plDeletePipelineBtn')?.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este pipeline y todas sus etapas?')) return;
    try {
      await api('DELETE', `/api/pipelines/${PL_MANAGE_ID}`);
      PL_ACTIVE_ID = null;
      PL_MANAGE_ID = null;
      closeManageModal();
      await loadPipelinesKanban();
      toast('Pipeline eliminado', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // Click card → open expedient detail (from pipelines)
  document.getElementById('plBoard')?.addEventListener('click', e => {
    if (e.target.closest('.pl-card[draggable]') && e.defaultPrevented) return;
    const card = e.target.closest('.pl-card');
    if (!card) return;
    openExpDetail(Number(card.dataset.expId), 'pipelines');
  });
}

// ─── Chat search ───
function setupChatSearch() {
  const input = document.querySelector('.rh-search-wrap input');
  if (!input) return;
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      CHAT_SEARCH = input.value.trim();
      loadConversations();
    }, 300);
  });
}

// ─── Chat filter pills ───
function setupChatFilters() {
  document.querySelector('.rh-filter-pills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.rh-filter-pill');
    if (!pill) return;
    document.querySelectorAll('.rh-filter-pill').forEach((p) => p.classList.remove('rh-active'));
    pill.classList.add('rh-active');
    const text = pill.textContent.trim().toLowerCase();
    CHAT_FILTER_UNREAD = text.startsWith('no leídos');
    CHAT_FILTER_PROVIDER = text.startsWith('whatsapp') ? 'whatsapp'
                         : text.startsWith('instagram') ? 'instagram'
                         : text.startsWith('messenger') ? 'messenger'
                         : '';
    loadConversations();
  });
}

// ─── Reply form ───
function setupReplyForm() {
  const form = document.querySelector('.rh-reply-form');
  if (!form) return;
  const textarea = form.querySelector('textarea');

  // Auto-grow textarea
  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  // Ctrl+Enter or Enter (without Shift) to send
  textarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const convoId = Number(form.dataset.convoId);
    if (!convoId) { toast('Selecciona una conversación primero', 'warning'); return; }
    const body = textarea?.value.trim();
    if (!body) return;

    try {
      const msg = await api('POST', `/api/conversations/${convoId}/messages`, { body });
      CHAT_MESSAGES.push(msg);
      renderMessages();
      if (textarea) { textarea.value = ''; textarea.style.height = 'auto'; }
      // Actualizar preview en la lista
      const convo = CONVERSATIONS.find((c) => c.id === convoId);
      if (convo) { convo.lastMessage = body; convo.time = msg.time || ''; renderChatList(); }
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

// ─── Poll for new messages ───
function startChatPolling() {
  if (_chatPollTimer) clearInterval(_chatPollTimer);
  _chatPollTimer = setInterval(async () => {
    if (document.body.dataset.viewActive !== 'chats') return;
    const prevTotal = CONVERSATIONS.reduce((s, c) => s + c.unreadCount, 0);
    await loadConversations();
    // Si estamos viendo una conversación, refrescar mensajes
    if (ACTIVE_CONVO_ID) {
      const prevCount = CHAT_MESSAGES.length;
      await loadMessages(ACTIVE_CONVO_ID);
      if (CHAT_MESSAGES.length > prevCount) {
        api('PATCH', `/api/conversations/${ACTIVE_CONVO_ID}/read`).catch(() => {});
      }
    }
  }, 5000);
}

// ═══════ Papelera ═══════

const TRASH_LABELS = { contact: 'Contacto', expedient: 'Expediente', pipeline: 'Pipeline', stage: 'Etapa', salsbot: 'Bot' };
const TRASH_ICONS  = {
  contact:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  expedient: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  pipeline:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
  stage:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>`,
  salsbot:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>`,
};

let _trashItems = [];
let _trashFilter = 'all';

function _trashDaysLeft(expiresAt) {
  const secs = expiresAt - Math.floor(Date.now() / 1000);
  if (secs <= 0) return 'Expirado';
  const days = Math.ceil(secs / 86400);
  return `${days} día${days === 1 ? '' : 's'}`;
}

function renderTrashList() {
  const container = document.getElementById('trashList');
  if (!container) return;

  const filtered = _trashFilter === 'all'
    ? _trashItems
    : _trashItems.filter(i => i.entityType === _trashFilter);

  if (!filtered.length) {
    container.innerHTML = `<div class="trash-empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6m4-6v6"/></svg>
      <p>${_trashFilter === 'all' ? 'La papelera está vacía' : 'No hay elementos de este tipo'}</p>
    </div>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const daysLeft = _trashDaysLeft(item.expiresAt);
    const urgent = (item.expiresAt - Math.floor(Date.now() / 1000)) < 3 * 86400;
    return `<div class="trash-item" data-id="${item.id}">
      <div class="trash-item-icon">${TRASH_ICONS[item.entityType] || ''}</div>
      <div class="trash-item-body">
        <div class="trash-item-name">${escHtml(item.entityName || '—')}</div>
        <div class="trash-item-meta">
          <span class="trash-type-badge trash-type-${item.entityType}">${TRASH_LABELS[item.entityType] || item.entityType}</span>
          ${item.deletedByName ? `<span>por ${escHtml(item.deletedByName)}</span>` : ''}
          <span>${new Date(item.deletedAt * 1000).toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })}</span>
          <span class="trash-expires ${urgent ? 'trash-expires--urgent' : ''}">Expira en ${daysLeft}</span>
        </div>
      </div>
      <div class="trash-item-actions">
        <button class="btn btn--sm btn--secondary trash-restore-btn" data-id="${item.id}" title="Recuperar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
          Recuperar
        </button>
        <button class="btn btn--sm btn--danger-ghost trash-delete-btn" data-id="${item.id}" title="Eliminar permanentemente">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

async function loadTrash() {
  const container = document.getElementById('trashList');
  if (!container) return;
  container.innerHTML = `<div class="trash-loading">Cargando…</div>`;
  try {
    const data = await api('GET', '/api/trash');
    _trashItems = data.items || [];
    renderTrashList();
  } catch (e) {
    container.innerHTML = `<div class="trash-empty-state"><p>Error al cargar la papelera</p></div>`;
  }
}

function setupTrash() {
  // Filtros
  document.querySelector('.trash-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.trash-filter-btn');
    if (!btn) return;
    document.querySelectorAll('.trash-filter-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    _trashFilter = btn.dataset.filter;
    renderTrashList();
  });

  // Acciones delegadas (restaurar / eliminar permanente)
  document.getElementById('trashList')?.addEventListener('click', async e => {
    const restoreBtn = e.target.closest('.trash-restore-btn');
    const deleteBtn  = e.target.closest('.trash-delete-btn');

    if (restoreBtn) {
      const id = Number(restoreBtn.dataset.id);
      restoreBtn.disabled = true;
      restoreBtn.textContent = 'Recuperando…';
      try {
        await api('POST', `/api/trash/${id}/restore`);
        _trashItems = _trashItems.filter(i => i.id !== id);
        renderTrashList();
        _rhToast('Elemento recuperado correctamente');
      } catch (err) {
        _rhToast(err.message || 'No se pudo recuperar', 'error');
        restoreBtn.disabled = false;
        restoreBtn.textContent = 'Recuperar';
      }
    }

    if (deleteBtn) {
      const id = Number(deleteBtn.dataset.id);
      const item = _trashItems.find(i => i.id === id);
      if (!confirm(`¿Eliminar "${item?.entityName || 'este elemento'}" permanentemente? Esta acción no se puede deshacer.`)) return;
      try {
        await api('DELETE', `/api/trash/${id}`);
        _trashItems = _trashItems.filter(i => i.id !== id);
        renderTrashList();
      } catch (err) {
        _rhToast(err.message || 'Error al eliminar', 'error');
      }
    }
  });

  // Vaciar todo
  document.getElementById('trashEmptyAll')?.addEventListener('click', async () => {
    if (!_trashItems.length) return;
    if (!confirm(`¿Vaciar la papelera permanentemente? Se eliminarán ${_trashItems.length} elemento${_trashItems.length === 1 ? '' : 's'} y no podrán recuperarse.`)) return;
    try {
      await api('DELETE', '/api/trash');
      _trashItems = [];
      renderTrashList();
    } catch (err) {
      _rhToast(err.message || 'Error al vaciar', 'error');
    }
  });
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _rhToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `rh-toast rh-toast--${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('rh-toast--show'));
  setTimeout(() => {
    el.classList.remove('rh-toast--show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ═══════ Bootstrap ═══════
// Detectar si estamos en /chat (vista personal del asesor)
window.PERSONAL_MODE = (window.location.pathname === '/chat' || window.location.pathname === '/chat/');
window.PERSONAL_SHOW_HIDDEN = false;

document.addEventListener("DOMContentLoaded", async () => {
  // Redirigir a login si no hay token
  if (!getToken()) {
    const redir = window.PERSONAL_MODE ? '?redirect=/chat' : '';
    window.location.href = '/login.html' + redir;
    return;
  }

  // En /chat: aplicar UI limpia (oculta nav lateral, fuerza vista chats)
  if (window.PERSONAL_MODE) {
    document.body.classList.add('personal-mode');
    localStorage.setItem('lastView', 'chats');
    // Mostrar toggle "Mostrar ocultos" + hookup
    const toggleWrap = document.getElementById('rhPersonalToggle');
    const toggleInput = document.getElementById('rhPersonalShowHidden');
    if (toggleWrap) toggleWrap.hidden = false;
    if (toggleInput) {
      toggleInput.addEventListener('change', () => {
        window.PERSONAL_SHOW_HIDDEN = toggleInput.checked;
        loadConversations();
      });
    }
  }

  // Mostrar nombre del asesor y configurar logout
  const _advisor = getAdvisor();
  if (_advisor) {
    const nameEl   = document.getElementById('navAdvisorName');
    const avatarEl = document.getElementById('navAdvisorAvatar');
    if (nameEl)   nameEl.textContent   = _advisor.name;
    if (avatarEl) avatarEl.textContent = (_advisor.name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    // Aplicar permisos: ocultar acciones que no tiene
    if (_advisor.role !== 'admin' && !_advisor.permissions?.delete) {
      document.querySelectorAll('[data-perm="delete"]').forEach(e => e.hidden = true);
    }
    if (_advisor.role !== 'admin' && !_advisor.permissions?.manage_advisors) {
      document.querySelectorAll('[data-perm="manage_advisors"]').forEach(e => e.hidden = true);
    }
    if (_advisor.role === 'admin') {
      document.querySelectorAll('[data-admin-only]').forEach(e => { e.hidden = false; });
    }
  }
  document.getElementById('navLogoutBtn')?.addEventListener('click', () => {
    if (confirm('¿Cerrar sesión?')) logout();
  });

  async function clearCacheAndReload(e) {
    if (!confirm('¿Limpiar caché y recargar? Útil después de un deploy si no ves cambios.')) return;
    const btn = e.currentTarget;
    btn.classList.add('is-spinning');
    btn.disabled = true;
    const cb = Date.now().toString(36);

    // 1) Refresh in-place de CSS — modifica el href de cada <link> con cache-buster.
    //    Esto fuerza re-fetch del CSS (cache miss por URL distinta) y re-aplica estilos
    //    SIN esperar el reload completo — el cambio visual es instantáneo.
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
      try {
        const u = new URL(link.href, window.location.href);
        u.searchParams.set('_cb', cb);
        link.href = u.toString();
      } catch (_) {}
    });

    // 2) Limpiar caches del Service Worker (si los hay) y desregistrar SW.
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (err) {
      console.error('cache-clear', err);
    }

    // 3) Hard reload con cache-buster en la URL — fuerza HTML+JS frescos.
    //    Combinado con el middleware no-cache del server, los <script> y <link>
    //    del HTML nuevo se piden con If-None-Match y Safari ya no los devuelve cacheados.
    const url = new URL(window.location.href);
    url.searchParams.set('_cb', cb);
    window.location.replace(url.toString());
  }
  document.getElementById('navCacheBtn')?.addEventListener('click', clearCacheAndReload);
  document.getElementById('navBrandCacheBtn')?.addEventListener('click', clearCacheAndReload);

  setupTrash();
  setupNav();
  setupSettingsTabs();
  setupCustomers();
  setupImport();
  setupIntegrations();
  setupExpedients();
  setupPipelines();
  setupAccount();
  setupChatSearch();
  setupChatFilters();
  setupReplyForm();

  // Bot toggle handler (usa conversación cuando está disponible)
  document.getElementById('rhBotToggle')?.addEventListener('click', async () => {
    const newPaused = !_chatBotPaused;
    try {
      if (_chatConvoId) {
        await api('PATCH', `/api/conversations/${_chatConvoId}/bot-paused`, { paused: newPaused });
      } else if (_chatContactId) {
        await api('PATCH', `/api/contacts/${_chatContactId}/bot-paused`, { paused: newPaused });
      }
    } catch (err) { toast(err.message, 'error'); return; }
    _chatBotPaused = newPaused;
    updateBotToggleUI();
    toast(newPaused ? 'Bot pausado' : 'Bot reanudado', newPaused ? 'warning' : 'success');
  });

  setupExpDetail();
  setupIconPicker();
  setupFilterButtons();
  setupBot();
  setupTemplates();
  setupTplPicker();
  setupDashboard();
  setupAdvisors();
  setupMachineTokens();
  setupNotifications();
  registerServiceWorker();
  const _savedView   = localStorage.getItem('lastView') || 'chats';
  const _savedExpId  = localStorage.getItem('lastExpDetailId');
  const _savedExpFrom = localStorage.getItem('lastExpDetailFrom') || 'pipelines';

  if (_savedView === 'exp-detail' && _savedExpId) {
    // openExpDetail calls showView('exp-detail') internally
    openExpDetail(Number(_savedExpId), _savedExpFrom);
  } else {
    showView(_savedView);
  }

  await Promise.all([
    loadConversations(),
    loadCustomers(),
    loadPipelines(),
    loadIntegrations(),
    loadOutgoingWebhooks(),
    loadExpedients(),
    loadSalsbots(),
    loadPipelinesKanban(),
    loadProfile(),
    loadAdvisors(),
    loadTemplates(),
  ]);
  startChatPolling();
});

// Traduce códigos de wa_rejected_reason de Meta a texto entendible.
const _META_REJECTED_LABELS = {
  INVALID_FORMAT: 'Formato inválido. Revisa: {{N}} bien numeradas, footer sin URLs, ejemplos llenados, sin sintaxis {nombre} (una sola llave).',
  TAG_CONTENT_MISMATCH: 'Contenido no coincide con la categoría. Si tiene "descuento" u "oferta" → cámbiala a MARKETING.',
  PROMOTIONAL: 'Marcada como promocional pero está en categoría UTILITY. Cámbiala a MARKETING.',
  CATEGORY_MISMATCH: 'Categoría incorrecta. Promociones → MARKETING; confirmaciones → UTILITY; OTPs → AUTHENTICATION.',
  ABUSIVE_CONTENT: 'Contenido detectado como abusivo o spam. Suaviza el body.',
  INVALID_VARIABLE_FORMAT: 'Variables mal formadas. Usa {{1}}, {{2}} consecutivos sin saltos.',
  SCAM: 'Detectada como posible scam. Usa lenguaje neutral, no urgente.',
  NONE: 'Sin razón específica',
};
function _friendlyRejectedReason(reason) {
  if (!reason) return '';
  return _META_REJECTED_LABELS[reason] || reason;
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── Template picker (shared, used from both chat contexts) ──────────────────

function _wa24Open(provider, lastIncomingAt) {
  // Returns: 'open' | 'closed' | 'none' (not WhatsApp)
  if (provider !== 'whatsapp') return 'none';
  if (!lastIncomingAt) return 'closed';
  return Date.now() < lastIncomingAt * 1000 + 86_400_000 ? 'open' : 'closed';
}

function _tplAvailability(tpl, provider, lastIncomingAt) {
  const wa24 = _wa24Open(provider, lastIncomingAt);
  if (tpl.type === 'wa_api') {
    if (provider !== 'whatsapp') return { ok: false, reason: 'Solo WhatsApp' };
    if (tpl.waStatus !== 'approved') return { ok: false, reason: `Plantilla ${tpl.waStatus === 'pending' ? 'pendiente de aprobación' : tpl.waStatus === 'rejected' ? 'rechazada por Meta' : 'no aprobada'}` };
    return { ok: true };
  }
  // free_form
  if (wa24 === 'closed') return { ok: false, reason: 'Ventana de 24h cerrada' };
  return { ok: true };
}

let _tplPickerCtx = null; // { textarea, provider, lastIncomingAt }

// Wrapper para abrir el picker desde el bot builder (step "Enviar mensaje").
// Solo muestra plantillas básicas (free_form) y al elegir una copia el body
// al textarea, sin abrir el modal de "Enviar plantilla" que es para chat.
function openTplPickerForBotMessage(triggerEl, textarea) {
  return openTplPicker(triggerEl, textarea, 'whatsapp', null, 'bot-message');
}

async function openTplPicker(triggerEl, textarea, provider, lastIncomingAt, mode = 'chat') {
  const picker = document.getElementById('rhTplPicker');
  if (!picker) return;

  // Toggle off if same trigger
  if (!picker.hidden && _tplPickerCtx?.textarea === textarea) {
    picker.hidden = true;
    _tplPickerCtx = null;
    return;
  }

  _tplPickerCtx = { textarea, provider, lastIncomingAt, mode };

  // Load templates if not yet loaded
  if (!_tplItems.length) {
    try { _tplItems = await api('GET', '/api/templates'); } catch (_) {}
  }

  const search = document.getElementById('rhTplSearch');
  if (search) search.value = '';
  _renderTplPickerList('');

  // Position above the trigger button
  picker.hidden = false;
  const rect = triggerEl.getBoundingClientRect();
  picker.style.left = Math.max(8, rect.left) + 'px';
  picker.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
  picker.style.top = '';

  // Clamp to viewport width
  const pw = picker.offsetWidth || 320;
  if (rect.left + pw > window.innerWidth - 8) {
    picker.style.left = Math.max(8, window.innerWidth - pw - 8) + 'px';
  }

  if (search) search.focus();
}

function _renderTplPickerList(query) {
  const list = document.getElementById('rhTplList');
  const ctx  = _tplPickerCtx;
  if (!list || !ctx) return;

  const q = query.toLowerCase().trim();
  const items = _tplItems.filter(t => {
    // Mostramos ambos tipos. En modo bot-message, click en wa_api solo
    // copia el body como texto (no la envía como template). Para envío
    // real como wa_api template existe el step "Enviar plantilla".
    if (q && !(t.displayName || t.name || '').toLowerCase().includes(q) &&
             !(t.body || '').toLowerCase().includes(q)) return false;
    return true;
  });

  if (!items.length) {
    list.innerHTML = `<div class="rh-tpl-empty">${q ? 'Sin resultados' : 'No hay plantillas creadas'}</div>`;
    return;
  }

  const wa24Label = ctx.provider === 'whatsapp'
    ? (_wa24Open(ctx.provider, ctx.lastIncomingAt) === 'open' ? '· ventana abierta' : '· ventana cerrada')
    : '';

  // Group: wa_api first, then free_form
  const sorted = [...items].sort((a, b) => {
    if (a.type === b.type) return (a.displayName || a.name).localeCompare(b.displayName || b.name);
    return a.type === 'wa_api' ? -1 : 1;
  });

  // Hint en modo bot-message para clarificar el comportamiento
  const botModeHint = ctx.mode === 'bot-message'
    ? '<div class="rh-tpl-mode-hint">💡 Click en cualquier plantilla → se copia el <strong>texto</strong> al mensaje. <strong>Importante:</strong> el bot la enviará como TEXTO (sujeto a la ventana 24h de WhatsApp aunque uses el body de una plantilla aprobada). Para garantizar envío como template aprobada (sirve fuera 24h), agrega un step <strong>"Enviar plantilla"</strong>.</div>'
    : '';

  let lastType = null;
  list.innerHTML = botModeHint + sorted.map(t => {
    const avail = _tplAvailability(t, ctx.provider, ctx.lastIncomingAt);
    // En modo bot-message todas son seleccionables (no aplica el lock por ventana 24h)
    const effectiveAvail = ctx.mode === 'bot-message' ? { ok: true } : avail;
    const header = t.type !== lastType
      ? `<div class="rh-tpl-group-label">${t.type === 'wa_api' ? 'WhatsApp API' : 'Básicas'}${ctx.mode === 'bot-message' ? '' : (t.type === 'wa_api' ? ' (siempre)' : ' ' + wa24Label)}</div>`
      : '';
    lastType = t.type;

    const icon = t.type === 'wa_api'
      ? `<svg class="rh-tpl-item-icon" viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M11.994 0C5.372 0 0 5.373 0 12c0 2.118.554 4.103 1.522 5.83L0 24l6.354-1.489A11.946 11.946 0 0011.994 24C18.616 24 24 18.627 24 12S18.616 0 11.994 0z" opacity=".15"/></svg>`
      : `<svg class="rh-tpl-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`;

    const lockIcon = effectiveAvail.ok ? '' :
      `<svg class="rh-tpl-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`;

    return `${header}<button class="rh-tpl-item${effectiveAvail.ok ? '' : ' is-locked'}" data-tpl-id="${t.id}" ${effectiveAvail.ok ? '' : 'disabled'} title="${effectiveAvail.ok ? '' : escapeHtml(effectiveAvail.reason)}">
      ${icon}
      <span class="rh-tpl-item-name">${escapeHtml(t.displayName || t.name)}</span>
      <span class="rh-tpl-item-preview">${escapeHtml((t.body || '').slice(0, 60))}${(t.body || '').length > 60 ? '…' : ''}</span>
      ${lockIcon}${effectiveAvail.ok ? '' : `<span class="rh-tpl-reason">${escapeHtml(effectiveAvail.reason)}</span>`}
    </button>`;
  }).join('');

  // Click — comportamiento depende del tipo de plantilla y del modo
  list.querySelectorAll('.rh-tpl-item:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = _tplItems.find(t => t.id === Number(btn.dataset.tplId));
      if (!tpl || !_tplPickerCtx) return;

      // En modo bot-message: siempre copiar body al textarea (no abrir modal)
      if (_tplPickerCtx.mode === 'bot-message') {
        const ta = _tplPickerCtx.textarea;
        if (ta) {
          ta.value = tpl.body || '';
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.focus();
        }
        document.getElementById('rhTplPicker').hidden = true;
        _tplPickerCtx = null;
        return;
      }

      if (tpl.type === 'wa_api') {
        // wa_api → abrir modal "Enviar plantilla" (auto-llena del contacto, pide manuales)
        document.getElementById('rhTplPicker').hidden = true;
        openSendTemplateModal(tpl, ACTIVE_CONVO_ID);
        return;
      }

      // free_form → copiar texto al textarea (comportamiento clásico)
      const ta = _tplPickerCtx.textarea;
      if (ta) {
        ta.value = tpl.body || '';
        ta.dispatchEvent(new Event('input'));
        ta.focus();
      }
      document.getElementById('rhTplPicker').hidden = true;
      _tplPickerCtx = null;
    });
  });
}

function setupTplPicker() {
  // Close button
  document.getElementById('rhTplPickerClose')?.addEventListener('click', () => {
    document.getElementById('rhTplPicker').hidden = true;
    _tplPickerCtx = null;
  });

  // Search
  document.getElementById('rhTplSearch')?.addEventListener('input', e => {
    _renderTplPickerList(e.target.value);
  });

  // Close on outside click
  document.addEventListener('click', e => {
    const picker = document.getElementById('rhTplPicker');
    if (!picker || picker.hidden) return;
    if (!picker.contains(e.target) && !e.target.closest('.rh-tpl-trigger')) {
      picker.hidden = true;
      _tplPickerCtx = null;
    }
  }, true);

  // Main chat trigger
  document.getElementById('rhTplTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    const convo = CONVERSATIONS.find(c => c.id === ACTIVE_CONVO_ID);
    const ta = document.querySelector('.rh-reply-form textarea');
    if (!ta) return;
    openTplPicker(e.currentTarget, ta, convo?.provider, convo?.lastIncomingAt);
  });

  // Exp-detail trigger
  document.getElementById('expDetailTplTrigger')?.addEventListener('click', e => {
    e.stopPropagation();
    const convo = EXP_DETAIL_CONVOS.find(c => c.id === EXP_DETAIL_CONVO_ID);
    const ta = document.getElementById('expDetailReplyText');
    if (!ta) return;
    openTplPicker(e.currentTarget, ta, convo?.provider, convo?.lastIncomingAt);
  });
}

// TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

let _tplTab = 'wa_api';
let _tplItems = [];
let _tplEditId = null;
let _tplFilter = '';

async function loadTemplates() {
  try {
    await loadTemplateTags();
    _tplItems = await api('GET', '/api/templates');
    renderTemplates();
  } catch (e) { console.error('loadTemplates:', e); }
}

// State para etiquetas y ordenamiento (mismo patrón que bots)
let _tplTags = [];
let _tplTagFilter = null;       // null = todas, number = id de tag
let _tplSort = 'date_desc';     // date_desc | date_asc | name_asc | name_desc
let _tplGroupByTag = false;     // si true, agrupa por etiqueta (sort se aplica dentro de cada grupo)

async function loadTemplateTags() {
  try {
    const data = await api('GET', '/api/template-tags');
    _tplTags = data.items || [];
  } catch (e) { _tplTags = []; }
}

function renderTplTagFilters() {
  const root = document.getElementById('tplTagFilters');
  if (!root) return;
  const allActive = _tplTagFilter === null ? 'is-active' : '';
  const tagPills = _tplTags.map(t => `
    <button type="button" class="bot-tag-filter ${_tplTagFilter === t.id ? 'is-active' : ''}" data-tpl-tag-filter="${t.id}">
      <span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>
      ${escHtml(t.name)}
    </button>
  `).join('');
  root.innerHTML = `
    <button type="button" class="bot-tag-filter ${allActive}" data-tpl-tag-filter="">Todas</button>
    ${tagPills}
    <select id="tplSortSelect" class="bot-sort-select" title="Ordenar plantillas">
      <option value="date_desc"${_tplSort === 'date_desc' ? ' selected' : ''}>Más nueva</option>
      <option value="date_asc"${_tplSort === 'date_asc' ? ' selected' : ''}>Más vieja</option>
      <option value="name_asc"${_tplSort === 'name_asc' ? ' selected' : ''}>A → Z</option>
      <option value="name_desc"${_tplSort === 'name_desc' ? ' selected' : ''}>Z → A</option>
    </select>
    <label class="tpl-group-toggle" title="Si está activo, agrupa por etiqueta. El orden se aplica dentro de cada grupo.">
      <input type="checkbox" id="tplGroupByTagToggle" ${_tplGroupByTag ? 'checked' : ''} />
      <span class="tpl-group-toggle-track"><span class="tpl-group-toggle-thumb"></span></span>
      <span class="tpl-group-toggle-label">Agrupar por etiqueta</span>
    </label>
    <button type="button" class="bot-tag-manage-btn" id="tplTagManageBtn" title="Gestionar etiquetas">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14"><path d="M3 3h7l7 7-7 7-7-7V3z"/><circle cx="7" cy="7" r="1.2" fill="currentColor" stroke="none"/></svg>
      Etiquetas
    </button>`;
}

function tplRowTagsHtml(tpl) {
  if (!Array.isArray(tpl.tags) || !tpl.tags.length) return '';
  return `<span class="bot-row-tags">${tpl.tags.map(t => `<span class="bot-tag-pill" style="--tag-color:${escHtml(t.color)};${tplTagPillStyle(t.color)}"><span class="bot-tag-dot" style="background:${escHtml(t.color)}"></span>${escHtml(t.name)}</span>`).join('')}</span>`;
}

function _applyTplSort(arr) {
  const a = [...arr];
  switch (_tplSort) {
    case 'date_asc':  a.sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0)); break;
    case 'name_asc':  a.sort((x, y) => (x.displayName || x.name || '').localeCompare(y.displayName || y.name || '')); break;
    case 'name_desc': a.sort((x, y) => (y.displayName || y.name || '').localeCompare(x.displayName || x.name || '')); break;
    default: a.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
  }
  return a;
}

// Agrupa plantillas por su PRIMERA etiqueta (alfabéticamente). Las que no
// tienen etiqueta caen al grupo "Sin etiqueta" (al final). Una plantilla
// con varias tags aparece UNA sola vez en su tag primaria — sin duplicar.
function _groupTplByTag(arr) {
  const groups = new Map(); // tagId | '__notag' → { tag, items[] }
  for (const t of arr) {
    const sortedTags = (t.tags || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const primary = sortedTags[0] || null;
    const key = primary ? primary.id : '__notag';
    if (!groups.has(key)) groups.set(key, { tag: primary, items: [] });
    groups.get(key).items.push(t);
  }
  // Ordena los grupos: tags por nombre, "Sin etiqueta" al final
  const sortedGroups = [...groups.values()].sort((a, b) => {
    if (!a.tag && !b.tag) return 0;
    if (!a.tag) return 1;
    if (!b.tag) return -1;
    return a.tag.name.localeCompare(b.tag.name);
  });
  // Aplica el sort dentro de cada grupo
  sortedGroups.forEach(g => { g.items = _applyTplSort(g.items); });
  return sortedGroups;
}

function renderTemplates() {
  const list = document.getElementById('tplList');
  const empty = document.getElementById('tplEmpty');
  if (!list) return;

  // Re-render filtros (idempotente, refleja cambios de _tplTags/_tplTagFilter)
  renderTplTagFilters();

  const q = (_tplFilter || '').trim().toLowerCase();
  const matchesQuery = (t) => {
    if (!q) return true;
    return (
      (t.displayName || '').toLowerCase().includes(q) ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.body || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  };
  const matchesTag = (t) => {
    if (_tplTagFilter === null) return true;
    return Array.isArray(t.tags) && t.tags.some(x => x.id === _tplTagFilter);
  };
  let filtered = _tplItems.filter(t => t.type === _tplTab && matchesQuery(t) && matchesTag(t));
  filtered = _applyTplSort(filtered);

  // Update badges
  const waCount   = _tplItems.filter(t => t.type === 'wa_api').length;
  const freeCount = _tplItems.filter(t => t.type === 'free_form').length;
  const badgeWa   = document.getElementById('tplBadgeWa');
  const badgeFree = document.getElementById('tplBadgeFree');
  if (badgeWa)   badgeWa.textContent   = waCount;
  if (badgeFree) badgeFree.textContent = freeCount;

  // Remove old cards y headers
  list.querySelectorAll('.tpl-card, .tpl-group-header').forEach(c => c.remove());

  if (empty) empty.hidden = filtered.length > 0;

  function renderCard(t) {
    const card = document.createElement('div');
    card.className = 'tpl-card';
    card.dataset.id = t.id;
    const isWa = t.type === 'wa_api';
    const statusLabel = { draft: 'Borrador', pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' };
    const rejectionInfo = (isWa && t.waStatus === 'rejected' && t.waRejectedReason)
      ? `<div class="tpl-rejected-reason">Motivo: ${escHtml(_friendlyRejectedReason(t.waRejectedReason))}</div>` : '';
    const createdLabel = t.createdAt
      ? `<span class="tpl-card-date" title="${new Date(t.createdAt * 1000).toLocaleString('es-MX')}">📅 ${escHtml(relTime(t.createdAt))}</span>`
      : '';
    const usedByBotsHtml = (Array.isArray(t.usedByBots) && t.usedByBots.length)
      ? `<div class="tpl-card-bots"><span class="tpl-card-bots-label">🤖 Usado en:</span>${
          t.usedByBots.map(b => `<button type="button" class="tpl-card-bot-pill" data-go-to-bot="${b.id}" title="Abrir bot">${escHtml(b.name)}</button>`).join('')
        }</div>`
      : '';
    card.innerHTML = `
      <div class="tpl-card-icon ${isWa ? 'wa' : 'free'}">${isWa ? '📱' : '💬'}</div>
      <div class="tpl-card-body">
        <div class="tpl-card-name">${escHtml(t.displayName || t.name)} ${tplRowTagsHtml(t)}</div>
        <div class="tpl-card-meta">${isWa ? escHtml(t.category) + ' · ' + escHtml(t.language) + ' · ' : ''}
          <span class="tpl-status ${t.waStatus}">${statusLabel[t.waStatus] || t.waStatus}</span>
          ${createdLabel ? ' · ' + createdLabel : ''}
        </div>
        ${rejectionInfo}
        <div class="tpl-card-body-text">${escHtml(t.body)}</div>
        ${usedByBotsHtml}
      </div>
      <div class="tpl-card-actions">
        ${isWa && (t.waStatus === 'draft' || t.waStatus === 'rejected') ? `<button class="btn btn--sm btn--primary tpl-submit-btn" data-id="${t.id}">${t.waStatus === 'rejected' ? 'Reenviar' : 'Enviar a Meta'}</button>` : ''}
        ${isWa && t.waStatus === 'pending' ? `<button class="btn btn--sm btn--secondary tpl-sync-btn" data-id="${t.id}">↺ Sync</button>` : ''}
        <button class="btn btn--sm btn--secondary tpl-edit-btn" data-id="${t.id}">Editar</button>
        <button class="btn btn--sm btn--danger tpl-del-btn" data-id="${t.id}">✕</button>
      </div>`;
    list.appendChild(card);
  }

  if (_tplGroupByTag) {
    const groups = _groupTplByTag(filtered);
    for (const g of groups) {
      const header = document.createElement('div');
      header.className = 'tpl-group-header';
      const tagPillHtml = g.tag
        ? `<span class="bot-tag-pill" style="${tplTagPillStyle(g.tag.color)}"><span class="bot-tag-dot" style="background:${escHtml(g.tag.color)}"></span>${escHtml(g.tag.name)}</span>`
        : '<span class="tpl-group-no-tag">— Sin etiqueta —</span>';
      header.innerHTML = `${tagPillHtml} <span class="tpl-group-count">${g.items.length}</span>`;
      list.appendChild(header);
      for (const t of g.items) renderCard(t);
    }
  } else {
    for (const t of filtered) renderCard(t);
  }
}

// State del modal de plantillas
let _tplDraftButtons = [];        // [{type, text, url?, phone_number?}]
let _tplDraftMediaFile = null;    // File pendiente de upload
let _tplDraftPlaceholders = [];   // [{label, example, contactField}] — uno por cada {{N}} del body
let _tplDraftTagIds = [];         // ids de tags asignadas en el modal

function openTplModal(tmpl = null) {
  _tplEditId = tmpl?.id || null;
  _tplDraftMediaFile = null;
  const modal = document.getElementById('tplModal');
  if (!modal) return;
  const card = modal.querySelector('.tpl-modal-card');

  document.getElementById('tplModalTitle').textContent = tmpl ? 'Editar plantilla' : 'Nueva plantilla';

  if (tmpl) {
    document.getElementById('tplName').value         = tmpl.name || '';
    document.getElementById('tplDisplayName').value  = tmpl.displayName || '';
    document.getElementById('tplCategory').value     = tmpl.category || 'UTILITY';
    document.getElementById('tplLanguage').value     = tmpl.language || 'es_MX';
    document.getElementById('tplHeader').value       = tmpl.header || '';
    document.getElementById('tplBody').value         = tmpl.body || '';
    document.getElementById('tplFooter').value       = tmpl.footer || '';
    const radio = document.querySelector(`input[name="tplType"][value="${tmpl.type}"]`);
    if (radio) radio.checked = true;

    // Header type
    const ht = (tmpl.headerType || 'TEXT').toUpperCase();
    const htRadio = document.querySelector(`input[name="tplHeaderType"][value="${ht}"]`);
    if (htRadio) htRadio.checked = true;
    setHeaderTypeUI(ht, !!tmpl.headerMediaHandle);

    // Buttons
    _tplDraftButtons = Array.isArray(tmpl.buttons) ? JSON.parse(JSON.stringify(tmpl.buttons)) : [];
    // Placeholders del body
    _tplDraftPlaceholders = Array.isArray(tmpl.bodyPlaceholders) ? JSON.parse(JSON.stringify(tmpl.bodyPlaceholders)) : [];
    // Tags asignadas
    _tplDraftTagIds = Array.isArray(tmpl.tags) ? tmpl.tags.map(t => t.id) : [];
  } else {
    document.getElementById('tplName').value = '';
    document.getElementById('tplDisplayName').value = '';
    document.getElementById('tplHeader').value = '';
    document.getElementById('tplBody').value = '';
    document.getElementById('tplFooter').value = '';
    document.getElementById('tplCategory').value = 'UTILITY';
    document.getElementById('tplLanguage').value = 'es_MX';
    document.getElementById('tplTypeFreeForm').checked = true;
    const htText = document.querySelector('input[name="tplHeaderType"][value="TEXT"]');
    if (htText) htText.checked = true;
    setHeaderTypeUI('TEXT', false);
    _tplDraftButtons = [];
    _tplDraftPlaceholders = [];
    _tplDraftTagIds = [];
  }
  renderTplButtonsList();
  renderTplPlaceholdersBox();
  renderTplTagsPickers();
  // Reset file input
  const fileInput = document.getElementById('tplHeaderFile');
  if (fileInput) fileInput.value = '';

  const errEl = document.getElementById('tplError');
  if (errEl) { errEl.hidden = true; errEl.textContent = ''; }
  updateTplModalType(card);

  // Bloquear edición si la plantilla wa_api ya está en revisión/aprobada/rechazada.
  // Meta no permite cambiar contenido aprobado, y aunque permita editar drafts,
  // si se modifica el body habría que re-enviar a Meta y obtener nuevo waId.
  applyTplLockState(tmpl);

  modal.hidden = false;
}

// Duplica una plantilla: copia todos los campos como nuevo draft pero con
// nombre obligatoriamente distinto (sufijo random tipo Kommo). Se cierra
// el modal de la actual y se abre uno limpio en modo "nueva plantilla".
function duplicateCurrentTemplate(srcTmpl) {
  if (!srcTmpl) return;
  closeTplModal();
  // Sufijo de 4 chars para forzar nombre nuevo (Meta no acepta nombres reusados)
  const suffix = Math.random().toString(36).slice(2, 6);
  const newName = (srcTmpl.name || 'plantilla').replace(/_v\d+_[a-z0-9]+$|_[a-z0-9]{4,8}$/i, '') + `_v2_${suffix}`;
  // Construir un draft a partir del original
  const draft = {
    ...srcTmpl,
    id: undefined,
    waId: null,
    waStatus: 'draft',
    waRejectedReason: null,
    name: newName,
    displayName: srcTmpl.displayName ? `${srcTmpl.displayName} (copia)` : null,
  };
  setTimeout(() => openTplModal(draft), 50);
}

// Sanea el nombre interno en vivo: minúsculas, _ por espacios, quita acentos
// y caracteres no permitidos por Meta. Muestra hint si tuvo que limpiar.
function sanitizeTplName(raw) {
  return String(raw || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function setupTplNameValidation() {
  const input = document.getElementById('tplName');
  const hint  = document.getElementById('tplNameHint');
  if (!input || input._tplValidationBound) return;
  input._tplValidationBound = true;
  input.addEventListener('input', () => {
    const before = input.value;
    const after = sanitizeTplName(before);
    if (before !== after) {
      input.value = after;
      const removed = [];
      if (before !== before.toLowerCase()) removed.push('mayúsculas → minúsculas');
      if (/\s/.test(before)) removed.push('espacios → _');
      if (/[^a-z0-9_\s]/i.test(before)) removed.push('quitamos signos/acentos');
      if (hint) {
        hint.querySelector('span').textContent = 'Auto-corregido: ' + removed.join(' · ') + '. Meta solo acepta minúsculas, números y _.';
        hint.hidden = false;
        clearTimeout(input._hintTimer);
        input._hintTimer = setTimeout(() => { hint.hidden = true; }, 4000);
      }
    }
  });
}

function applyTplLockState(tmpl) {
  const card = document.querySelector('.tpl-modal-card');
  if (!card) return;
  const isWa = !!tmpl && tmpl.type === 'wa_api';
  const status = (tmpl?.waStatus || 'draft');
  const locked = isWa && status !== 'draft';

  // Banner — crear si no existe
  let banner = document.getElementById('tplLockBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'tplLockBanner';
    banner.className = 'tpl-lock-banner';
    const body = card.querySelector('.modal-body');
    if (body) body.insertBefore(banner, body.firstChild);
  }
  if (locked) {
    const labels = {
      pending: { icon: '🕐', text: 'EN REVISIÓN por Meta — no puedes editar el contenido (lo que Meta valida).' },
      approved:{ icon: '✅', text: 'APROBADA por Meta — editar el contenido la invalidaría con Meta.' },
      rejected:{ icon: '❌', text: 'RECHAZADA por Meta — para reintentar duplica con otro nombre (Meta bloquea el nombre 30 días).' },
    };
    const meta = labels[status] || { icon: '🔒', text: 'Solo lectura del contenido.' };
    banner.innerHTML = `
      <div>${meta.icon} <strong>${meta.text}</strong></div>
      <div style="margin-top:6px;font-size:12px;font-weight:400">📝 Sí puedes editar: <strong>"Nombre para mostrar"</strong> y <strong>etiquetas</strong> (organizacionales tuyas, Meta no las ve).</div>
      <button type="button" class="btn btn--primary btn--sm" id="tplDuplicateBtn" style="margin-top:8px">📋 Duplicar como nueva (para cambiar contenido)</button>
    `;
    banner.hidden = false;
    document.getElementById('tplDuplicateBtn')?.addEventListener('click', () => duplicateCurrentTemplate(tmpl));
  } else {
    banner.hidden = true;
  }

  // Locked fields = los que Meta valida. NO se bloquean los campos puramente
  // organizacionales (display_name + tags) — Meta nunca los ve.
  const lockedSelectors = [
    '#tplName', '#tplCategory', '#tplLanguage',
    '#tplHeader', '#tplBody', '#tplFooter',
    '#tplHeaderFile',
    'input[name="tplType"]', 'input[name="tplHeaderType"]',
    '.tpl-var-btn', '.tpl-ph-label', '.tpl-ph-example', '.tpl-ph-field',
    '.tpl-btn-row select, .tpl-btn-row input, .tpl-btn-remove', '#tplAddButtonBtn',
  ];
  card.querySelectorAll(lockedSelectors.join(', ')).forEach(el => {
    el.disabled = locked;
    if (locked) el.classList.add('is-locked');
    else el.classList.remove('is-locked');
  });

  const saveBtn = document.getElementById('tplModalSave');
  if (saveBtn) {
    saveBtn.disabled = false;  // siempre habilitado — al menos display_name + tags se pueden editar
    saveBtn.textContent = locked ? 'Guardar nombre y etiquetas' : 'Guardar plantilla';
  }
}

function setHeaderTypeUI(type, hasExistingMedia) {
  const isMedia = type && type !== 'TEXT';
  const txtInput = document.getElementById('tplHeader');
  const mediaBox = document.getElementById('tplHeaderMediaBox');
  const mediaStatus = document.getElementById('tplHeaderMediaStatus');
  if (txtInput) txtInput.hidden = !!isMedia;
  if (mediaBox) mediaBox.hidden = !isMedia;
  if (isMedia && mediaStatus) {
    mediaStatus.textContent = hasExistingMedia
      ? 'Ya hay un archivo subido. Selecciona uno nuevo solo si quieres reemplazarlo.'
      : 'Selecciona un archivo. Se sube a Meta como ejemplo de header.';
  }
}

function renderTplButtonsList() {
  const list = document.getElementById('tplButtonsList');
  if (!list) return;
  if (!_tplDraftButtons.length) {
    list.innerHTML = '<p class="tpl-hint-inline">Sin botones. Click "+ Agregar botón" para añadir.</p>';
    return;
  }
  list.innerHTML = _tplDraftButtons.map((b, i) => {
    const t = b.type || 'QUICK_REPLY';
    const textVal = (b.text || '').replace(/"/g, '&quot;');
    const extraVal = ((b.url || b.phone_number) || '').replace(/"/g, '&quot;');
    const extraField = t === 'URL'
      ? `<input class="int-input tpl-btn-extra" data-i="${i}" data-field="url" value="${extraVal}" placeholder="https://..." />`
      : t === 'PHONE_NUMBER'
        ? `<input class="int-input tpl-btn-extra" data-i="${i}" data-field="phone_number" value="${extraVal}" placeholder="+5213311234567" />`
        : '';
    return `
      <div class="tpl-btn-row" data-i="${i}">
        <select class="int-input tpl-btn-type" data-i="${i}">
          <option value="QUICK_REPLY"${t==='QUICK_REPLY'?' selected':''}>Respuesta rápida</option>
          <option value="URL"${t==='URL'?' selected':''}>Abrir URL</option>
          <option value="PHONE_NUMBER"${t==='PHONE_NUMBER'?' selected':''}>Llamar teléfono</option>
        </select>
        <input class="int-input tpl-btn-text" data-i="${i}" value="${textVal}" placeholder="Texto del botón (máx 25)" maxlength="25" />
        ${extraField}
        <button type="button" class="btn btn--ghost btn--sm tpl-btn-remove" data-i="${i}" title="Quitar botón">×</button>
      </div>
    `;
  }).join('');
}

function addTplButton() {
  if (_tplDraftButtons.length >= 3) {
    toast('Máximo 3 botones por plantilla', 'warning');
    return;
  }
  _tplDraftButtons.push({ type: 'QUICK_REPLY', text: '' });
  renderTplButtonsList();
}

// Detecta {{1}}, {{2}}, ... en el body y sincroniza el array de placeholders.
// Mantiene los labels/ejemplos que el usuario ya puso para placeholders existentes.
function syncTplPlaceholdersFromBody() {
  const body = document.getElementById('tplBody')?.value || '';
  const nums = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  if (!nums.length) {
    _tplDraftPlaceholders = [];
    renderTplPlaceholdersBox();
    return;
  }
  const max = Math.max(...nums);
  // Asegura que haya un slot por cada índice 1..max
  const next = [];
  for (let i = 0; i < max; i++) {
    next[i] = _tplDraftPlaceholders[i] || { label: '', example: '' };
  }
  _tplDraftPlaceholders = next;
  renderTplPlaceholdersBox();
}

// Defaults para cada campo del contacto: el label y el ejemplo se auto-llenan
// para que Meta tenga datos realistas durante la review.
const CONTACT_FIELD_DEFAULTS = {
  first_name: { label: 'Nombre',          example: 'Luis' },
  last_name:  { label: 'Apellido',        example: 'Pérez' },
  full_name:  { label: 'Nombre completo', example: 'Luis Pérez' },
  phone:      { label: 'Teléfono',        example: '+5213311234567' },
  email:      { label: 'Email',           example: 'cliente@gmail.com' },
};

function renderTplPlaceholdersBox() {
  const box = document.getElementById('tplPlaceholdersBox');
  const list = document.getElementById('tplPlaceholdersList');
  if (!box || !list) return;
  // Solo se muestra si hay placeholders detectados Y la plantilla es wa_api
  const isWa = document.getElementById('tplTypeWaApi')?.checked;
  if (!isWa || !_tplDraftPlaceholders.length) {
    box.hidden = true;
    list.innerHTML = '';
    return;
  }
  box.hidden = false;
  list.innerHTML = _tplDraftPlaceholders.map((ph, i) => {
    const cf  = ph.contactField || '';
    const opt = (val, lbl) => `<option value="${val}"${cf===val?' selected':''}>${lbl}</option>`;
    const dropdownHtml = `
      <select class="int-input tpl-ph-field" data-i="${i}" data-field="contactField" title="¿De qué campo del contacto se llena al enviar?">
        ${opt('', '— Manual —')}
        ${opt('first_name', 'Nombre')}
        ${opt('last_name',  'Apellido')}
        ${opt('full_name',  'Nombre completo')}
        ${opt('phone',      'Teléfono')}
        ${opt('email',      'Email')}
      </select>`;

    if (cf) {
      // Mapeado → label + ejemplo se llenan solos, no se piden al usuario.
      const def = CONTACT_FIELD_DEFAULTS[cf] || { label: cf, example: '—' };
      return `
        <div class="tpl-placeholder-row tpl-placeholder-row--mapped" data-i="${i}">
          <span class="tpl-placeholder-num">{{${i + 1}}}</span>
          ${dropdownHtml}
          <span class="tpl-ph-auto-preview">→ ejemplo para Meta: <strong>${escapeHtml(def.example)}</strong></span>
        </div>`;
    }

    // Manual → pide label + ejemplo
    const label   = (ph.label   || '').replace(/"/g, '&quot;');
    const example = (ph.example || '').replace(/"/g, '&quot;');
    return `
      <div class="tpl-placeholder-row tpl-placeholder-row--manual" data-i="${i}">
        <span class="tpl-placeholder-num">{{${i + 1}}}</span>
        ${dropdownHtml}
        <input class="int-input tpl-ph-label"   data-i="${i}" data-field="label"   value="${label}"   placeholder="Para qué es (ej: Cupón)" maxlength="40" />
        <input class="int-input tpl-ph-example" data-i="${i}" data-field="example" value="${example}" placeholder="Ejemplo para Meta (ej: PROMO30)" maxlength="60" />
      </div>`;
  }).join('');
}

function _collectTplPlaceholders() {
  const rows = document.querySelectorAll('#tplPlaceholdersList .tpl-placeholder-row');
  const out = [];
  rows.forEach(row => {
    const i = Number(row.dataset.i);
    out[i] = {
      label:   row.querySelector('.tpl-ph-label')?.value.trim()   || '',
      example: row.querySelector('.tpl-ph-example')?.value.trim() || '',
    };
  });
  return out;
}

function _collectTplButtons() {
  // Recolecta el state desde los inputs por si hubo cambios sin re-render
  const rows = document.querySelectorAll('#tplButtonsList .tpl-btn-row');
  const out = [];
  rows.forEach(row => {
    const i = Number(row.dataset.i);
    const type = row.querySelector('.tpl-btn-type')?.value || 'QUICK_REPLY';
    const text = row.querySelector('.tpl-btn-text')?.value.trim() || '';
    const extraEl = row.querySelector('.tpl-btn-extra');
    const b = { type, text };
    if (type === 'URL' && extraEl) b.url = extraEl.value.trim();
    if (type === 'PHONE_NUMBER' && extraEl) b.phone_number = extraEl.value.trim();
    if (text) out.push(b);
    void i;
  });
  return out;
}

function updateTplModalType(card) {
  const isWa = document.getElementById('tplTypeWaApi')?.checked;
  if (card) card.classList.toggle('is-free', !isWa);
}

function closeTplModal() {
  const modal = document.getElementById('tplModal');
  if (modal) modal.hidden = true;
  _tplEditId = null;
}

// Guardado parcial cuando la plantilla está locked: solo display_name y tags.
// Meta nunca ve estos campos, así que no afectan el estado de aprobación.
async function saveTplLockedFields(existing) {
  const errEl = document.getElementById('tplError');
  const displayName = document.getElementById('tplDisplayName')?.value.trim() || '';
  if (errEl) errEl.hidden = true;
  try {
    // Solo mandamos displayName — el endpoint PUT acepta updates parciales.
    const updated = await api('PUT', `/api/templates/${existing.id}`, { displayName });
    // Actualizar tags por separado
    const withTags = await api('PUT', `/api/templates/${existing.id}/tags`, { tagIds: _tplDraftTagIds });
    updated.tags = withTags.tags || [];
    _tplItems = _tplItems.map(t => t.id === updated.id ? updated : t);
    renderTemplates();
    closeTplModal();
    toast('Cambios guardados (nombre y etiquetas)', 'success');
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
  }
}

async function saveTpl() {
  const errEl = document.getElementById('tplError');
  // Si la plantilla está locked (pending/approved/rejected), solo permitimos
  // editar campos organizacionales (display_name + tags). Atajo aquí.
  if (_tplEditId) {
    const existing = _tplItems.find(t => t.id === _tplEditId);
    if (existing && existing.type === 'wa_api' && existing.waStatus !== 'draft') {
      return saveTplLockedFields(existing);
    }
  }

  const type = document.querySelector('input[name="tplType"]:checked')?.value || 'free_form';
  let name = document.getElementById('tplName')?.value.trim() || '';
  const displayName = document.getElementById('tplDisplayName')?.value.trim() || '';
  const category = document.getElementById('tplCategory')?.value || 'UTILITY';
  const language = document.getElementById('tplLanguage')?.value || 'es_MX';
  const headerType = document.querySelector('input[name="tplHeaderType"]:checked')?.value || 'TEXT';
  const header = document.getElementById('tplHeader')?.value.trim() || '';
  const body = document.getElementById('tplBody')?.value.trim() || '';
  const footer = document.getElementById('tplFooter')?.value.trim() || '';
  const buttons = _collectTplButtons();

  if (!name) {
    if (errEl) { errEl.textContent = 'El nombre interno es obligatorio.'; errEl.hidden = false; }
    return;
  }
  if (!body) {
    if (errEl) { errEl.textContent = 'El cuerpo es obligatorio.'; errEl.hidden = false; }
    return;
  }
  // WA API: nombre solo minúsculas, números y guión bajo (regla de Meta)
  if (type === 'wa_api') {
    name = sanitizeTplName(name);
    document.getElementById('tplName').value = name;
    if (!name) {
      if (errEl) { errEl.textContent = 'El nombre interno quedó vacío después de limpiar caracteres. Usa solo minúsculas, números y _'; errEl.hidden = false; }
      return;
    }
    if (name.length > 512) {
      if (errEl) { errEl.textContent = 'El nombre interno es muy largo (máx 512 chars).'; errEl.hidden = false; }
      return;
    }
  }

  // Validación de botones (lado cliente)
  for (const b of buttons) {
    if (b.type === 'URL' && !/^https?:\/\//i.test(b.url || '')) {
      if (errEl) { errEl.textContent = `Botón "${b.text}": URL debe empezar con http:// o https://`; errEl.hidden = false; }
      return;
    }
    if (b.type === 'PHONE_NUMBER' && !/^\+?\d{10,15}$/.test((b.phone_number || '').replace(/\s/g, ''))) {
      if (errEl) { errEl.textContent = `Botón "${b.text}": teléfono inválido (10-15 dígitos, formato internacional)`; errEl.hidden = false; }
      return;
    }
  }

  const placeholders = _collectTplPlaceholders();
  const payload = {
    type, name, displayName, category, language,
    header: headerType === 'TEXT' ? (header || null) : null,
    body,
    footer: footer || null,
    headerType,
    buttons: buttons.length ? buttons : null,
    bodyPlaceholders: placeholders.length ? placeholders : null,
  };
  if (errEl) errEl.hidden = true;

  try {
    let saved;
    if (_tplEditId) {
      saved = await api('PUT', `/api/templates/${_tplEditId}`, payload);
    } else {
      saved = await api('POST', '/api/templates', payload);
    }

    // Si hay archivo de header pendiente y el tipo no es TEXT, subirlo ahora
    if (_tplDraftMediaFile && headerType !== 'TEXT') {
      toast('Subiendo archivo a Meta…', 'info');
      const data = await _readFileAsBase64(_tplDraftMediaFile);
      const upRes = await api('POST', `/api/templates/${saved.id}/header-media`, {
        data,
        mimetype: _tplDraftMediaFile.type,
      });
      saved.headerMediaHandle = upRes.handle;
      saved.headerType = upRes.headerType;
      _tplDraftMediaFile = null;
    }

    // Asignar tags (siempre, aunque sea array vacío para limpiar)
    try {
      const withTags = await api('PUT', `/api/templates/${saved.id}/tags`, { tagIds: _tplDraftTagIds });
      saved.tags = withTags.tags || [];
    } catch (_) { /* no bloquear el guardado por error de tags */ }

    if (_tplEditId) {
      _tplItems = _tplItems.map(t => t.id === saved.id ? saved : t);
    } else {
      _tplItems.push(saved);
    }

    renderTemplates();
    closeTplModal();
    toast('Plantilla guardada', 'success');
  } catch (e) {
    if (errEl) { errEl.textContent = e.message; errEl.hidden = false; }
  }
}

function _readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

// ─── Modal "Enviar plantilla" (wa_api con variables) ───────────────────
let _sendTplCtx = null; // { tpl, convoId }

// Resuelve el valor de un placeholder mapeado, leyendo del contacto real
// (con fallback a los datos parciales del convo si no hay contacto).
function _resolvePlaceholderForPreview(ph, convo, contact) {
  if (!ph?.contactField) return null;
  const cf = ph.contactField;
  // Preferir contact (datos completos), caer al convo si falta
  if (cf === 'first_name') return contact?.firstName || convo?.name?.split(' ')[0] || '';
  if (cf === 'last_name')  return contact?.lastName  || (convo?.name?.split(' ').slice(1).join(' ') || '');
  if (cf === 'full_name') {
    if (contact?.firstName || contact?.lastName) {
      return [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    }
    return convo?.name || '';
  }
  if (cf === 'phone') return contact?.phone || convo?.phone || '';
  if (cf === 'email') return contact?.email || '';
  return null;
}

async function openSendTemplateModal(tpl, convoId) {
  _sendTplCtx = { tpl, convoId };
  const modal = document.getElementById('sendTplModal');
  const meta  = document.getElementById('sendTplMeta');
  const vars  = document.getElementById('sendTplVars');
  const err   = document.getElementById('sendTplError');
  if (!modal || !meta || !vars) return;
  if (err) { err.hidden = true; err.textContent = ''; }

  const convo = CONVERSATIONS.find(c => c.id === convoId);

  // Cargar el contacto REAL (con first_name/last_name/email separados) para
  // poder llenar correctamente los placeholders mapeados.
  let contact = null;
  if (convo?.contactId) {
    try { contact = await api('GET', `/api/contacts/${convo.contactId}`); } catch (_) {}
  }
  _sendTplCtx.contact = contact;

  // Header con preview de body + nombre
  meta.innerHTML = `
    <div class="send-tpl-name"><strong>${escapeHtml(tpl.displayName || tpl.name)}</strong>
      <span class="tpl-hint-inline">→ ${escapeHtml(convo?.name || convo?.phone || 'contacto')}</span></div>
    <div class="send-tpl-body">${escapeHtml(tpl.body || '')}</div>
  `;

  const phs = Array.isArray(tpl.bodyPlaceholders) ? tpl.bodyPlaceholders : [];
  const varNums = [...(tpl.body || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
  const max = varNums.length ? Math.max(...varNums) : 0;

  if (!max) {
    vars.innerHTML = '<p class="tpl-hint-inline">Esta plantilla no tiene variables — se envía tal cual.</p>';
  } else {
    const rows = [];
    for (let i = 0; i < max; i++) {
      const ph = phs[i] || {};
      const auto = _resolvePlaceholderForPreview(ph, convo, contact);
      if (auto !== null && auto !== '') {
        // Mapeado y con valor — solo mostrar
        rows.push(`
          <div class="send-tpl-var-row">
            <span class="tpl-placeholder-num">{{${i + 1}}}</span>
            <span class="send-tpl-var-label">${escapeHtml(ph.label || '')}</span>
            <span class="send-tpl-var-auto">${escapeHtml(auto)} <em class="tpl-hint-inline">(auto del contacto)</em></span>
          </div>
        `);
      } else if (ph.contactField) {
        // Mapeado pero el contacto no tiene ese campo → input rojo de "falta"
        rows.push(`
          <div class="send-tpl-var-row">
            <span class="tpl-placeholder-num">{{${i + 1}}}</span>
            <span class="send-tpl-var-label">${escapeHtml(ph.label || '')}</span>
            <input class="int-input send-tpl-var-input send-tpl-var-input--missing" data-i="${i}" placeholder="⚠️ El contacto no tiene ${escapeHtml(ph.contactField)} — escríbelo aquí" />
          </div>
        `);
      } else {
        // Manual — pero si es {{1}} y tenemos nombre del contacto, lo pre-llenamos
        // como sugerencia (el usuario puede editarlo o solo darle Enviar).
        let suggested = '';
        if (i === 0) {
          // {{1}} suele ser el nombre — pre-llenamos con nombre del contacto si lo hay
          suggested = contact?.firstName || convo?.name?.split(' ')[0] || '';
        }
        const placeholder = ph.label || ph.example || `Valor para {{${i + 1}}}`;
        const valueAttr = suggested ? `value="${escapeHtml(suggested)}"` : '';
        const hint = suggested ? '<em class="tpl-hint-inline">(sugerencia del contacto — puedes cambiarlo)</em>' : '';
        rows.push(`
          <div class="send-tpl-var-row">
            <span class="tpl-placeholder-num">{{${i + 1}}}</span>
            <span class="send-tpl-var-label">${escapeHtml(ph.label || '')} ${hint}</span>
            <input class="int-input send-tpl-var-input" data-i="${i}" ${valueAttr} placeholder="${escapeHtml(placeholder)}" />
          </div>
        `);
      }
    }
    vars.innerHTML = rows.join('');
  }

  modal.hidden = false;
}

function closeSendTemplateModal() {
  const modal = document.getElementById('sendTplModal');
  if (modal) modal.hidden = true;
  _sendTplCtx = null;
}

async function executeSendTemplate() {
  const ctx = _sendTplCtx;
  const errEl = document.getElementById('sendTplError');
  if (!ctx) return;

  // Recolectar valores manuales (los que tienen input)
  const manualValues = [];
  document.querySelectorAll('#sendTplVars .send-tpl-var-input').forEach(inp => {
    const i = Number(inp.dataset.i);
    manualValues[i] = inp.value.trim();
  });

  // Validar: no debe haber inputs vacíos
  for (let i = 0; i < manualValues.length; i++) {
    if (manualValues[i] !== undefined && manualValues[i] === '') {
      if (errEl) { errEl.textContent = `Falta valor para {{${i + 1}}}`; errEl.hidden = false; }
      return;
    }
  }

  if (errEl) errEl.hidden = true;
  const btn = document.getElementById('sendTplGo');
  if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
  try {
    await api('POST', `/api/conversations/${ctx.convoId}/send-template`, {
      templateId: ctx.tpl.id,
      manualValues,
    });
    closeSendTemplateModal();
    toast('Plantilla enviada', 'success');
    // Recargar mensajes para que aparezca el outgoing
    if (typeof loadMessages === 'function') loadMessages(ctx.convoId);
    if (typeof loadConversations === 'function') loadConversations();
  } catch (e) {
    if (errEl) { errEl.textContent = e.message || 'Error al enviar'; errEl.hidden = false; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  }
}

async function submitTplToMeta(id) {
  try {
    toast('Enviando a Meta…', 'info');
    const result = await api('POST', `/api/templates/${id}/submit`);
    _tplItems = _tplItems.map(t => t.id === id ? { ...t, waStatus: 'pending', waId: result.waId } : t);
    renderTemplates();
    toast('Plantilla enviada a Meta para revisión. Status: ' + (result.status || 'PENDING'), 'success');
  } catch (e) {
    toast('Error al enviar: ' + e.message, 'error');
  }
}

async function syncTplFromMeta(id) {
  try {
    const result = await api('POST', `/api/templates/${id}/sync`);
    _tplItems = _tplItems.map(t => t.id === id ? { ...t, waStatus: result.status } : t);
    renderTemplates();
    const labels = { approved: 'Aprobada ✓', pending: 'Aún pendiente' };
    const msg = result.status === 'rejected'
      ? `Rechazada: ${result.rejectedReason || 'sin detalle'}`
      : (labels[result.status] || result.status);
    toast(msg, result.status === 'approved' ? 'success' : result.status === 'rejected' ? 'error' : 'info');
  } catch (e) {
    toast('Error al sincronizar: ' + e.message, 'error');
  }
}

function setupTemplates() {
  // Tab switching
  document.querySelectorAll('.tpl-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tpl-tab').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      _tplTab = btn.dataset.tab;
      renderTemplates();
    });
  });

  // Topbar search drives template filter when on plantillas view
  let _tplSearchDebounce;
  document.getElementById('topbarSearchInput')?.addEventListener('input', (e) => {
    if (document.body.dataset.viewActive !== 'plantillas') return;
    clearTimeout(_tplSearchDebounce);
    _tplSearchDebounce = setTimeout(() => {
      _tplFilter = e.target.value;
      renderTemplates();
    }, 200);
  });

  // New button
  document.getElementById('tplNewBtn')?.addEventListener('click', () => openTplModal());
  document.getElementById('rhNewTplBtn')?.addEventListener('click', () => openTplModal());

  // Modal close
  document.getElementById('tplModalClose')?.addEventListener('click', closeTplModal);
  document.getElementById('tplModalCancel')?.addEventListener('click', closeTplModal);
  document.getElementById('tplModalBackdrop')?.addEventListener('click', closeTplModal);

  // Save
  document.getElementById('tplModalSave')?.addEventListener('click', saveTpl);

  // Validación en vivo del nombre interno (minúsculas, _, sin acentos/espacios)
  setupTplNameValidation();

  // Modal "Enviar plantilla"
  document.getElementById('sendTplModalClose')?.addEventListener('click', closeSendTemplateModal);
  document.getElementById('sendTplCancel')?.addEventListener('click', closeSendTemplateModal);
  document.getElementById('sendTplModalBackdrop')?.addEventListener('click', closeSendTemplateModal);
  document.getElementById('sendTplGo')?.addEventListener('click', executeSendTemplate);

  // ─── Filtros de tags + sort + manage (en la vista Plantillas) ───
  document.addEventListener('click', (e) => {
    const filterBtn = e.target.closest('[data-tpl-tag-filter]');
    if (filterBtn) {
      const v = filterBtn.dataset.tplTagFilter;
      _tplTagFilter = v ? Number(v) : null;
      renderTemplates();
      return;
    }
    if (e.target.closest('#tplTagManageBtn')) openTplTagsManager();
    if (e.target.closest('[data-close-tpl-tags]')) closeTplTagsManager();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'tplSortSelect') {
      _tplSort = e.target.value;
      renderTemplates();
    }
    if (e.target.id === 'tplGroupByTagToggle') {
      _tplGroupByTag = e.target.checked;
      renderTemplates();
    }
  });

  // Toggle tag dentro del modal de plantilla
  document.getElementById('tplTagsPickers')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-toggle-tag]');
    if (!btn) return;
    const id = Number(btn.dataset.toggleTag);
    if (_tplDraftTagIds.includes(id)) {
      _tplDraftTagIds = _tplDraftTagIds.filter(x => x !== id);
    } else {
      _tplDraftTagIds.push(id);
    }
    renderTplTagsPickers();
  });

  // Crear nueva tag desde el manager
  document.getElementById('tplTagCreateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tplTagNewName').value.trim();
    if (!name) return;
    const colorBtn = document.querySelector('#tplTagNewColors .bot-tag-swatch.is-selected');
    const color = colorBtn?.dataset.color || TPL_TAG_PALETTE[0];
    try {
      await createTplTag(name, color);
      document.getElementById('tplTagNewName').value = '';
    } catch (err) { toast(err.message, 'error'); }
  });
  // Selector de color en el form de creación
  document.getElementById('tplTagNewColors')?.addEventListener('click', (e) => {
    const sw = e.target.closest('.bot-tag-swatch');
    if (!sw) return;
    document.querySelectorAll('#tplTagNewColors .bot-tag-swatch').forEach(b => b.classList.remove('is-selected'));
    sw.classList.add('is-selected');
  });
  // Acciones por fila en el manager
  document.getElementById('tplTagsManagerList')?.addEventListener('click', async (e) => {
    // Quick-pick de color (modo no-edición — se guarda directo)
    const colorBtn = e.target.closest('[data-tpl-tag-color-pick]');
    if (colorBtn) {
      await updateTplTag(Number(colorBtn.dataset.tplTagColorPick), { color: colorBtn.dataset.color });
      return;
    }

    // Entrar en modo edición inline (nombre + color)
    const editBtn = e.target.closest('[data-edit-tpl-tag]');
    if (editBtn) {
      _tplTagEditingId = Number(editBtn.dataset.editTplTag);
      // Inicializa _draftColor con el color actual
      const cur = _tplTags.find(t => t.id === _tplTagEditingId);
      if (cur) cur._draftColor = cur.color;
      renderTplTagsManagerList();
      // Focus en el input de nombre
      setTimeout(() => {
        document.querySelector('.tpl-tag-row--editing .tpl-tag-edit-name')?.focus();
      }, 50);
      return;
    }

    // En modo edición — selección de color (solo cambia draft)
    const editColorBtn = e.target.closest('[data-tpl-tag-edit-color]');
    if (editColorBtn) {
      const cur = _tplTags.find(t => t.id === _tplTagEditingId);
      if (cur) cur._draftColor = editColorBtn.dataset.tplTagEditColor;
      renderTplTagsManagerList();
      setTimeout(() => document.querySelector('.tpl-tag-row--editing .tpl-tag-edit-name')?.focus(), 50);
      return;
    }

    // Guardar edición (nombre + color)
    const saveBtn = e.target.closest('[data-save-tpl-tag]');
    if (saveBtn) {
      const id = Number(saveBtn.dataset.saveTplTag);
      const cur = _tplTags.find(t => t.id === id);
      const newName = document.querySelector('.tpl-tag-row--editing .tpl-tag-edit-name')?.value.trim();
      if (!newName) { toast('El nombre no puede quedar vacío', 'error'); return; }
      try {
        await updateTplTag(id, { name: newName, color: cur._draftColor || cur.color });
        _tplTagEditingId = null;
        renderTplTagsManagerList();
      } catch (err) { toast(err.message, 'error'); }
      return;
    }

    // Cancelar edición
    const cancelBtn = e.target.closest('[data-cancel-tpl-tag]');
    if (cancelBtn) {
      _tplTagEditingId = null;
      renderTplTagsManagerList();
      return;
    }

    // Eliminar
    const delBtn = e.target.closest('[data-delete-tpl-tag]');
    if (delBtn) await deleteTplTag(Number(delBtn.dataset.deleteTplTag));
  });

  // Type radio toggles WA fields
  document.querySelectorAll('input[name="tplType"]').forEach(r => {
    r.addEventListener('change', () => {
      const card = document.querySelector('.tpl-modal-card');
      updateTplModalType(card);
    });
  });

  // Header type radios — toggle texto/media
  document.querySelectorAll('input[name="tplHeaderType"]').forEach(r => {
    r.addEventListener('change', () => {
      setHeaderTypeUI(r.value, false);
    });
  });

  // Captura de archivo — valida tipo y tamaño según las reglas de Meta para
  // headers de plantilla, y avisa al usuario antes de gastar el upload.
  const TPL_MEDIA_RULES = {
    IMAGE:    { mimes: ['image/jpeg', 'image/png'],          maxBytes: 5  * 1024 * 1024, label: 'JPEG o PNG' },
    VIDEO:    { mimes: ['video/mp4', 'video/3gpp'],          maxBytes: 16 * 1024 * 1024, label: 'MP4 (con audio)' },
    DOCUMENT: { mimes: ['application/pdf'],                  maxBytes: 100 * 1024 * 1024, label: 'PDF' },
  };
  document.getElementById('tplHeaderFile')?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (!f) { _tplDraftMediaFile = null; return; }

    const ht = document.querySelector('input[name="tplHeaderType"]:checked')?.value || 'TEXT';
    const rules = TPL_MEDIA_RULES[ht];
    const status = document.getElementById('tplHeaderMediaStatus');

    if (!rules) {
      toast('Cambia primero el tipo de header (Imagen / Video / Documento)', 'error');
      e.target.value = '';
      return;
    }

    if (!rules.mimes.includes(f.type)) {
      const msg = `Meta NO acepta este archivo en headers de plantilla. Para tipo "${ht}" usa: ${rules.label}. Tu archivo es ${f.type || 'desconocido'}.`;
      if (status) status.textContent = '⚠️ ' + msg;
      toast(msg, 'error', 6000);
      e.target.value = '';
      _tplDraftMediaFile = null;
      return;
    }

    if (f.size > rules.maxBytes) {
      const maxMb = (rules.maxBytes / 1024 / 1024).toFixed(0);
      const myMb  = (f.size / 1024 / 1024).toFixed(1);
      const msg = `Archivo muy grande para ${ht} (${myMb}MB; máx ${maxMb}MB).`;
      if (status) status.textContent = '⚠️ ' + msg;
      toast(msg, 'error', 6000);
      e.target.value = '';
      _tplDraftMediaFile = null;
      return;
    }

    // Para imágenes: verificar dimensiones mínimas (192×192 según Meta).
    if (ht === 'IMAGE') {
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth < 192 || img.naturalHeight < 192) {
          const msg = `Imagen muy chica (${img.naturalWidth}×${img.naturalHeight}). Meta requiere mínimo 192×192 px.`;
          if (status) status.textContent = '⚠️ ' + msg;
          toast(msg, 'error', 6000);
          e.target.value = '';
          _tplDraftMediaFile = null;
          return;
        }
        _tplDraftMediaFile = f;
        if (status) status.textContent = `✓ Listo: ${f.name} · ${(f.size/1024).toFixed(0)} KB · ${img.naturalWidth}×${img.naturalHeight}`;
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast('No se pudo leer la imagen — ¿está corrupta?', 'error');
        e.target.value = '';
      };
      img.src = url;
      return;
    }

    _tplDraftMediaFile = f;
    if (status) status.textContent = `✓ Listo: ${f.name} · ${(f.size/1024).toFixed(0)} KB`;
  });

  // Botones — agregar / cambiar tipo / quitar
  document.getElementById('tplAddButtonBtn')?.addEventListener('click', addTplButton);
  document.getElementById('tplButtonsList')?.addEventListener('change', (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    if (e.target.classList.contains('tpl-btn-type')) {
      // Conservar text, resetear url/phone
      const cur = _tplDraftButtons[i] || {};
      _tplDraftButtons[i] = { type: e.target.value, text: cur.text || '' };
      renderTplButtonsList();
    }
  });
  document.getElementById('tplButtonsList')?.addEventListener('input', (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    if (!_tplDraftButtons[i]) return;
    if (e.target.classList.contains('tpl-btn-text')) _tplDraftButtons[i].text = e.target.value;
    if (e.target.classList.contains('tpl-btn-extra')) {
      const field = e.target.dataset.field;
      _tplDraftButtons[i][field] = e.target.value;
    }
  });
  document.getElementById('tplButtonsList')?.addEventListener('click', (e) => {
    if (!e.target.classList.contains('tpl-btn-remove')) return;
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i)) return;
    _tplDraftButtons.splice(i, 1);
    renderTplButtonsList();
  });

  // Variable insertion buttons
  document.querySelector('.tpl-var-row')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.tpl-var-btn');
    if (!btn) return;
    const ta = document.getElementById('tplBody');
    if (!ta) return;
    let v = btn.dataset.var;
    // Si es el botón de "+ Variable" → calcula el próximo {{N}} no usado
    if (btn.hasAttribute('data-var-num')) {
      const used = [...(ta.value.matchAll(/\{\{(\d+)\}\}/g))].map(m => Number(m[1]));
      const next = used.length ? Math.max(...used) + 1 : 1;
      v = `{{${next}}}`;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.setRangeText(v, start, end, 'end');
    ta.focus();
    syncTplPlaceholdersFromBody();
  });

  // Cuando el usuario edita el body manualmente, re-sincronizar placeholders.
  document.getElementById('tplBody')?.addEventListener('input', syncTplPlaceholdersFromBody);

  // Mostrar/ocultar caja de placeholders al cambiar tipo de plantilla
  document.querySelectorAll('input[name="tplType"]').forEach(r => {
    r.addEventListener('change', renderTplPlaceholdersBox);
  });

  // Capturar edición de label/example de placeholders.
  document.getElementById('tplPlaceholdersList')?.addEventListener('input', (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i) || !_tplDraftPlaceholders[i]) return;
    const field = e.target.dataset.field;
    if (field === 'label' || field === 'example') {
      _tplDraftPlaceholders[i][field] = e.target.value;
    }
  });
  // Cambio de mapping (select) — si elige un campo del contacto, auto-llena
  // label y ejemplo. Si elige Manual, los limpia para que el usuario escriba.
  document.getElementById('tplPlaceholdersList')?.addEventListener('change', (e) => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i) || !_tplDraftPlaceholders[i]) return;
    if (e.target.dataset.field === 'contactField') {
      const cf = e.target.value;
      _tplDraftPlaceholders[i].contactField = cf;
      if (cf && CONTACT_FIELD_DEFAULTS[cf]) {
        _tplDraftPlaceholders[i].label   = CONTACT_FIELD_DEFAULTS[cf].label;
        _tplDraftPlaceholders[i].example = CONTACT_FIELD_DEFAULTS[cf].example;
      } else {
        // Manual — limpia para que el usuario escriba
        _tplDraftPlaceholders[i].label   = '';
        _tplDraftPlaceholders[i].example = '';
      }
      renderTplPlaceholdersBox();
    }
  });

  // Card actions (delegated)
  document.getElementById('tplList')?.addEventListener('click', async (e) => {
    // Click en pastilla "Usado en: <bot>" → abrir el bot builder
    const botPill = e.target.closest('[data-go-to-bot]');
    if (botPill) {
      const botId = Number(botPill.dataset.goToBot);
      const bot = sbBots.find(b => b.id === botId);
      if (bot) {
        showView('bot');
        openBotBuilder(bot);
      } else {
        // Si sbBots no se ha cargado todavía, recarga y reintenta
        await loadSalsbots();
        const fresh = sbBots.find(b => b.id === botId);
        if (fresh) { showView('bot'); openBotBuilder(fresh); }
        else toast('No se encontró el bot', 'error');
      }
      return;
    }

    const id = Number(e.target.dataset.id);
    if (!id) return;
    if (e.target.classList.contains('tpl-edit-btn')) {
      const tmpl = _tplItems.find(t => t.id === id);
      if (tmpl) openTplModal(tmpl);
    } else if (e.target.classList.contains('tpl-del-btn')) {
      if (!confirm('¿Eliminar esta plantilla?')) return;
      try {
        await api('DELETE', `/api/templates/${id}`);
        _tplItems = _tplItems.filter(t => t.id !== id);
        renderTemplates();
        toast('Plantilla eliminada', 'success');
      } catch (e) { toast(e.message, 'error'); }
    } else if (e.target.classList.contains('tpl-submit-btn')) {
      await submitTplToMeta(id);
    } else if (e.target.classList.contains('tpl-sync-btn')) {
      await syncTplFromMeta(id);
    }
  });
}

// ═══════ Web Push notifications ═══════
let _vapidPublicKey = null;
let _swReg = null;

function urlBase64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    _swReg = await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[sw] register failed:', err.message);
  }
}

async function getCurrentPushSubscription() {
  if (!_swReg) return null;
  try { return await _swReg.pushManager.getSubscription(); }
  catch { return null; }
}

async function subscribeToPush() {
  if (!pushSupported()) throw new Error('Tu navegador no soporta notificaciones push');
  if (!_swReg) _swReg = await navigator.serviceWorker.ready;

  if (!_vapidPublicKey) {
    const r = await fetch('/api/push/vapid-public-key').then(r => r.json()).catch(() => ({}));
    _vapidPublicKey = r.publicKey;
  }
  if (!_vapidPublicKey) throw new Error('Servidor sin VAPID configurado');

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permiso de notificaciones denegado');

  const sub = await _swReg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8(_vapidPublicKey),
  });

  await api('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  return sub;
}

async function unsubscribeFromPush() {
  const sub = await getCurrentPushSubscription();
  if (!sub) return;
  try { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch (_) {}
  try { await sub.unsubscribe(); } catch (_) {}
}

async function refreshNotifPaneState() {
  const status = document.getElementById('notifStatus');
  const subBtn = document.getElementById('notifSubscribeBtn');
  const unsBtn = document.getElementById('notifUnsubscribeBtn');
  const testBtn = document.getElementById('notifTestBtn');
  const hint = document.getElementById('notifHint');
  if (!status) return;

  if (!pushSupported()) {
    status.textContent = '⚠️ Tu navegador no soporta notificaciones push';
    [subBtn, unsBtn, testBtn].forEach(b => b && (b.hidden = true));
    if (hint) hint.textContent = 'Usa Chrome, Firefox, Edge o Safari ≥16 con HTTPS.';
    return;
  }

  const perm = Notification.permission;
  const sub = await getCurrentPushSubscription();

  if (perm === 'denied') {
    status.textContent = '⛔ Permiso bloqueado en este navegador';
    [subBtn, unsBtn].forEach(b => b && (b.hidden = true));
    if (testBtn) testBtn.hidden = true;
    if (hint) hint.textContent = 'Tendrás que reactivar el permiso desde la configuración del navegador (candado en la barra de direcciones).';
    return;
  }

  if (sub) {
    status.textContent = '✓ Notificaciones activadas en este dispositivo';
    if (subBtn) subBtn.hidden = true;
    if (unsBtn) unsBtn.hidden = false;
    if (testBtn) testBtn.hidden = false;
    if (hint) hint.textContent = 'Recibirás alertas cuando WhatsApp se desconecte o el servidor tenga problemas.';
  } else {
    status.textContent = 'Notificaciones desactivadas';
    if (subBtn) subBtn.hidden = false;
    if (unsBtn) unsBtn.hidden = true;
    if (testBtn) testBtn.hidden = true;
    if (hint) hint.textContent = 'Permite notificaciones para enterarte cuando algo pase fuera de la app.';
  }
}

async function loadNotifLog() {
  const root = document.getElementById('notifLog');
  if (!root) return;
  try {
    const data = await api('GET', '/api/push/log');
    if (!data.items?.length) {
      root.innerHTML = '<div class="notif-log-empty">Sin alertas recientes.</div>';
      return;
    }
    root.innerHTML = data.items.map(it => {
      const when = new Date(it.created_at * 1000).toLocaleString('es-MX');
      const kindIcon = it.kind === 'integration_down' ? '⚠️'
                    : it.kind === 'integration_recovered' ? '✓'
                    : it.kind === 'manual' ? '🔔'
                    : '•';
      return `<div class="notif-log-item">
        <strong>${kindIcon} ${escapeHtml(it.title || it.kind)}</strong>
        <span>${escapeHtml(it.body || '')}</span>
        <span class="meta">${when} · enviadas: ${it.sent_count} · fallidas: ${it.failed}</span>
      </div>`;
    }).join('');
  } catch (err) {
    root.innerHTML = `<div class="notif-log-empty">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function setupNotifications() {
  document.getElementById('notifSubscribeBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('notifSubscribeBtn');
    btn.disabled = true; btn.textContent = 'Activando…';
    try {
      await subscribeToPush();
      toast('Notificaciones activadas ✓', 'success');
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Activar notificaciones';
      refreshNotifPaneState();
    }
  });

  document.getElementById('notifUnsubscribeBtn')?.addEventListener('click', async () => {
    if (!confirm('¿Desactivar notificaciones en este dispositivo?')) return;
    try { await unsubscribeFromPush(); toast('Desactivadas', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    refreshNotifPaneState();
  });

  document.getElementById('notifTestBtn')?.addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/push/test');
      toast(`Push enviado a ${r.sent || 0} dispositivo(s)`, 'success');
      setTimeout(loadNotifLog, 800);
    } catch (err) { toast(err.message, 'error'); }
  });

  // Refresh estado cuando se entra al pane
  document.querySelectorAll('[data-settings="notificaciones"]').forEach((el) => {
    if (el.tagName === 'BUTTON') {
      el.addEventListener('click', () => { refreshNotifPaneState(); loadNotifLog(); });
    }
  });
}
