'use strict';

// Routes para Live Support.
//
// authRouter (privado, requiere sesión Wapi101):
//   POST   /api/live-support/start          — cliente inicia sesión
//   POST   /api/live-support/end            — cliente termina sesión propia
//   GET    /api/live-support/status         — status sesión propia
//   POST   /api/live-support/:token/events  — cliente manda batch rrweb
//
// superRouter (privado, requiere super-admin token):
//   GET    /api/super/live-support/active   — lista sesiones activas
//   GET    /api/super/live-support/:token/stream — SSE para recibir eventos
//   POST   /api/super/live-support/:token/end    — admin termina sesión

const express = require('express');
const svc = require('./service');

function authRouter(db) {
  const router = express.Router();

  router.post('/start', express.json(), (req, res) => {
    try {
      const advisor = req.advisor || null;
      const out = svc.startSession(db, {
        tenantId:    req.tenantId,
        advisorId:   advisor?.id || null,
        clientLabel: advisor?.name || 'Cliente',
        userAgent:   req.headers['user-agent'] || null,
      });
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/end', express.json(), (req, res) => {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'token required' });
    // Validar que la sesión pertenece a este tenant (no permitir cerrar
    // sesiones de otros tenants)
    const sess = db.prepare(
      "SELECT tenant_id FROM live_support_sessions WHERE token = ? AND status = 'active'"
    ).get(token);
    if (sess && sess.tenant_id !== req.tenantId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    const out = svc.endSession(db, token, { reason: 'client_ended' });
    res.json(out || { ended: false, reason: 'not_active' });
  });

  router.get('/status', (req, res) => {
    // Devuelve la sesión activa del advisor actual si existe
    const advisor = req.advisor || null;
    const row = db.prepare(`
      SELECT token, started_at, event_count
      FROM live_support_sessions
      WHERE tenant_id = ? AND advisor_id = ? AND status = 'active'
      ORDER BY started_at DESC LIMIT 1
    `).get(req.tenantId, advisor?.id || null);
    res.json({ active: !!row, session: row || null });
  });

  // POST events batch (puede ser grande — hasta 1MB de chunks rrweb)
  router.post('/:token/events', express.json({ limit: '2mb' }), (req, res) => {
    const { token } = req.params;
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    // Validar que la sesión pertenece al tenant
    const sess = db.prepare(
      "SELECT tenant_id FROM live_support_sessions WHERE token = ? AND status = 'active'"
    ).get(token);
    if (!sess) return res.status(404).json({ error: 'not_found' });
    if (sess.tenant_id !== req.tenantId) return res.status(403).json({ error: 'forbidden' });
    const out = svc.pushEvents(db, token, events);
    res.json(out || { ok: false });
  });

  return router;
}

function superRouter(db) {
  const router = express.Router();

  router.get('/active', (req, res) => {
    res.json({ items: svc.getActiveSessions(db) });
  });

  router.post('/:token/end', express.json(), (req, res) => {
    const { token } = req.params;
    const out = svc.endSession(db, token, { reason: 'admin_ended' });
    res.json(out || { ended: false });
  });

  // SSE stream — el viewer (admin) recibe los eventos rrweb en tiempo real
  router.get('/:token/stream', (req, res) => {
    const { token } = req.params;
    // Setup SSE headers
    res.set({
      'Content-Type':       'text/event-stream',
      'Cache-Control':      'no-cache, no-transform',
      'Connection':         'keep-alive',
      'X-Accel-Buffering':  'no',  // disable nginx buffering
    });
    res.flushHeaders?.();

    // Heartbeat cada 25s para mantener conexión viva
    const heartbeat = setInterval(() => {
      try { res.write(': hb\n\n'); } catch (_) {}
    }, 25_000);

    const viewerLabel = req.superAdmin?.email || req.headers['x-super-label'] || 'super-admin';
    const attached = svc.attachViewer(db, token, res, viewerLabel);
    if (!attached) {
      clearInterval(heartbeat);
      return;
    }

    req.on('close', () => {
      clearInterval(heartbeat);
      svc.detachViewer(token, res);
    });
  });

  return router;
}

module.exports = { authRouter, superRouter };
