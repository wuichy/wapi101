'use strict';

// Live Support — co-browsing con rrweb.
// Almacena sesiones activas en memoria + en DB. Los eventos rrweb NO se
// guardan en DB (volumen alto, ~50 eventos/seg en typing+mouse). Solo
// el snapshot inicial del DOM y el delta incremental viven en memoria
// mientras la sesión esté activa.
//
// Cuando un viewer (admin) se conecta vía SSE, recibe:
//   1. El snapshot inicial (todos los eventos acumulados de la sesión)
//   2. Cada nuevo chunk en tiempo real conforme el cliente lo manda
//
// Cuando la sesión termina (status='ended'), los eventos en memoria se
// liberan. No hay "replay" de sesiones pasadas — es solo live.

const crypto = require('crypto');

// Alfabeto seguro — sin 0/O/1/I que se confunden por teléfono
const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  // 6 caracteres + dash (XQ7-K42 — 3-3 fácil de leer)
  let s = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    s += SAFE_ALPHABET[bytes[i] % SAFE_ALPHABET.length];
  }
  return s.slice(0, 3) + '-' + s.slice(3, 6);
}

// ─── Estado en memoria ────────────────────────────────────────────────
// Map<token, {
//   sessionId, events[], viewers: Set<sseResponse>,
//   lastEventAt, eventCount
// }>
const _sessions = new Map();

// Auto-expirar sesiones sin actividad de cliente por más de 5 min
const STALE_TIMEOUT_MS = 5 * 60 * 1000;

function _now() { return Math.floor(Date.now() / 1000); }

function _ensureSessionMem(token) {
  let mem = _sessions.get(token);
  if (!mem) {
    mem = {
      events: [],
      viewers: new Set(),
      lastEventAt: Date.now(),
      eventCount: 0,
    };
    _sessions.set(token, mem);
  }
  return mem;
}

// ─── API pública ──────────────────────────────────────────────────────

function startSession(db, { tenantId, advisorId, clientLabel, userAgent }) {
  if (!tenantId) throw new Error('tenantId required');
  // Si el advisor ya tiene una sesión activa, terminarla primero (evita
  // tokens viejos zombies si dieron click 2 veces).
  const existing = db.prepare(`
    SELECT id, token FROM live_support_sessions
    WHERE tenant_id = ? AND advisor_id = ? AND status = 'active' LIMIT 1
  `).get(tenantId, advisorId || null);
  if (existing) {
    endSession(db, existing.token, { reason: 'restarted' });
  }
  // Generar código único (reintentar si choca)
  let token;
  for (let i = 0; i < 10; i++) {
    token = generateCode();
    const dup = db.prepare(
      "SELECT id FROM live_support_sessions WHERE token = ? AND status = 'active'"
    ).get(token);
    if (!dup) break;
  }
  const r = db.prepare(`
    INSERT INTO live_support_sessions
      (token, tenant_id, advisor_id, client_label, user_agent, status, started_at)
    VALUES (?, ?, ?, ?, ?, 'active', unixepoch())
  `).run(token, tenantId, advisorId || null, clientLabel || null, userAgent || null);
  _ensureSessionMem(token);
  return { id: r.lastInsertRowid, token, startedAt: _now() };
}

function endSession(db, token, { reason = 'ended' } = {}) {
  const row = db.prepare(
    "SELECT id FROM live_support_sessions WHERE token = ? AND status = 'active'"
  ).get(token);
  if (!row) return null;
  db.prepare(`
    UPDATE live_support_sessions
    SET status = 'ended', ended_at = unixepoch()
    WHERE id = ?
  `).run(row.id);
  // Notificar viewers y liberar memoria
  const mem = _sessions.get(token);
  if (mem) {
    for (const viewer of mem.viewers) {
      try { viewer.write(`event: end\ndata: {"reason":"${reason}"}\n\n`); viewer.end(); } catch (_) {}
    }
    _sessions.delete(token);
  }
  return { ended: true, reason };
}

// Cliente envía un batch de eventos rrweb (POST cada 200ms)
function pushEvents(db, token, events) {
  const sess = db.prepare(
    "SELECT id, tenant_id FROM live_support_sessions WHERE token = ? AND status = 'active'"
  ).get(token);
  if (!sess) return null;
  const mem = _ensureSessionMem(token);
  if (Array.isArray(events) && events.length) {
    for (const e of events) mem.events.push(e);
    mem.lastEventAt = Date.now();
    mem.eventCount += events.length;
    // Cap memoria — más de 5000 eventos acumulados es session muy larga,
    // mejor recortar viejos para no quemar RAM
    if (mem.events.length > 5000) mem.events.splice(0, mem.events.length - 5000);
    // Update DB stats cada N eventos para no escribir cada 200ms
    if (mem.eventCount % 50 === 0) {
      db.prepare(`UPDATE live_support_sessions SET last_event_at = unixepoch(), event_count = ? WHERE id = ?`)
        .run(mem.eventCount, sess.id);
    }
    // Fan-out: enviar a cada viewer conectado
    for (const viewer of mem.viewers) {
      try {
        viewer.write(`data: ${JSON.stringify(events)}\n\n`);
      } catch (_) {
        // Viewer ya se fue, limpiarlo
        mem.viewers.delete(viewer);
      }
    }
  }
  return { ok: true, eventCount: mem.eventCount };
}

// Viewer (admin) se conecta y empieza a recibir eventos
function attachViewer(db, token, sseResponse, viewerLabel) {
  const sess = db.prepare(
    "SELECT * FROM live_support_sessions WHERE token = ? AND status = 'active'"
  ).get(token);
  if (!sess) {
    try { sseResponse.write(`event: error\ndata: {"error":"not_found"}\n\n`); sseResponse.end(); } catch (_) {}
    return null;
  }
  const mem = _ensureSessionMem(token);
  mem.viewers.add(sseResponse);
  // Registrar viewer_label
  if (viewerLabel) {
    db.prepare(`UPDATE live_support_sessions SET viewer_label = ? WHERE id = ?`).run(viewerLabel, sess.id);
  }
  // Enviar snapshot inicial (todos los eventos acumulados)
  try {
    sseResponse.write(`event: meta\ndata: ${JSON.stringify({
      token: sess.token,
      clientLabel: sess.client_label,
      startedAt: sess.started_at,
      userAgent: sess.user_agent,
      eventCount: mem.events.length,
    })}\n\n`);
    if (mem.events.length) {
      sseResponse.write(`data: ${JSON.stringify(mem.events)}\n\n`);
    }
  } catch (_) {}
  return { ok: true };
}

function detachViewer(token, sseResponse) {
  const mem = _sessions.get(token);
  if (mem) mem.viewers.delete(sseResponse);
}

function getActiveSessions(db) {
  return db.prepare(`
    SELECT s.id, s.token, s.tenant_id, s.advisor_id, s.client_label,
           s.user_agent, s.started_at, s.last_event_at, s.event_count,
           s.viewer_label, t.name AS tenant_name
    FROM live_support_sessions s
    LEFT JOIN tenants t ON t.id = s.tenant_id
    WHERE s.status = 'active'
    ORDER BY s.started_at DESC
  `).all();
}

function getSessionStatus(db, token) {
  return db.prepare(`
    SELECT id, token, status, started_at, ended_at, event_count
    FROM live_support_sessions WHERE token = ?
  `).get(token);
}

// ─── Cleanup periodico ────────────────────────────────────────────────
function _cleanupStale(db) {
  const cutoff = Date.now() - STALE_TIMEOUT_MS;
  for (const [token, mem] of _sessions.entries()) {
    if (mem.lastEventAt < cutoff && mem.viewers.size === 0) {
      endSession(db, token, { reason: 'stale' });
    }
  }
}

function startCleanupTimer(db) {
  setInterval(() => _cleanupStale(db), 60_000);
  console.log('[live-support] cleanup timer started (5min stale timeout)');
}

module.exports = {
  generateCode,
  startSession,
  endSession,
  pushEvents,
  attachViewer,
  detachViewer,
  getActiveSessions,
  getSessionStatus,
  startCleanupTimer,
};
