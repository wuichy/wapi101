const express = require('express');
const service = require('./service');

module.exports = function createIntegrationsRouter(db) {
  const router = express.Router();

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
