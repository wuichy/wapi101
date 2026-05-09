'use strict';
const express = require('express');
const svc     = require('./service');

module.exports = function createAppointmentsRouter(db) {
  const router = express.Router();

  // GET /api/appointments?contactId=&status=&limit=&offset=
  router.get('/', (req, res) => {
    try {
      const { contactId, status, limit, offset } = req.query;
      const items = svc.list(db, req.tenantId, { contactId, status, limit, offset });
      res.json({ items });
    } catch (err) {
      console.error('[appointments] list error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/appointments/slots?date=YYYY-MM-DD&advisorId=X&duration=30
  router.get('/slots', (req, res) => {
    try {
      const { date, advisorId, duration } = req.query;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
        return res.status(400).json({ error: 'date requerido (YYYY-MM-DD)' });
      const slots = svc.getAvailableSlots(db, req.tenantId, date, advisorId || null, duration || 30);
      res.json({ slots });
    } catch (err) {
      console.error('[appointments] slots error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/appointments — creación manual (desde modal CRM)
  router.post('/', (req, res) => {
    try {
      const { contactId, expedientId, convoId, advisorId, date, time, durationMin, notes } = req.body;
      if (!contactId) return res.status(400).json({ error: 'contactId requerido' });
      if (!date || !time)  return res.status(400).json({ error: 'date y time requeridos' });
      const appt = svc.bookManual(db, req.tenantId, {
        contactId, expedientId, convoId, advisorId, date, time, durationMin, notes,
      });
      res.status(201).json({ item: appt });
    } catch (err) {
      console.error('[appointments] create error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/appointments/:id — actualizar status, notas, asesor
  router.patch('/:id', (req, res) => {
    try {
      const id      = Number(req.params.id);
      const { status, notes, advisorId } = req.body;
      const updated = svc.update(db, req.tenantId, id, { status, notes, advisorId });
      if (!updated) return res.status(404).json({ error: 'No encontrado' });
      res.json({ item: updated });
    } catch (err) {
      console.error('[appointments] update error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
