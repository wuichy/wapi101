const express = require('express');
const crypto = require('crypto');

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

module.exports = function machineTokensRoutes(db) {
  const router = express.Router();

  // Solo admins reales (cookie de sesión). Tokens de máquina no pueden gestionar tokens.
  router.use((req, res, next) => {
    if (req.advisor?._viaMachineToken) {
      return res.status(403).json({ error: 'Los tokens de máquina no pueden gestionar tokens' });
    }
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores' });
    }
    next();
  });

  router.get('/', (_req, res) => {
    const items = db.prepare(`
      SELECT id, name, prefix, created_at, created_by, last_used_at, last_used_ip, revoked_at
        FROM machine_tokens
       ORDER BY (revoked_at IS NULL) DESC, COALESCE(last_used_at, 0) DESC, id DESC
    `).all();
    res.json({ items });
  });

  router.post('/', (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    if (name.length > 80) return res.status(400).json({ error: 'Nombre demasiado largo (máx 80)' });

    const plain = 'mt_' + crypto.randomBytes(16).toString('hex');
    const tokenHash = sha256Hex(plain);
    const prefix = plain.slice(0, 8);

    const r = db.prepare(`
      INSERT INTO machine_tokens (name, token_hash, prefix, created_by)
      VALUES (?, ?, ?, ?)
    `).run(name, tokenHash, prefix, req.advisor?.id || null);

    res.json({ id: r.lastInsertRowid, name, prefix, token: plain });
  });

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = db.prepare('SELECT id, revoked_at FROM machine_tokens WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Token no encontrado' });
    if (row.revoked_at) return res.json({ ok: true, alreadyRevoked: true });
    db.prepare('UPDATE machine_tokens SET revoked_at = unixepoch() WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  router.post('/revoke-all', (_req, res) => {
    const r = db.prepare('UPDATE machine_tokens SET revoked_at = unixepoch() WHERE revoked_at IS NULL').run();
    res.json({ ok: true, revoked: r.changes });
  });

  return router;
};
