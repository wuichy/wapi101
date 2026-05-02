const express = require('express');
const service = require('./service');

module.exports = function createIntegrationsRouter(db) {
  const router = express.Router();

  // Catálogo + estado de cada integración
  router.get('/', (_req, res, next) => {
    try { res.json({ items: service.listAll(db) }); }
    catch (err) { next(err); }
  });

  router.get('/:id', (req, res, next) => {
    try {
      const item = service.getById(db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrada' });
      res.json({ item });
    } catch (err) { next(err); }
  });

  // Conectar nueva integración
  router.post('/:provider/connect', async (req, res, next) => {
    try {
      const item = await service.connect(db, req.params.provider, req.body || {});
      res.status(201).json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Actualizar credenciales (parcial)
  router.patch('/:id', async (req, res, next) => {
    try {
      const item = await service.update(db, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Estado de QR (para flujo whatsapp-lite). Frontend lo polea cada ~1.5s.
  router.get('/:id/qr-status', (req, res, next) => {
    try {
      const result = service.qrStatus(db, Number(req.params.id));
      if (!result) return res.status(404).json({ error: 'No encontrada o no es QR' });
      res.json(result);
    } catch (err) { next(err); }
  });

  // Forzar regeneración de QR (ej: usuario quiere uno nuevo o expiró)
  router.post('/:id/qr-restart', async (req, res, next) => {
    try {
      const row = db.prepare('SELECT id, provider FROM integrations WHERE id = ?').get(Number(req.params.id));
      if (!row) return res.status(404).json({ error: 'No encontrada' });
      if (row.provider !== 'whatsapp-lite') return res.status(400).json({ error: 'Solo aplica para whatsapp-lite' });
      const manager = require('./whatsapp-web/manager');
      await manager.stopSession(row.id, { logout: false, removeAuth: true });
      db.prepare(`UPDATE integrations SET status = 'connecting', last_error = NULL, updated_at = unixepoch() WHERE id = ?`).run(row.id);
      manager.startSession(row.id).catch(err => console.error(`[wa-web ${row.id}] restart falló:`, err.message));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Probar conexión actual
  router.post('/:id/test', async (req, res, next) => {
    try {
      const result = await service.testExisting(db, Number(req.params.id));
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Guardar selección de pipeline/etapa de enrutamiento
  router.patch('/:id/routing', (req, res, next) => {
    try {
      const item = service.updateRouting(db, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // Re-registrar webhook de Telegram (útil cuando cambia APP_BASE_URL)
  router.post('/:id/telegram-webhook', async (req, res, next) => {
    try {
      const item = service.getById(db, Number(req.params.id));
      if (!item) return res.status(404).json({ error: 'No encontrada' });
      if (item.provider !== 'telegram') return res.status(400).json({ error: 'Solo aplica para Telegram' });
      const { decryptJson } = require('../security/crypto');
      const row = db.prepare('SELECT credentials_enc FROM integrations WHERE id = ?').get(item.id);
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
      const ok = service.disconnect(db, Number(req.params.id));
      if (!ok) return res.status(404).json({ error: 'No encontrada' });
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
};
