// Monitor: (1) consola de logs global del sistema, (2) sesiones web (visitantes
// de reelance.mx, con "en línea ahora" real vía last_seen_at). Admin-only.
const express = require('express');

module.exports = function createMonitorRouter(db) {
  const router = express.Router();

  // Todo el módulo es solo para administradores.
  router.use((req, res, next) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores', errorCode: 'ADMIN_ONLY' });
    }
    next();
  });

  // ─── GET /api/monitor/logs — feed unificado del sistema (tenant-scoped) ───
  router.get('/logs', (req, res, next) => {
    try {
      const tid = req.tenantId;
      const LIMIT = Math.min(Number(req.query.limit) || 150, 500);
      const events = [];

      // 1) Mensajes fallidos (errores de entrega)
      db.prepare(`
        SELECT m.error_reason, m.provider, m.created_at, c.contact_id
          FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.tenant_id = ? AND m.status = 'failed'
         ORDER BY m.created_at DESC LIMIT ?
      `).all(tid, LIMIT).forEach(m => events.push({
        at: m.created_at, kind: 'error', title: 'Mensaje falló',
        detail: (m.error_reason || 'sin motivo').slice(0, 140), meta: m.provider || '', contactId: m.contact_id || null,
      }));

      // 2) Decisiones del router / IA
      db.prepare(`
        SELECT decision, reason, bot_id, matcher_used, matcher_ms, created_at
          FROM inbound_router_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(tid, LIMIT).forEach(r => events.push({
        at: r.created_at, kind: 'router', title: 'Router: ' + r.decision,
        detail: (r.reason || ''), meta: `${r.bot_id ? 'bot #' + r.bot_id : ''}${r.matcher_used ? ' · IA' + (r.matcher_ms ? ' ' + r.matcher_ms + 'ms' : '') : ''}`,
      }));

      // 3) Alertas del sistema (desconexiones, notificaciones push, etc.)
      db.prepare(`
        SELECT kind, title, body, sent_count, failed, created_at
          FROM alert_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(tid, LIMIT).forEach(a => events.push({
        at: a.created_at, kind: a.failed ? 'error' : 'alert', title: a.title || a.kind || 'Alerta',
        detail: (a.body || '').slice(0, 140), meta: a.failed ? `${a.failed} fallo(s)` : (a.sent_count ? `${a.sent_count} enviada(s)` : ''),
      }));

      // 4) Actividad crítica del expediente (errores/cancelaciones de bots, cambios de pipeline)
      db.prepare(`
        SELECT type, description, created_at FROM expedient_activity
         WHERE tenant_id = ? AND type IN ('bot_error','bot_killed','pipeline_change')
         ORDER BY created_at DESC LIMIT ?
      `).all(tid, LIMIT).forEach(a => events.push({
        at: a.created_at, kind: a.type === 'bot_error' ? 'error' : 'activity',
        title: ({ bot_error: 'Bot con error', bot_killed: 'Bot cancelado', pipeline_change: 'Cambio de pipeline' })[a.type] || a.type,
        detail: (a.description || '').slice(0, 140), meta: '',
      }));

      events.sort((x, y) => (y.at || 0) - (x.at || 0));
      res.json({ events: events.slice(0, LIMIT) });
    } catch (e) { next(e); }
  });

  // ─── GET /api/monitor/web-sessions — visitantes de la web (con "en línea ahora") ───
  router.get('/web-sessions', (req, res, next) => {
    try {
      const LIMIT = Math.min(Number(req.query.limit) || 120, 500);
      const now = Math.floor(Date.now() / 1000);
      const rows = db.prepare(`
        SELECT session_id, utm_source, utm_medium, utm_campaign, referrer, landing_page,
               country, region, city, is_bot, created_at, last_seen_at
          FROM visitor_sessions
         WHERE COALESCE(is_bot, 0) = 0
         ORDER BY last_seen_at DESC LIMIT ?
      `).all(LIMIT).map(s => ({
        ...s,
        online: (now - (s.last_seen_at || 0)) < 120, // visto hace <2 min = probablemente navegando ahora
      }));
      const onlineNow = rows.filter(s => s.online).length;
      res.json({ onlineNow, sessions: rows });
    } catch (e) { next(e); }
  });

  return router;
};
