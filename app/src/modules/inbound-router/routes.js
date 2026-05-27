'use strict';

// Rutas para el Híbrido IA+Bots. Se monta bajo /api/ia-hybrid (privado).
//
// Endpoints:
//   GET    /settings                       — config del tenant (toggles)
//   PUT    /settings                       — actualizar toggles
//   GET    /conversations/:id/state        — estado de owner de una convo
//   POST   /conversations/:id/ai-mode      — set ai_mode (auto/off/human_lock)
//   POST   /conversations/:id/give-back    — devolver a IA inmediato
//   POST   /conversations/:id/take-over    — modo humano permanente (lock)
//   GET    /logs                           — telemetría reciente (debug)

const express = require('express');
const svc = require('./service');

module.exports = function createRouter(db) {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));

  // ─── Preflight check: ¿qué bots chocan con el coordinador? ──────
  // Devuelve los bots con trigger_type='always' que serían incompatibles
  // si el coordinador se activa. Frontend lo usa para mostrar advertencia.
  router.get('/incompatible-bots', (req, res) => {
    const rows = db.prepare(`
      SELECT id, name, trigger_type, enabled
      FROM salsbots
      WHERE tenant_id = ? AND trigger_type = 'always' AND enabled = 1
      ORDER BY id
    `).all(req.tenantId);
    res.json({ items: rows });
  });

  // ─── Aplicar incompatibilidad: deshabilitar bots 'always' ───────
  // Frontend lo llama después de confirmar el modal de advertencia.
  router.post('/disable-incompatible-bots', (req, res) => {
    const result = db.prepare(`
      UPDATE salsbots SET enabled = 0
      WHERE tenant_id = ? AND trigger_type = 'always' AND enabled = 1
    `).run(req.tenantId);
    res.json({ ok: true, disabled: result.changes });
  });

  // ─── Settings del tenant (toggles) ──────────────────────────────
  router.get('/settings', (req, res) => {
    const row = db.prepare(`
      SELECT ia_hybrid_enabled, ia_matcher_enabled, ia_fallback_enabled,
             human_takeover_window_min
      FROM tenants WHERE id = ?
    `).get(req.tenantId);
    res.json(row || {});
  });

  router.put('/settings', (req, res) => {
    const { hybridEnabled, matcherEnabled, fallbackEnabled, takeoverWindowMin } = req.body || {};
    const updates = [];
    const params  = [];
    if (typeof hybridEnabled === 'boolean')   { updates.push('ia_hybrid_enabled = ?');     params.push(hybridEnabled ? 1 : 0); }
    if (typeof matcherEnabled === 'boolean')  { updates.push('ia_matcher_enabled = ?');    params.push(matcherEnabled ? 1 : 0); }
    if (typeof fallbackEnabled === 'boolean') { updates.push('ia_fallback_enabled = ?');   params.push(fallbackEnabled ? 1 : 0); }
    if (Number.isInteger(takeoverWindowMin) && takeoverWindowMin >= 1 && takeoverWindowMin <= 1440) {
      updates.push('human_takeover_window_min = ?'); params.push(takeoverWindowMin);
    }
    if (!updates.length) return res.status(400).json({ error: 'nada para actualizar' });
    params.push(req.tenantId);
    db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    const row = db.prepare(`
      SELECT ia_hybrid_enabled, ia_matcher_enabled, ia_fallback_enabled, human_takeover_window_min
      FROM tenants WHERE id = ?
    `).get(req.tenantId);
    res.json(row);
  });

  // ─── Estado de una conversación (owner actual) ──────────────────
  router.get('/conversations/:id/state', (req, res) => {
    const convoId = Number(req.params.id);
    const convo = db.prepare(`
      SELECT id, tenant_id, ai_mode, last_human_msg_at, last_ai_msg_at, human_takeover_until
      FROM conversations WHERE id = ? AND tenant_id = ?
    `).get(convoId, req.tenantId);
    if (!convo) return res.status(404).json({ error: 'conversación no encontrada' });

    const tcfg = db.prepare('SELECT human_takeover_window_min FROM tenants WHERE id = ?').get(req.tenantId);
    const windowMin = tcfg?.human_takeover_window_min || 15;

    // Calcular owner actual
    const now = Math.floor(Date.now() / 1000);
    let owner = 'idle';
    let humanMinLeft = 0;

    if (convo.ai_mode === 'human_lock') {
      owner = 'human_lock';
    } else if (convo.human_takeover_until && convo.human_takeover_until > now) {
      owner = 'human_lock';
      humanMinLeft = Math.ceil((convo.human_takeover_until - now) / 60);
    } else if (convo.last_human_msg_at) {
      const sinceMin = (now - convo.last_human_msg_at) / 60;
      if (sinceMin < windowMin) {
        owner = 'human';
        humanMinLeft = Math.ceil(windowMin - sinceMin);
      }
    }

    // ¿Hay bot wait activo?
    const waits = db.prepare(`
      SELECT bot_id, wait_kind FROM bot_run_waits
      WHERE conversation_id = ? AND status = 'waiting'
      LIMIT 1
    `).get(convoId);

    if (owner === 'idle' && waits) {
      owner = 'bot_running';
    }

    res.json({
      owner,
      ai_mode:         convo.ai_mode || 'auto',
      humanMinLeft,
      lastHumanMsgAt:  convo.last_human_msg_at,
      lastAiMsgAt:     convo.last_ai_msg_at,
      humanTakeoverUntil: convo.human_takeover_until,
      activeBotWait:   waits || null,
    });
  });

  // ─── Cambiar ai_mode ────────────────────────────────────────────
  router.post('/conversations/:id/ai-mode', (req, res) => {
    const convoId = Number(req.params.id);
    const { mode } = req.body || {};
    if (!['auto', 'off', 'human_lock'].includes(mode)) {
      return res.status(400).json({ error: 'mode inválido (auto/off/human_lock)' });
    }
    // Validar pertenencia al tenant
    const convo = db.prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?').get(convoId, req.tenantId);
    if (!convo) return res.status(404).json({ error: 'conversación no encontrada' });
    svc.setAiMode(db, convoId, mode);
    res.json({ ok: true, mode });
  });

  // ─── Botón "Devolver a IA ahora" ────────────────────────────────
  router.post('/conversations/:id/give-back', (req, res) => {
    const convoId = Number(req.params.id);
    const convo = db.prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?').get(convoId, req.tenantId);
    if (!convo) return res.status(404).json({ error: 'conversación no encontrada' });
    svc.giveBackToAI(db, convoId);
    res.json({ ok: true });
  });

  // ─── Botón "Modo humano permanente" ─────────────────────────────
  router.post('/conversations/:id/take-over', (req, res) => {
    const convoId = Number(req.params.id);
    const { durationMin } = req.body || {};
    const convo = db.prepare('SELECT id FROM conversations WHERE id = ? AND tenant_id = ?').get(convoId, req.tenantId);
    if (!convo) return res.status(404).json({ error: 'conversación no encontrada' });
    if (durationMin && Number.isInteger(durationMin) && durationMin > 0) {
      const until = Math.floor(Date.now() / 1000) + durationMin * 60;
      db.prepare(`UPDATE conversations SET human_takeover_until = ?, ai_mode = 'auto' WHERE id = ?`)
        .run(until, convoId);
    } else {
      // Sin duración → lock permanente
      svc.setAiMode(db, convoId, 'human_lock');
      db.prepare(`UPDATE conversations SET human_takeover_until = NULL WHERE id = ?`).run(convoId);
    }
    res.json({ ok: true });
  });

  // ─── Telemetría reciente (debug) ────────────────────────────────
  router.get('/logs', (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const convoId = req.query.convoId ? Number(req.query.convoId) : null;
    let rows;
    if (convoId) {
      rows = db.prepare(`
        SELECT * FROM inbound_router_log
        WHERE tenant_id = ? AND conversation_id = ?
        ORDER BY id DESC LIMIT ?
      `).all(req.tenantId, convoId, limit);
    } else {
      rows = db.prepare(`
        SELECT * FROM inbound_router_log
        WHERE tenant_id = ?
        ORDER BY id DESC LIMIT ?
      `).all(req.tenantId, limit);
    }
    res.json({ items: rows });
  });

  return router;
};
