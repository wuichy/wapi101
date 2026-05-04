// Conversaciones y mensajes. Funciones puras que reciben `db`.

const customerService = require('../customers/service');

// Formatea timestamp Unix → string legible
function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  if (now - d < 6 * 86400000) {
    return d.toLocaleDateString('es-MX', { weekday: 'short' });
  }
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' });
}

function hydrateConvo(db, row) {
  if (!row) return null;
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(row.contact_id);
  const firstName = contact?.first_name || '';
  const lastName  = contact?.last_name  || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || row.external_id || `#${row.id}`;

  // Detectar si el último mensaje saliente está en estado 'failed' — eso
  // significa que hay un problema activo con la entrega (lead bloqueó, número
  // sin WhatsApp, suspendido, etc.). Si después hay otro outgoing exitoso
  // (sent/delivered/read), el problema se considera resuelto.
  const lastOut = db.prepare(`
    SELECT status, error_reason, created_at
      FROM messages
     WHERE conversation_id = ? AND direction = 'outgoing'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get(row.id);
  const deliveryFailure = (lastOut && lastOut.status === 'failed')
    ? { reason: lastOut.error_reason || 'Error desconocido', at: lastOut.created_at }
    : null;

  return {
    id:            row.id,
    contactId:     row.contact_id,
    integrationId: row.integration_id,
    provider:      row.provider,
    externalId:    row.external_id,
    name,
    phone:         contact?.phone || row.external_id || '',
    lastMessage:    row.last_message || '',
    lastMessageAt:  row.last_message_at,
    lastIncomingAt: row.last_incoming_at || null,
    time:           fmtTime(row.last_message_at),
    unreadCount:    row.unread_count || 0,
    botPaused:      !!row.bot_paused,
    botPausedAt:    row.bot_paused_at || null,
    pinned:         !!row.pinned,
    archived:       !!row.archived,
    mutedUntil:     row.muted_until || null,
    deliveryFailure, // null si el último outgoing fue OK; objeto si falló
    createdAt:      row.created_at,
  };
}

function list(db, { search, provider, unreadOnly, contactId, includeArchived = false, page = 1, pageSize = 50 } = {}) {
  const allowedSizes = [20, 50, 100, 200];
  pageSize = allowedSizes.includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);

  const conditions = [];
  const params = [];

  if (provider) { conditions.push('c.provider = ?'); params.push(provider); }
  if (unreadOnly) { conditions.push('c.unread_count > 0'); }
  if (contactId) { conditions.push('c.contact_id = ?'); params.push(contactId); }
  if (!includeArchived) conditions.push('COALESCE(c.archived, 0) = 0');
  if (search) {
    conditions.push(`(
      LOWER(co.first_name) LIKE ?
      OR LOWER(IFNULL(co.last_name,'')) LIKE ?
      OR LOWER(IFNULL(co.phone,'')) LIKE ?
      OR LOWER(IFNULL(c.external_id,'')) LIKE ?
      OR LOWER(IFNULL(c.last_message,'')) LIKE ?
    )`);
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q, q, q, q);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const countRow = db.prepare(`
    SELECT COUNT(*) AS n FROM conversations c
    LEFT JOIN contacts co ON co.id = c.contact_id
    ${where}
  `).get(...params);

  const rows = db.prepare(`
    SELECT c.* FROM conversations c
    LEFT JOIN contacts co ON co.id = c.contact_id
    ${where}
    ORDER BY COALESCE(c.pinned, 0) DESC, c.last_message_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map((r) => hydrateConvo(db, r)),
    total: countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
  };
}

function getById(db, id) {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  return hydrateConvo(db, row);
}

// Busca o crea una conversación para (provider, externalId). Si crea, también busca/crea el contacto.
function findOrCreate(db, { provider, externalId, integrationId, contactPhone, contactName }) {
  let row = db.prepare('SELECT * FROM conversations WHERE provider = ? AND external_id = ?').get(provider, String(externalId));
  if (row) return row;

  // Buscar o crear contacto
  let contact = contactPhone
    ? db.prepare('SELECT * FROM contacts WHERE phone = ?').get(customerService.normalizePhone(contactPhone))
    : null;

  if (!contact && contactPhone) {
    const normPhone = customerService.normalizePhone(contactPhone);
    const parts = (contactName || '').trim().split(/\s+/);
    const firstName = parts[0] || normPhone || 'Desconocido';
    const lastName  = parts.slice(1).join(' ') || null;
    const result = db.prepare(
      'INSERT INTO contacts (first_name, last_name, phone) VALUES (?, ?, ?)'
    ).run(firstName, lastName, normPhone);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
  }

  const result = db.prepare(`
    INSERT INTO conversations (contact_id, integration_id, provider, external_id)
    VALUES (?, ?, ?, ?)
  `).run(contact?.id || null, integrationId || null, provider, String(externalId));

  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
}

function addMessage(db, conversationId, { externalId, direction, provider, body, mediaUrl, status = 'sent', createdAt }) {
  // Idempotencia por external_id
  if (externalId) {
    const existing = db.prepare('SELECT id FROM messages WHERE provider = ? AND external_id = ?').get(provider, String(externalId));
    if (existing) return existing;
  }

  const ts = createdAt || Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO messages (conversation_id, external_id, direction, provider, body, media_url, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conversationId, externalId || null, direction, provider, body || null, mediaUrl || null, status, ts);

  // Actualizar last_message en conversación
  const unreadDelta = direction === 'incoming' ? 1 : 0;
  const incomingSet = direction === 'incoming' ? ', last_incoming_at = ?' : '';
  const incomingArgs = direction === 'incoming' ? [(body || '').slice(0, 200), ts, unreadDelta, ts, conversationId] : [(body || '').slice(0, 200), ts, unreadDelta, conversationId];
  db.prepare(`
    UPDATE conversations
    SET last_message = ?, last_message_at = ?, unread_count = unread_count + ?${incomingSet}
    WHERE id = ?
  `).run(...incomingArgs);

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
}

function listMessages(db, conversationId, { page = 1, pageSize = 60 } = {}) {
  pageSize = Math.min(200, Math.max(1, Number(pageSize) || 60));
  page = Math.max(1, Number(page) || 1);

  const countRow = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conversationId);
  const rows = db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ? OFFSET ?
  `).all(conversationId, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map((m) => ({
      id:             m.id,
      conversationId: m.conversation_id,
      externalId:     m.external_id,
      direction:      m.direction,
      provider:       m.provider,
      body:           m.body || '',
      mediaUrl:       m.media_url,
      status:         m.status,
      errorReason:    m.error_reason || null,
      time:           fmtTime(m.created_at),
      createdAt:      m.created_at,
    })),
    total:      countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
  };
}

function markRead(db, conversationId) {
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ?').run(conversationId);
}

function setBotPaused(db, conversationId, paused) {
  db.prepare('UPDATE conversations SET bot_paused = ?, bot_paused_at = ? WHERE id = ?')
    .run(paused ? 1 : 0, paused ? Math.floor(Date.now()/1000) : null, conversationId);
}

function setPinned(db, conversationId, pinned) {
  db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, conversationId);
}
function setArchived(db, conversationId, archived) {
  db.prepare('UPDATE conversations SET archived = ? WHERE id = ?').run(archived ? 1 : 0, conversationId);
}
function setMutedUntil(db, conversationId, untilTs) {
  db.prepare('UPDATE conversations SET muted_until = ? WHERE id = ?').run(untilTs || null, conversationId);
}
function markUnread(db, conversationId) {
  // Si ya es 0, lo ponemos en 1 para que se vea el badge azul
  db.prepare('UPDATE conversations SET unread_count = MAX(unread_count, 1) WHERE id = ?').run(conversationId);
}

module.exports = { list, getById, findOrCreate, addMessage, listMessages, markRead, markUnread, setBotPaused, setPinned, setArchived, setMutedUntil, fmtTime };
