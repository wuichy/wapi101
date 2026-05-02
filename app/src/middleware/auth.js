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
           a.id, a.name, a.username, a.email, a.role, a.permissions, a.active
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
    _viaMachineToken: true,
    _machineTokenId:   row.mt_id,
    _machineTokenName: row.mt_name,
  };
}

function authMiddleware(db) {
  return (req, res, next) => {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    if (token.startsWith('mt_')) {
      const advisor = authenticateMachineToken(db, token, clientIp(req));
      if (!advisor) return res.status(401).json({ error: 'Token de máquina inválido o revocado', code: 'UNAUTHENTICATED' });
      req.advisor = advisor;
      return next();
    }
    const advisor = getSession(db, token);
    if (!advisor) {
      return res.status(401).json({ error: 'No autenticado', code: 'UNAUTHENTICATED' });
    }
    req.advisor = advisor;
    next();
  };
}

module.exports = { authMiddleware, extractToken };
