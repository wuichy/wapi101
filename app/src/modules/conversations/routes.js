const express = require('express');
const svc = require('./service');
const { sendMessage } = require('./sender');

module.exports = function createConversationsRouter(db) {
  const router = express.Router();

  // GET /api/conversations
  router.get('/', (req, res) => {
    const { q, provider, unread, page, pageSize, contactId } = req.query;
    const result = svc.list(db, {
      search:     q || '',
      provider:   provider || '',
      unreadOnly: unread === '1',
      contactId:  contactId ? Number(contactId) : null,
      page:       Number(page) || 1,
      pageSize:   Number(pageSize) || 50,
    });
    // Siempre incluir totales globales (sin filtro) para los badges
    result.totalAll    = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
    result.totalUnread = db.prepare('SELECT COUNT(*) AS n FROM conversations WHERE unread_count > 0').get().n;
    res.json(result);
  });

  // GET /api/conversations/:id
  router.get('/:id', (req, res) => {
    const convo = svc.getById(db, Number(req.params.id));
    if (!convo) return res.status(404).json({ error: 'No encontrado' });
    res.json(convo);
  });

  // GET /api/conversations/:id/messages
  router.get('/:id/messages', (req, res) => {
    const { page, pageSize } = req.query;
    const result = svc.listMessages(db, Number(req.params.id), {
      page:     Number(page) || 1,
      pageSize: Number(pageSize) || 60,
    });
    res.json(result);
  });

  // PATCH /api/conversations/:id/read
  router.patch('/:id/read', (req, res) => {
    svc.markRead(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // PATCH /api/conversations/:id/bot-paused
  router.patch('/:id/bot-paused', (req, res) => {
    const { paused } = req.body;
    svc.setBotPaused(db, Number(req.params.id), !!paused);
    res.json({ ok: true, paused: !!paused });
  });

  // POST /api/conversations/:id/messages — enviar mensaje saliente
  router.post('/:id/messages', async (req, res) => {
    const convoId = Number(req.params.id);
    const convo = svc.getById(db, convoId);
    if (!convo) return res.status(404).json({ error: 'Conversación no encontrada' });

    const { body } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });

    try {
      const externalMsgId = await sendMessage(db, convo, body.trim());

      const msg = svc.addMessage(db, convoId, {
        externalId: externalMsgId,
        direction:  'outgoing',
        provider:   convo.provider,
        body:       body.trim(),
        status:     'sent',
      });

      res.json(msg);
    } catch (err) {
      console.error('[conversations] error enviando mensaje:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
