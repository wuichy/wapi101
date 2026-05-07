const express = require('express');
const svc = require('./service');

module.exports = function createAdvisorsRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    if (req.advisor.role !== 'admin' && !req.advisor.permissions.manage_advisors) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    res.json(svc.list(db, req.tenantId));
  });

  // Lista mínima de asesores (id + nombre) accesible a cualquier asesor autenticado.
  // Útil para selectores como "Asignar lead a..." que no necesitan datos sensibles.
  router.get('/list-min', (req, res) => {
    const items = db.prepare(`
      SELECT id, name, username, role
        FROM advisors
       WHERE tenant_id = ? AND active = 1
       ORDER BY name COLLATE NOCASE ASC
    `).all(req.tenantId);
    res.json({ items });
  });

  router.post('/', (req, res) => {
    if (req.advisor.role !== 'admin') return res.status(403).json({ error: 'Solo admin puede crear asesores' });
    const { name, username, email, password, role, permissions } = req.body;
    if (!name?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: 'Nombre, usuario y contraseña son requeridos' });
    }
    try {
      const limitErr = require('../billing/limits').checkLimit(db, req.tenantId, req.tenant?.plan, 'users', req.tenant?.extra_users);
      if (limitErr) return res.status(402).json({ error: limitErr, limitExceeded: 'users' });
      const created = svc.create(db, req.tenantId, { name: name.trim(), username: username.trim(), email, password, role, permissions });
      res.status(201).json(created);
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario o email ya existe' });
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const isSelf = req.advisor.id === id;
    if (req.advisor.role !== 'admin' && !isSelf) return res.status(403).json({ error: 'Sin permiso' });

    const body = { ...req.body };
    if (req.advisor.role !== 'admin') { delete body.role; delete body.permissions; delete body.active; }

    try {
      const updated = svc.update(db, req.tenantId, id, body);
      res.json(updated);
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario o email ya existe' });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', (req, res) => {
    if (req.advisor.role !== 'admin') return res.status(403).json({ error: 'Solo admin puede eliminar asesores' });
    const id = Number(req.params.id);
    if (req.advisor.id === id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    svc.remove(db, req.tenantId, id);
    res.json({ ok: true });
  });

  return router;
};
