const crypto = require('crypto');
const { getSession } = require('../modules/advisors/service');

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip || null;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

// Si el token es un mt_ machine token, valida contra machine_tokens y popula req.advisor
// heredando el role/permissions del advisor que lo creó. Devuelve advisor o null.
function authenticateMachineToken(db, token, ip) {
  const hash = sha256Hex(token);
  const row = db.prepare(`
    SELECT mt.id AS mt_id, mt.name AS mt_name, mt.revoked_at, mt.created_by,
           a.id, a.name, a.username, a.email, a.role, a.permissions, a.active, a.tenant_id
      FROM machine_tokens mt
      LEFT JOIN advisors a ON a.id = mt.created_by
     WHERE mt.token_hash = ?
  `).get(hash);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (!row.id || row.active === 0) return null;
  db.prepare('UPDATE machine_tokens SET last_used_at = unixepoch(), last_used_ip = ? WHERE id = ?')
    .run(ip || null, row.mt_id);
  return {
    id:          row.id,
    name:        row.name,
    username:    row.username,
    email:       row.email,
    role:        row.role,
    permissions: JSON.parse(row.permissions || '{}'),
    tenantId:    row.tenant_id,
    _viaMachineToken: true,
    _machineTokenId:   row.mt_id,
    _machineTokenName: row.mt_name,
  };
}

// Resuelve el row del tenant a partir del id. Cachea por proceso unos segundos
// para no leer en cada request — los datos del tenant cambian poco.
const _tenantCache = new Map(); // id -> { row, fetchedAt }
const TENANT_CACHE_TTL_MS = 30_000;
function loadTenant(db, tenantId) {
  if (!tenantId) return null;
  const now = Date.now();
  const cached = _tenantCache.get(tenantId);
  if (cached && (now - cached.fetchedAt) < TENANT_CACHE_TTL_MS) return cached.row;
  const row = db.prepare('SELECT id, slug, display_name, status, plan FROM tenants WHERE id = ?').get(tenantId);
  _tenantCache.set(tenantId, { row, fetchedAt: now });
  return row;
}
// Permitir invalidar el cache desde el módulo de admin cuando se modifica un tenant.
function invalidateTenantCache(tenantId) {
  if (tenantId == null) _tenantCache.clear();
  else _tenantCache.delete(tenantId);
}

function authMiddleware(db) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    let advisor;
    if (token.startsWith('mt_')) {
      advisor = authenticateMachineToken(db, token, clientIp(req));
      if (!advisor) return res.status(401).json({ error: 'Token de máquina inválido o revocado', code: 'UNAUTHENTICATED' });
    } else {
      advisor = getSession(db, token);
      if (!advisor) return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    // Cargar tenant y verificar que esté activo. Si está suspendido o cancelado,
    // se rechaza el request (excepto endpoints del super-admin, que se monten
    // antes de este middleware).
    const tenant = loadTenant(db, advisor.tenantId);
    if (!tenant) {
      return res.status(403).json({ error: 'Tenant inexistente', code: 'TENANT_NOT_FOUND' });
    }
    if (tenant.status === 'suspended') {
      return res.status(403).json({ error: 'Cuenta suspendida — contacta soporte', code: 'TENANT_SUSPENDED' });
    }
    if (tenant.status === 'cancelled') {
      return res.status(403).json({ error: 'Cuenta cancelada', code: 'TENANT_CANCELLED' });
    }
    req.advisor  = advisor;
    req.tenantId = tenant.id;
    req.tenant   = tenant;
    next();
  };
}

module.exports = { authMiddleware, extractToken, loadTenant, invalidateTenantCache };
