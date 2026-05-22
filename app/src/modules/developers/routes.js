// Developers Platform — REST API
// ============================================================================
// Endpoints para el portal de developers:
//   - /api/dev/signup, /login, /logout, /me
//   - /api/dev/apps     (CRUD apps del dev autenticado)
//   - /api/dev/apps/:id/secret/regenerate
//   - /api/dev/apps/:id/submit       (enviar a review)
//   - /api/dev/apps/:id/installs     (instalaciones de esta app)
//   - /api/dev/apps/:id/audit        (logs de uso)
//   - /api/dev/scopes                (catálogo)
//   - /api/dev/webhook-events        (catálogo)

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const service = require('./service');

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function devAuth(db) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token || !token.startsWith('dev_')) {
      return res.status(401).json({ error: 'No autenticado', code: 'DEV_UNAUTHENTICATED' });
    }
    const acc = service.getSession(db, token);
    if (!acc) return res.status(401).json({ error: 'Sesión inválida', code: 'DEV_UNAUTHENTICATED' });
    req.devAccount = acc;
    next();
  };
}

module.exports = function createDevelopersRouter(db) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // Rate limit en signup/login — anti spam
  const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1h
    max: 5,
    message: { error: 'Demasiados intentos. Intenta más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 10,
    message: { error: 'Demasiados intentos. Intenta más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ─── Auth ────────────────────────────────────────────────────────────────
  router.post('/signup', signupLimiter, (req, res) => {
    try {
      const { email, password, name, company, country } = req.body || {};
      const acc = service.createAccount(db, { email, password, name, company, country });
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      const { token, expiresAt } = service.createSession(db, acc.id, ip, req.headers['user-agent']);
      res.status(201).json({ account: acc, token, expiresAt });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/login', loginLimiter, (req, res) => {
    try {
      const { email, password } = req.body || {};
      const r = service.login(db, email, password);
      if (r.error === 'INVALID_CREDS')   return res.status(401).json({ error: 'Email o password incorrectos' });
      if (r.error === 'ACCOUNT_DISABLED') return res.status(403).json({ error: 'Cuenta deshabilitada' });
      if (r.error)                        return res.status(400).json({ error: r.error });
      const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
      const { token, expiresAt } = service.createSession(db, r.account.id, ip, req.headers['user-agent']);
      res.json({ account: r.account, token, expiresAt });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/logout', (req, res) => {
    const token = extractToken(req);
    if (token) service.deleteSession(db, token);
    res.json({ ok: true });
  });

  router.get('/me', devAuth(db), (req, res) => {
    res.json({ account: req.devAccount });
  });

  // ─── Catálogos públicos ─────────────────────────────────────────────────
  router.get('/scopes', (req, res) => {
    res.json({ scopes: service.AVAILABLE_SCOPES });
  });
  router.get('/webhook-events', (req, res) => {
    res.json({ events: service.AVAILABLE_WEBHOOK_EVENTS });
  });

  // ─── Apps CRUD (requieren auth) ─────────────────────────────────────────
  router.get('/apps', devAuth(db), (req, res) => {
    try {
      res.json({ items: service.listApps(db, req.devAccount.id) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  router.post('/apps', devAuth(db), (req, res) => {
    try {
      const app = service.createApp(db, req.devAccount.id, req.body || {});
      res.status(201).json({ app });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/apps/:id', devAuth(db), (req, res) => {
    const app = service.getAppById(db, Number(req.params.id), req.devAccount.id);
    if (!app) return res.status(404).json({ error: 'App no encontrada' });
    res.json({ app });
  });

  router.patch('/apps/:id', devAuth(db), (req, res) => {
    try {
      const app = service.updateApp(db, Number(req.params.id), req.devAccount.id, req.body || {});
      res.json({ app });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/apps/:id', devAuth(db), (req, res) => {
    const ok = service.deleteApp(db, Number(req.params.id), req.devAccount.id);
    if (!ok) return res.status(404).json({ error: 'App no encontrada' });
    res.json({ ok: true });
  });

  router.post('/apps/:id/secret/regenerate', devAuth(db), (req, res) => {
    try {
      const r = service.regenerateSecret(db, Number(req.params.id), req.devAccount.id);
      res.json(r);
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/apps/:id/submit', devAuth(db), (req, res) => {
    try {
      const app = service.submitForReview(db, Number(req.params.id), req.devAccount.id);
      res.json({ app });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/apps/:id/installs', devAuth(db), (req, res) => {
    const items = service.listInstallsForApp(db, Number(req.params.id), req.devAccount.id);
    res.json({ items });
  });

  router.get('/apps/:id/audit', devAuth(db), (req, res) => {
    const items = service.listAuditLog(db, Number(req.params.id), req.devAccount.id, Number(req.query.limit) || 100);
    res.json({ items });
  });

  return router;
};
