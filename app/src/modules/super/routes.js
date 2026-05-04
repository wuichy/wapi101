// Rutas del super-admin panel. Se montan en /super (NO en /api) y NO atraviesan
// el authMiddleware multi-tenant. Tienen su propio middleware basado en tokens
// con prefijo "sa_".

const express = require('express');
const service = require('./service');

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || null;
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

// Middleware: solo deja pasar si hay un sa_token válido.
function superAuth(db) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token || !token.startsWith('sa_')) {
      return res.status(401).json({ error: 'No autenticado como super-admin', code: 'SUPER_UNAUTHENTICATED' });
    }
    const sa = service.getSession(db, token);
    if (!sa) return res.status(401).json({ error: 'Sesión inválida o expirada', code: 'SUPER_UNAUTHENTICATED' });
    req.superAdmin = sa;
    next();
  };
}

module.exports = function createSuperRouter(db) {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  // ─── Login (público) ───
  router.post('/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    const sa = service.login(db, username.trim(), password);
    if (!sa) return res.status(401).json({ error: 'Credenciales inválidas' });
    const token = service.createSession(db, sa.id, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || null,
    });
    res.json({
      token,
      superAdmin: { id: sa.id, username: sa.username, name: sa.name, email: sa.email },
    });
  });

  router.post('/logout', (req, res) => {
    const token = extractToken(req);
    if (token) service.deleteSession(db, token);
    res.json({ ok: true });
  });

  // ─── Endpoints protegidos ───
  router.use(superAuth(db));

  router.get('/me', (req, res) => {
    res.json({ superAdmin: req.superAdmin });
  });

  router.get('/tenants', (_req, res) => {
    res.json({ items: service.listTenants(db) });
  });

  router.get('/tenants/:id', (req, res) => {
    const t = service.getTenant(db, Number(req.params.id));
    if (!t) return res.status(404).json({ error: 'No encontrado' });
    res.json({ item: t });
  });

  router.post('/tenants', (req, res) => {
    try {
      const result = service.createTenant(db, req.body || {});
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/tenants/:id', (req, res) => {
    try {
      const item = service.updateTenant(db, Number(req.params.id), req.body || {});
      res.json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Soft delete = status 'cancelled'. No borra datos.
  router.delete('/tenants/:id', (req, res) => {
    try {
      const item = service.cancelTenant(db, Number(req.params.id));
      res.json({ item });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Impersonate: devuelve un token de advisor del tenant destino para que el
  // super-admin lo use en /api con el comportamiento normal.
  router.post('/tenants/:id/impersonate', (req, res) => {
    try {
      const result = service.impersonate(db, Number(req.params.id), req.superAdmin.id);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
};
