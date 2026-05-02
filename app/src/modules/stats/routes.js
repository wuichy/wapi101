const express = require('express');

module.exports = function createStatsRouter(db) {
  const router = express.Router();

  router.get('/', (_req, res) => {
    const todayExpr = `date(created_at, 'unixepoch', 'localtime') = date('now', 'localtime')`;
    const weekExpr  = `created_at >= strftime('%s', 'now', 'localtime', 'weekday 0', '-6 days')`;

    // Messages
    const msgTotal    = db.prepare(`SELECT COUNT(*) AS n FROM messages`).get().n;
    const msgSent     = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'outgoing'`).get().n;
    const msgReceived = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'incoming'`).get().n;
    const msgSentToday     = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'outgoing' AND ${todayExpr}`).get().n;
    const msgReceivedToday = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'incoming' AND ${todayExpr}`).get().n;
    const msgSentWeek      = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'outgoing' AND ${weekExpr}`).get().n;
    const msgReceivedWeek  = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE direction = 'incoming' AND ${weekExpr}`).get().n;

    // Daily breakdown for the last 7 days (for sparkline)
    const dailyRows = db.prepare(`
      SELECT
        date(created_at, 'unixepoch', 'localtime') AS day,
        SUM(CASE WHEN direction = 'outgoing' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END) AS received
      FROM messages
      WHERE created_at >= strftime('%s', 'now', 'localtime', '-6 days', 'start of day')
      GROUP BY day
      ORDER BY day ASC
    `).all();

    // Conversations
    const convoTotal  = db.prepare(`SELECT COUNT(*) AS n FROM conversations`).get().n;
    const convoUnread = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE unread_count > 0`).get().n;
    const convoToday  = db.prepare(`SELECT COUNT(*) AS n FROM conversations WHERE ${todayExpr.replace('created_at', 'last_message_at')}`).get().n;

    // Contacts
    const contactTotal = db.prepare(`SELECT COUNT(*) AS n FROM contacts`).get().n;
    const contactToday = db.prepare(`SELECT COUNT(*) AS n FROM contacts WHERE ${todayExpr}`).get().n;

    // Expedients
    const expTotal = db.prepare(`SELECT COUNT(*) AS n FROM expedients`).get().n;

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
