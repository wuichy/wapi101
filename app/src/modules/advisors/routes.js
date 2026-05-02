const express = require('express');
const svc = require('./service');

module.exports = function createAdvisorsRouter(db) {
  const router = express.Router();

  // GET /api/advisors
  router.get('/', (req, res) => {
    if (req.advisor.role !== 'admin' && !req.advisor.permissions.manage_advisors) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    res.json(svc.list(db));
  });

  // POST /api/advisors
  router.post('/', (req, res) => {
    if (req.advisor.role !== 'admin') return res.status(403).json({ error: 'Solo admin puede crear asesores' });
    const { name, username, email, password, role, permissions } = req.body;
    if (!name?.trim() || !username?.trim() || !password) {
      return res.status(400).json({ error: 'Nombre, usuario y contraseña son requeridos' });
    }
    try {
      const created = svc.create(db, { name: name.trim(), username: username.trim(), email, password, role, permissions });
      res.status(201).json(created);
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario o email ya existe' });
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/advisors/:id
  router.patch('/:id', (req, res) => {
    const id = Number(req.params.id);
    const isSelf = req.advisor.id === id;
    if (req.advisor.role !== 'admin' && !isSelf) return res.status(403).json({ error: 'Sin permiso' });

    // Asesores no-admin no pueden cambiar su propio rol ni permisos
    const body = { ...req.body };
    if (req.advisor.role !== 'admin') { delete body.role; delete body.permissions; delete body.active; }

    try {
      const updated = svc.update(db, id, body);
      res.json(updated);
    } catch (err) {
      if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario o email ya existe' });
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/advisors/:id
  router.delete('/:id', (req, res) => {
    if (req.advisor.role !== 'admin') return res.status(403).json({ error: 'Solo admin puede eliminar asesores' });
    const id = Number(req.params.id);
    if (req.advisor.id === id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    svc.remove(db, id);
    res.json({ ok: true });
  });

  return router;
};
