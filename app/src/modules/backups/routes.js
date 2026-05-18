const express = require('express');
const fs = require('fs');
const path = require('path');
const service = require('./service');

module.exports = function createBackupsRouter(db) {
  const router = express.Router();

  // GET /api/backups → lista los backups del tenant
  router.get('/', (req, res, next) => {
    try {
      const items = service.listTenantBackups(db, req.tenantId);
      const counts = {
        manual: items.filter(i => i.type === 'manual').length,
        monthly: items.filter(i => i.type === 'monthly').length,
      };
      res.json({
        items,
        limits: { manual: service.MAX_PER_TYPE, monthly: service.MAX_PER_TYPE },
        counts,
      });
    } catch (e) { next(e); }
  });

  // POST /api/backups → crea uno nuevo (manual)
  router.post('/', async (req, res, next) => {
    try {
      // Solo admin puede crear respaldos (acción crítica)
      if (req.advisor?.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden crear respaldos' });
      }
      const result = await service.createTenantBackup(db, req.tenantId, {
        type: 'manual',
        advisorId: req.advisor.id,
      });
      res.json({ item: result });
    } catch (e) {
      console.error('[backups] create error:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/backups/:id/download → descarga el archivo .gpg
  router.get('/:id/download', (req, res, next) => {
    try {
      if (req.advisor?.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden descargar respaldos' });
      }
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const found = service.getBackupPath(db, req.tenantId, id);
      if (!found) return res.status(404).json({ error: 'Respaldo no encontrado' });
      res.setHeader('Content-Type', 'application/octet-stream');
      // Sanitiza filename para Content-Disposition (no comillas dobles, no \r\n)
      const safeName = String(found.filename).replace(/["\r\n\\]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      const stream = fs.createReadStream(found.path);
      stream.on('error', (err) => {
        console.error('[backups] download stream error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Error leyendo archivo' });
        else res.destroy(err);
      });
      stream.pipe(res);
    } catch (e) { next(e); }
  });

  // DELETE /api/backups/:id
  router.delete('/:id', (req, res, next) => {
    try {
      if (req.advisor?.role !== 'admin') {
        return res.status(403).json({ error: 'Solo administradores pueden eliminar respaldos' });
      }
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID inválido' });
      }
      const ok = service.deleteTenantBackup(db, req.tenantId, id);
      if (!ok) return res.status(404).json({ error: 'Respaldo no encontrado' });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return router;
};
