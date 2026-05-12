const express = require('express');
const router = express.Router();

module.exports = (db) => {
  // GET /api/apps — lista catálogo + estado de instalación para el tenant
  router.get('/', (req, res) => {
    const tenantId = req.tenantId;
    const apps = db.prepare(`
      SELECT a.*,
        CASE WHEN ai.id IS NOT NULL THEN 1 ELSE 0 END as installed,
        ai.enabled as install_enabled,
        ai.installed_at
      FROM marketplace_apps a
      LEFT JOIN app_installs ai ON ai.app_id = a.id AND ai.tenant_id = ?
      ORDER BY a.is_system DESC, a.name
    `).all(tenantId);
    res.json({ apps });
  });

  // POST /api/apps/:id/install — instalar app
  router.post('/:id/install', (req, res) => {
    const tenantId = req.tenantId;
    const appId = Number(req.params.id);
    const app = db.prepare('SELECT id FROM marketplace_apps WHERE id = ?').get(appId);
    if (!app) return res.status(404).json({ error: 'App no encontrada' });

    db.prepare(`
      INSERT OR IGNORE INTO app_installs (app_id, tenant_id, enabled) VALUES (?, ?, 1)
    `).run(appId, tenantId);
    res.json({ ok: true });
  });

  // DELETE /api/apps/:id/install — desinstalar app
  router.delete('/:id/install', (req, res) => {
    const tenantId = req.tenantId;
    const appId = Number(req.params.id);
    const app = db.prepare('SELECT is_system FROM marketplace_apps WHERE id = ?').get(appId);
    if (!app) return res.status(404).json({ error: 'App no encontrada' });
    db.prepare('DELETE FROM app_installs WHERE app_id = ? AND tenant_id = ?').run(appId, tenantId);
    res.json({ ok: true });
  });

  // PATCH /api/apps/:id/toggle — activar/pausar app
  router.patch('/:id/toggle', (req, res) => {
    const tenantId = req.tenantId;
    const appId = Number(req.params.id);
    const { enabled } = req.body;
    db.prepare('UPDATE app_installs SET enabled = ? WHERE app_id = ? AND tenant_id = ?')
      .run(enabled ? 1 : 0, appId, tenantId);
    res.json({ ok: true });
  });

  return router;
};
