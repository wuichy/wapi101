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

  // ─── Mail config (SMTP / Resend) ────────────────────────────────────────
  router.get('/mail-config', (req, res) => {
    const cfg = service.getMailConfig(db) || {};
    // Nunca devolver contraseñas en claro
    const safe = { ...cfg };
    if (safe.smtpPass)    safe.smtpPass    = safe.smtpPass    ? '••••••••' : '';
    if (safe.resendApiKey) safe.resendApiKey = safe.resendApiKey ? '••••••••' : '';
    res.json({ config: safe });
  });

  router.put('/mail-config', (req, res) => {
    const body = req.body || {};
    // Leer config actual para no pisar contraseñas con "••••••••"
    const current = service.getMailConfig(db) || {};
    const cfg = {
      provider:    body.provider    || current.provider    || 'resend',
      fromName:    body.fromName    || current.fromName    || 'Wapi101',
      fromEmail:   body.fromEmail   || current.fromEmail   || '',
      adminEmail:  body.adminEmail  || current.adminEmail  || '',
      // Resend
      resendApiKey: body.resendApiKey && !body.resendApiKey.startsWith('••')
        ? body.resendApiKey
        : (current.resendApiKey || ''),
      // SMTP
      smtpHost:    body.smtpHost    ?? current.smtpHost    ?? '',
      smtpPort:    Number(body.smtpPort    || current.smtpPort    || 587),
      smtpSecure:  body.smtpSecure  ?? current.smtpSecure  ?? false,
      smtpUser:    body.smtpUser    ?? current.smtpUser    ?? '',
      smtpPass:    body.smtpPass && !body.smtpPass.startsWith('••')
        ? body.smtpPass
        : (current.smtpPass || ''),
    };
    try {
      service.saveMailConfig(db, cfg);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/mail-test', async (req, res) => {
    const cfg = service.getMailConfig(db);
    const to  = req.body?.to || cfg?.adminEmail || req.superAdmin?.email;
    if (!to) return res.status(400).json({ error: 'No hay destinatario. Guarda un adminEmail primero.' });
    try {
      const mailer = require('../mailer/transactional');
      const result = await mailer.sendTestEmail({ to }, cfg || undefined);
      res.json({ ok: true, to, messageId: result?.id });
    } catch (err) {
      console.error('[super/mail-test]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Reportes (cross-tenant) ────────────────────────────────────────────
  // Lista todos los reportes que clientes han creado, con info del tenant.
  // Filtros opcionales por status, type, tenantId.
  router.get('/reports', (req, res) => {
    try {
      const { status, type, tenantId } = req.query || {};
      const conditions = [];
      const params = [];
      if (status)   { conditions.push('r.status = ?'); params.push(status); }
      if (type)     { conditions.push('r.type = ?');   params.push(type); }
      if (tenantId) { conditions.push('r.tenant_id = ?'); params.push(Number(tenantId)); }
      const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
      const rows = db.prepare(`
        SELECT r.*, t.slug AS tenant_slug, t.display_name AS tenant_name
          FROM reports r
          LEFT JOIN tenants t ON t.id = r.tenant_id
          ${where}
          ORDER BY r.created_at DESC
          LIMIT 500
      `).all(...params);
      res.json({ items: rows.map(_hydrateReport) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/reports/:id', (req, res) => {
    try {
      const row = db.prepare(`
        SELECT r.*, t.slug AS tenant_slug, t.display_name AS tenant_name
          FROM reports r
          LEFT JOIN tenants t ON t.id = r.tenant_id
         WHERE r.id = ?
      `).get(Number(req.params.id));
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item: _hydrateReport(row) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/reports/:id', (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = db.prepare('SELECT id FROM reports WHERE id = ?').get(id);
      if (!existing) return res.status(404).json({ error: 'No encontrado' });
      const { status, adminResponse, eta } = req.body || {};
      const fields = [];
      const params = [];
      if (status && ['open', 'in_progress', 'resolved', 'wontfix'].includes(status)) {
        fields.push('status = ?'); params.push(status);
        if (status === 'resolved' || status === 'wontfix') {
          fields.push('resolved_at = unixepoch()');
        } else {
          fields.push('resolved_at = NULL');
        }
      }
      if (adminResponse !== undefined) {
        // Si trae eta, lo prependeamos en el response como prefijo legible.
        const text = (typeof adminResponse === 'string') ? adminResponse.trim() : '';
        const finalText = eta && text
          ? `[ETA: ${String(eta).trim()}] ${text}`
          : (eta ? `[ETA: ${String(eta).trim()}]` : (text || null));
        fields.push('admin_response = ?'); params.push(finalText);
      }
      if (!fields.length) return res.status(400).json({ error: 'Sin cambios' });
      params.push(id);
      db.prepare(`UPDATE reports SET ${fields.join(', ')} WHERE id = ?`).run(...params);
      const row = db.prepare(`
        SELECT r.*, t.slug AS tenant_slug, t.display_name AS tenant_name
          FROM reports r
          LEFT JOIN tenants t ON t.id = r.tenant_id
         WHERE r.id = ?
      `).get(id);
      res.json({ item: _hydrateReport(row) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

function _hydrateReport(row) {
  if (!row) return null;
  let attachments = [];
  try { attachments = JSON.parse(row.attachments || '[]'); } catch {}
  return {
    id:            row.id,
    tenantId:      row.tenant_id,
    tenantSlug:    row.tenant_slug || null,
    tenantName:    row.tenant_name || null,
    advisorId:     row.advisor_id,
    advisorName:   row.advisor_name,
    type:          row.type,
    priority:      row.priority,
    title:         row.title,
    body:          row.body,
    attachments,
    status:        row.status,
    adminResponse: row.admin_response,
    createdAt:     row.created_at,
    resolvedAt:    row.resolved_at,
  };
}
