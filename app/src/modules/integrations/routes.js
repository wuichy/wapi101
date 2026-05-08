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
      const VALID = ['unread', 'read', 'replied', 'archived', 'all'];
      if (!VALID.includes(status)) return res.status(400).json({ error: 'status inválido' });

      const conds  = ['tenant_id = ?'];
      const params = [req.tenantId];
      if (status !== 'all') { conds.push('status = ?'); params.push(status); }
      params.push(limit);

      const rows = db.prepare(`
        SELECT id, integration_id, provider, post_id, comment_id, parent_comment_id,
               from_id, from_name, body, status, replied_at, replied_by_advisor, created_at
          FROM social_comments
         WHERE ${conds.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT ?
      `).all(...params);
      res.json({ items: rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
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
