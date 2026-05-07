// Endpoints del módulo Negocio (horarios)
//   GET  /api/business/hours                    horario maestro
//   PUT  /api/business/hours                    actualizar horario maestro (admin only)
//   GET  /api/business/advisors/:id/hours       horario efectivo de un asesor
//   PUT  /api/business/advisors/:id/hours       actualizar override del asesor (admin only)
//   POST /api/business/logo                     subir logo del negocio (imagen)

const path = require('path');
const fs   = require('fs');
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

  // ─── Logo del negocio ───
  router.post('/logo', (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden cambiar el logo' });
    }
    try {
      const { data, mimetype } = req.body || {};
      if (!data || !mimetype) return res.status(400).json({ error: 'data y mimetype requeridos' });
      const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
      if (!allowed.includes(mimetype)) return res.status(400).json({ error: 'Formato no permitido. Usa PNG, JPG, SVG o WebP.' });

      const cleanB64 = String(data).replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanB64, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'Archivo vacío' });
      if (buffer.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'El logo no puede superar 2 MB' });

      const uploadsDir = path.resolve(process.env.UPLOADS_DIR || './data/uploads');
      const logosDir = path.join(uploadsDir, 'business-logos');
      if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true });

      const ext = mimetype === 'image/svg+xml' ? 'svg' : mimetype.split('/')[1];
      const filename = `tenant${req.tenantId}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(logosDir, filename), buffer);
      const logoUrl = `/uploads/business-logos/${filename}`;

      const profile = service.setProfile(db, req.tenantId, { logoUrl });
      res.json({ logoUrl, profile });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  // ─── Perfil del negocio ───
  router.get('/profile', (req, res) => {
    try {
      const profile = service.getProfile(db, req.tenantId);
      if (!profile) return res.status(404).json({ error: 'Tenant no encontrado' });
      res.json({ profile });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.put('/profile', (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo administradores pueden editar el perfil del negocio' });
    }
    try {
      const profile = service.setProfile(db, req.tenantId, req.body || {});
      res.json({ profile });
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  return router;
};
