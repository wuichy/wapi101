const express = require('express');

module.exports = function createStatsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const t = req.tenantId;
    const todayExpr = `date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime')`;
    const weekExpr  = `created_at >= strftime('%s', 'now', 'localtime', 'weekday 0', '-6 days')`;

    // Messages
    const msgTotal    = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ?`).get(t).n;
    const msgSent     = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outgoing'`).get(t).n;
    const msgReceived = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'incoming'`).get(t).n;
    const msgSentToday     = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outgoing' AND ${todayExpr}`).get(t).n;
    const msgReceivedToday = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'incoming' AND ${todayExpr}`).get(t).n;
    const msgSentWeek      = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outgoing' AND ${weekExpr}`).get(t).n;
    const msgReceivedWeek  = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'incoming' AND ${weekExpr}`).get(t).n;

    const dailyRows = db.prepare(`
      SELECT
        date(created_at, 'unixepoch', 'localtime') AS day,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS received
      FROM messages
      WHERE tenant_id = ?
        AND created_at >= strftime('%s', 'now', 'localtime', '-6 days', 'start of day')
      GROUP BY day
      ORDER BY day ASC
    `).all(t);

    const convoTotal  = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ?`).get(t).n;
    const convoUnread = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND unread_count > 0`).get(t).n;
    const convoToday  = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE tenant_id = ? AND ${todayExpr.replace('created_at', 'last_message_at')}`).get(t).n;

    const contactTotal = db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ?`).get(t).n;
    const contactToday = db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE tenant_id = ? AND ${todayExpr}`).get(t).n;

    const expTotal = db.prepare(`SELECT COUNT(*) AS n FROM expedients WHERE tenant_id = ?`).get(t).n;

    res.json({
      messages: {
        total: msgTotal,
        sent: msgSent,
        received: msgReceived,
        sentToday: msgSentToday,
        receivedToday: msgReceivedToday,
        sentWeek: msgSentWeek,
        receivedWeek: msgReceivedWeek,
      },
      daily: dailyRows,
      conversations: {
        total: convoTotal,
        unread: convoUnread,
        activeToday: convoToday,
      },
      contacts: {
        total: contactTotal,
        newToday: contactToday,
      },
      expedients: {
        total: expTotal,
      },
    });
  });

  return router;
};
