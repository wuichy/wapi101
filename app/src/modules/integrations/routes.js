const express = require('express');
const service = require('./service');

module.exports = function createIntegrationsRouter(db) {
  const router = express.Router();

  // ─── Comentarios de redes sociales (FB Page feed + IG comments) ───
  // GET /api/integrations/comments?status=unread|read|replied|archived&limit=100
  router.get('/comments', (req, res) => {
    try {
      const status = req.query.status || 'unread';
      const limit  = Math.min(Number(req.query.limit) || 100, 500);
      const contactId = req.query.contactId ? Number(req.query.contactId) : null;
      const VALID = ['unread', 'read', 'replied', 'archived', 'all'];
      if (!VALID.includes(status)) return res.status(400).json({ error: 'status inválido' });

      const conds  = ['c.tenant_id = ?'];
      const params = [req.tenantId];
      if (status !== 'all') { conds.push('c.status = ?'); params.push(status); }
      if (contactId)        { conds.push('c.contact_id = ?'); params.push(contactId); }
      params.push(limit);

      const rows = db.prepare(`
        SELECT c.id, c.integration_id, c.provider, c.post_id, c.comment_id, c.parent_comment_id,
               c.from_id, c.from_name, c.body, c.status, c.replied_at, c.replied_by_advisor,
               c.permalink_url, c.contact_id, c.created_at,
               ct.first_name AS contact_first_name, ct.last_name AS contact_last_name,
               ct.avatar_url AS contact_avatar_url
          FROM social_comments c
          LEFT JOIN contacts ct ON ct.id = c.contact_id AND ct.tenant_id = c.tenant_id
         WHERE ${conds.join(' AND ')}
         ORDER BY c.created_at DESC
         LIMIT ?
      `).all(...params);
      res.json({ items: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/integrations/comments/:id/reply  body={text}
  // Manda la respuesta a Meta Graph API y marca el comentario como 'replied'.
  router.post('/comments/:id/reply', async (req, res) => {
    try {
      const id   = Number(req.params.id);
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ error: 'text requerido' });
      if (text.length > 8000) return res.status(400).json({ error: 'text demasiado largo' });

      const comment = db.prepare(`
        SELECT c.*, i.credentials AS integ_credentials
          FROM social_comments c
          LEFT JOIN integrations i ON i.id = c.integration_id
         WHERE c.id = ? AND c.tenant_id = ?
      `).get(id, req.tenantId);
      if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

      const creds = (() => { try { return JSON.parse(comment.integ_credentials || '{}'); } catch { return {}; } })();
      const accessToken = creds.accessToken;
      if (!accessToken) return res.status(400).json({ error: 'La integración no tiene access token configurado' });

      // FB Page comment reply: POST /{comment-id}/comments
      // IG comment reply:      POST /{comment-id}/replies
      const endpoint = comment.provider === 'instagram'
        ? `https://graph.facebook.com/v18.0/${comment.comment_id}/replies`
        : `https://graph.facebook.com/v18.0/${comment.comment_id}/comments`;

      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    new URLSearchParams({ message: text, access_token: accessToken }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || data.error) {
        const msg = data?.error?.message || `HTTP ${r.status}`;
        console.error(`[reply ${comment.provider}] error:`, msg, data);
        return res.status(502).json({ error: `Meta: ${msg}` });
      }

      db.prepare(`
        UPDATE social_comments SET status = 'replied', replied_at = unixepoch(), replied_by_advisor = ?
         WHERE id = ?
      `).run(req.advisor?.id || null, id);

      res.json({ ok: true, replyId: data.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/integrations/comments/counts → counts por status (para badges)
  router.get('/comments/counts', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT status, COUNT(*) as n FROM social_comments WHERE tenant_id = ? GROUP BY status
      `).all(req.tenantId);
      const counts = { unread: 0, read: 0, replied: 0, archived: 0 };
      for (const r of rows) counts[r.status] = r.n;
      counts.total = rows.reduce((a, r) => a + r.n, 0);
      res.json(counts);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // PATCH /api/integrations/comments/:id  body={status}
  router.patch('/comments/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const status = req.body?.status;
      const VALID = ['unread', 'read', 'replied', 'archived'];
      if (!VALID.includes(status)) return res.status(400).json({ error: 'status inválido' });
      const r = db.prepare('UPDATE social_comments SET status = ? WHERE id = ? AND tenant_id = ?').run(status, id, req.tenantId);
      if (!r.changes) return res.status(404).json({ error: 'No encontrado' });
      res.json({ ok: true });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/', (req, res, next) => {
    try { res.json({ items: service.listAll(db, req.tenantId) }); }
    catch (err) { next(err); }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const item = service.getById(db, req.tenantId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrada' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.post('/:provider/connect', async (req, res, next) => {
    try {
      const item = await service.connect(db, req.tenantId, req.params.provider, req.body || {});
      res.status(201).json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/:id', async (req, res, next) => {
    try {
      const item = await service.update(db, req.tenantId, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/:id/qr-status', (req, res, next) => {
    try {
      const result = service.qrStatus(db, req.tenantId, Number(req.params.id));
      if (!result) return res.status(404).json({ error: 'No encontrada o no es QR' });
      res.json(result);
    } catch (err) { next(err); }
  });

  router.post('/:id/qr-restart', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT id, provider FROM integrations WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), req.tenantId);
      if (!row) return res.status(404).json({ error: 'No encontrada' });
      if (row.provider !== 'whatsapp-lite') return res.status(400).json({ error: 'Solo aplica para whatsapp-lite' });
      const manager = require('./whatsapp-web/manager');
      await manager.stopSession(row.id, { logout: false, removeAuth: true });
      db.prepare(`UPDATE integrations SET status = 'connecting', last_error = NULL, updated_at = unixepoch() WHERE id = ? AND tenant_id = ?`).run(row.id, req.tenantId);
      manager.startSession(row.id).catch(err => console.error(`[wa-web ${row.id}] restart falló:`, err.message));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  router.post('/:id/test', async (req, res, next) => {
    try {
      const result = await service.testExisting(db, req.tenantId, Number(req.params.id));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/:id/routing', (req, res, next) => {
    try {
      const item = service.updateRouting(db, req.tenantId, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/:id/telegram-webhook', async (req, res, next) => {
    try {
      const item = service.getById(db, req.tenantId, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrada' });
      if (item.provider !== 'telegram') return res.status(400).json({ error: 'Solo aplica para Telegram' });
      const { decryptJson } = require('../../security/crypto');
      const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ? AND tenant_id = ?').get(item.id, req.tenantId);
      const creds = row?.credentials_enc ? (decryptJson(row.credentials_enc) || {}) : {};
      const provider = require('./providers').get('telegram');
      const baseUrl = (process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
      const webhookUrl = `${baseUrl}/webhooks/telegram`;
      const result = await provider.setWebhook(creds.botToken, webhookUrl, creds.webhookSecret || '');
      res.json({ ok: result.ok, description: result.description, webhookUrl });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/:id', (req, res, next) => {
    try {
      const ok = service.disconnect(db, req.tenantId, Number(req.params.id));
      if (!ok) return res.status(404).json({ error: 'No encontrada' });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
