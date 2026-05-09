// Conversaciones y mensajes — multi-tenant.
//
// Convención: todas las funciones públicas reciben tenantId como 2do argumento.
// Para callers internos sin contexto auth (webhooks, bot/engine, sender),
// pueden pasar null y el servicio deriva el tenant del integration_id pasado
// (en findOrCreate) o de la conversación referenciada (en addMessage, etc.).

const customerService = require('../customers/service');

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

// Helpers de derivación de tenant.
function _tenantFromConvo(db, convoId) {
  if (!convoId) return null;
  return db.prepare('SELECT tenant_id FROM conversations WHERE id = ?').get(convoId)?.tenant_id || null;
}
function _tenantFromIntegration(db, integrationId) {
  if (!integrationId) return null;
  return db.prepare('SELECT tenant_id FROM integrations WHERE id = ?').get(integrationId)?.tenant_id || null;
}

function hydrateConvo(db, tenantId, row) {
  if (!row) return null;
  const t = tenantId ?? row.tenant_id;
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(row.contact_id, t);
  const firstName = contact?.first_name || '';
  const lastName  = contact?.last_name  || '';
  const name = [firstName, lastName].filter(Boolean).join(' ') || row.external_id || `#${row.id}`;

  const lastOut = db.prepare(`
    SELECT status, error_reason, created_at
      FROM messages
     WHERE conversation_id = ? AND tenant_id = ? AND direction = 'outgoing'
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `).get(row.id, t);
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
    deliveryFailure,
    createdAt:      row.created_at,
    tenantId:       row.tenant_id,
  };
}

function list(db, tenantId, { search, provider, unreadOnly, contactId, includeArchived = false, page = 1, pageSize = 50, pipelineIds = null, includeOrphans = false } = {}) {
  const allowedSizes = [20, 50, 100, 200];
  pageSize = allowedSizes.includes(Number(pageSize)) ? Number(pageSize) : 50;
  page = Math.max(1, Number(page) || 1);

  const conditions = ['c.tenant_id = ?'];
  const params = [tenantId];

  if (provider) {
    conditions.push('c.provider = ?'); params.push(provider);
  } else {
    // Email conversations belong to the Mail view, not the main chat
    conditions.push("c.provider NOT IN ('email','gmail','outlook','icloud_mail','yahoo_mail')");
    // Excluir conversaciones ghost creadas como efecto secundario de comentarios FB/IG
    // (no tienen mensajes reales — last_message_at es NULL)
    conditions.push('c.last_message_at IS NOT NULL');
  }
  if (unreadOnly) { conditions.push('c.unread_count > 0'); }
  if (contactId) { conditions.push('c.contact_id = ?'); params.push(contactId); }
  if (!includeArchived) conditions.push('COALESCE(c.archived, 0) = 0');
  if (pipelineIds && Array.isArray(pipelineIds) && pipelineIds.length > 0) {
    const placeholders = pipelineIds.map(() => '?').join(',');
    if (includeOrphans) {
      // Empresa A: contactos con expediente en estos pipelines O sin ningún expediente
      conditions.push(`(
        EXISTS (
          SELECT 1 FROM expedients e
          WHERE e.contact_id = c.contact_id AND e.tenant_id = c.tenant_id
            AND e.pipeline_id IN (${placeholders})
        ) OR NOT EXISTS (
          SELECT 1 FROM expedients e2
          WHERE e2.contact_id = c.contact_id AND e2.tenant_id = c.tenant_id
        )
      )`);
    } else {
      conditions.push(`EXISTS (
        SELECT 1 FROM expedients e
        WHERE e.contact_id = c.contact_id AND e.tenant_id = c.tenant_id
          AND e.pipeline_id IN (${placeholders})
      )`);
    }
    params.push(...pipelineIds);
  }
  if (search) {
    // Buscador expandido: nombre, teléfono, email, external_id, último msg,
    // mensajes históricos (body de cualquier mensaje de la conversación) y
    // etiquetas del contacto (vía tabla contact_tags).
    conditions.push(`(
      LOWER(co.first_name) LIKE ?
      OR LOWER(IFNULL(co.last_name,'')) LIKE ?
      OR LOWER(IFNULL(co.phone,'')) LIKE ?
      OR LOWER(IFNULL(co.email,'')) LIKE ?
      OR LOWER(IFNULL(c.external_id,'')) LIKE ?
      OR LOWER(IFNULL(c.last_message,'')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = co.id
          AND LOWER(ct.tag) LIKE ?
        LIMIT 1
      )
      OR EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.tenant_id = c.tenant_id
          AND LOWER(IFNULL(m.body,'')) LIKE ?
        LIMIT 1
      )
    )`);
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q, q, q, q, q, q, q);
  }

  const where = 'WHERE ' + conditions.join(' AND ');
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
    items: rows.map((r) => hydrateConvo(db, tenantId, r)),
    total: countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
  };
}

function getById(db, tenantId, id) {
  const t = tenantId ?? _tenantFromConvo(db, id);
  if (!t) return null;
  const row = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(id, t);
  return hydrateConvo(db, t, row);
}

// Busca o crea una conversación. tenantId puede ser null si se pasa integrationId
// (caso webhook), entonces se deriva del integration. Para creación de contacto
// nuevo se usa el mismo tenantId.
function findOrCreate(db, tenantId, { provider, externalId, integrationId, contactPhone, contactName, contactId }) {
  const t = tenantId ?? _tenantFromIntegration(db, integrationId);
  if (!t) throw new Error('No se pudo determinar tenant para la conversación');

  let row = db.prepare('SELECT * FROM conversations WHERE provider = ? AND external_id = ? AND tenant_id = ?').get(provider, String(externalId), t);
  if (row) {
    if (!row.integration_id && integrationId) {
      db.prepare('UPDATE conversations SET integration_id = ? WHERE id = ?').run(integrationId, row.id);
      row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id);
    }
    return row;
  }

  // Buscar contacto existente del MISMO tenant por id directo, teléfono o email.
  let contact = null;
  if (contactId) {
    contact = db.prepare('SELECT * FROM contacts WHERE id = ? AND tenant_id = ?').get(contactId, t);
  } else if (contactPhone) {
    const normPhone = customerService.normalizePhone(contactPhone);
    contact = db.prepare('SELECT * FROM contacts WHERE phone = ? AND tenant_id = ?').get(normPhone, t);
    if (!contact) {
      const parts = (contactName || '').trim().split(/\s+/);
      const firstName = parts[0] || normPhone || 'Desconocido';
      const lastName  = parts.slice(1).join(' ') || null;
      const result = db.prepare(
        'INSERT INTO contacts (tenant_id, first_name, last_name, phone) VALUES (?, ?, ?, ?)'
      ).run(t, firstName, lastName, normPhone);
      contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
    }
  } else {
    // Sin teléfono ni contactId (p. ej. comentarios de FB/IG o Messenger sin datos de contacto).
    // Crear contacto básico con nombre o placeholder para no violar NOT NULL en conversations.
    const name  = (contactName || '').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    const first = parts[0] || `Usuario ${String(externalId || '').slice(0, 8)}`;
    const last  = parts.slice(1).join(' ') || null;
    const result = db.prepare(
      'INSERT INTO contacts (tenant_id, first_name, last_name) VALUES (?, ?, ?)'
    ).run(t, first, last);
    contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid);
  }

  const result = db.prepare(`
    INSERT INTO conversations (tenant_id, contact_id, integration_id, provider, external_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(t, contact?.id || null, integrationId || null, provider, String(externalId));

  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid);
}

// Mapper único de fila cruda de `messages` a shape camelCase para el frontend.
// Se usa tanto en addMessage (para que el POST devuelva el mismo shape que el GET)
// como en listMessages.
function _mapMessageRow(m) {
  if (!m) return null;
  return {
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
  };
}

function addMessage(db, tenantId, conversationId, { externalId, direction, provider, body, mediaUrl, status = 'sent', createdAt }) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) throw new Error('Conversación no encontrada');

  // Idempotencia por external_id (dentro del tenant — un mismo external_id
  // podría existir en otro tenant si vinieran del mismo provider y hubiera
  // colisión, aunque en la práctica los IDs de Meta/Telegram son globales).
  if (externalId) {
    const existing = db.prepare('SELECT * FROM messages WHERE provider = ? AND external_id = ? AND tenant_id = ?').get(provider, String(externalId), t);
    if (existing) return _mapMessageRow(existing);
  }

  const ts = createdAt || Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO messages (tenant_id, conversation_id, external_id, direction, provider, body, media_url, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(t, conversationId, externalId || null, direction, provider, body || null, mediaUrl || null, status, ts);

  // Actualizar last_message en conversación (con tenant para defensa adicional).
  const unreadDelta = direction === 'incoming' ? 1 : 0;
  if (direction === 'incoming') {
    db.prepare(`
      UPDATE conversations
      SET last_message = ?, last_message_at = ?, unread_count = unread_count + ?, last_incoming_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run((body || '').slice(0, 200), ts, unreadDelta, ts, conversationId, t);
  } else {
    db.prepare(`
      UPDATE conversations
      SET last_message = ?, last_message_at = ?
      WHERE id = ? AND tenant_id = ?
    `).run((body || '').slice(0, 200), ts, conversationId, t);
  }

  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid);
  return _mapMessageRow(row);
}

function listMessages(db, tenantId, conversationId, { page = 1, pageSize = 60 } = {}) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return { items: [], total: 0, page: 1, pageSize, totalPages: 1 };
  pageSize = Math.min(200, Math.max(1, Number(pageSize) || 60));
  page = Math.max(1, Number(page) || 1);

  const countRow = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND tenant_id = ?').get(conversationId, t);
  // Página 1 = mensajes más recientes; páginas siguientes = más viejos.
  // Traemos DESC con OFFSET y luego invertimos a ASC para el render cronológico.
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT * FROM messages WHERE conversation_id = ? AND tenant_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    ) ORDER BY created_at ASC, id ASC
  `).all(conversationId, t, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map(_mapMessageRow),
    total:      countRow.n,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(countRow.n / pageSize)),
  };
}

function markRead(db, tenantId, conversationId) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET unread_count = 0 WHERE id = ? AND tenant_id = ?').run(conversationId, t);
}

function setBotPaused(db, tenantId, conversationId, paused) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET bot_paused = ?, bot_paused_at = ? WHERE id = ? AND tenant_id = ?')
    .run(paused ? 1 : 0, paused ? Math.floor(Date.now()/1000) : null, conversationId, t);
}

function setPinned(db, tenantId, conversationId, pinned) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET pinned = ? WHERE id = ? AND tenant_id = ?').run(pinned ? 1 : 0, conversationId, t);
}
function setArchived(db, tenantId, conversationId, archived) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET archived = ? WHERE id = ? AND tenant_id = ?').run(archived ? 1 : 0, conversationId, t);
}
function setMutedUntil(db, tenantId, conversationId, untilTs) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET muted_until = ? WHERE id = ? AND tenant_id = ?').run(untilTs || null, conversationId, t);
}
function markUnread(db, tenantId, conversationId) {
  const t = tenantId ?? _tenantFromConvo(db, conversationId);
  if (!t) return;
  db.prepare('UPDATE conversations SET unread_count = MAX(unread_count, 1) WHERE id = ? AND tenant_id = ?').run(conversationId, t);
}

module.exports = { list, getById, findOrCreate, addMessage, listMessages, markRead, markUnread, setBotPaused, setPinned, setArchived, setMutedUntil, fmtTime };
