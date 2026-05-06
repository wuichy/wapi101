// Endpoints del módulo Negocio (horarios)
//   GET  /api/business/hours                    horario maestro
//   PUT  /api/business/hours                    actualizar horario maestro (admin only)
//   GET  /api/business/advisors/:id/hours       horario efectivo de un asesor
//   PUT  /api/business/advisors/:id/hours       actualizar override del asesor (admin only)

const express = require('express');
const service = require('./service');

module.exports = function createBusinessRouter(db) {
  const router = express.Router();

  router.get('/hours', (req, res) => {
    try { res.json({ items: service.getMasterHours(db, req.tenantId) }); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.put('/hours', (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden editar el horario del negocio' });
    }
    try {
      const items = service.setMasterHours(db, req.tenantId, req.body?.hours || []);
      res.json({ items });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.get('/advisors/:id/hours', (req, res) => {
    try {
      // Cualquier advisor puede ver su propio horario; admin puede ver el de cualquiera
      const advisorId = Number(req.params.id);
      if (req.advisor?.role !== 'admin' && req.advisor?.id !== advisorId) {
        return res.status(403).json({ error: 'Solo puedes ver tu propio horario' });
      }
      res.json({ items: service.getAdvisorHours(db, req.tenantId, advisorId) });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.put('/advisors/:id/hours', (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden editar horarios de asesores' });
    }
    try {
      const advisorId = Number(req.params.id);
      const items = service.setAdvisorHours(db, req.tenantId, advisorId, req.body?.hours || []);
      res.json({ items });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
