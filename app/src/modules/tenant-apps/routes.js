// Tenant Apps — endpoints para que el CLIENTE FINAL (advisor) gestione las
// apps OAuth instaladas en SU tenant. Ver, desinstalar (revocar), etc.
//
// NOTA: solo accesible para auth normal de advisor (rh_token), NO para OAuth
// access tokens — las apps no pueden listar/revocarse a sí mismas.

'use strict';

const express = require('express');
const oauthSvc = require('../oauth/service');

module.exports = function createTenantAppsRouter(db) {
  const router = express.Router();

  // Bloquear acceso si la auth es vía OAuth — apps no pueden ver otras apps.
  router.use((req, res, next) => {
    if (req.appAuth) {
      return res.status(403).json({ error: 'Esta ruta no es accesible vía OAuth', code: 'OAUTH_FORBIDDEN' });
    }
    next();
  });

  // GET /api/tenant-apps — lista de apps instaladas en este tenant
  router.get('/', (req, res) => {
    try {
      const items = db.prepare(`
        SELECT i.id AS install_id, i.installed_at, i.scopes_granted,
               i.installed_by_advisor_id, ai.name AS installed_by_name,
               a.id AS app_id, a.name, a.slug, a.icon_url, a.short_description,
               a.homepage_url, a.privacy_policy_url, a.client_id, a.status,
               d.name AS dev_name, d.company AS dev_company
          FROM dev_app_installs i
          JOIN apps a ON a.id = i.app_id
          JOIN dev_accounts d ON d.id = a.dev_account_id
          LEFT JOIN advisors ai ON ai.id = i.installed_by_advisor_id
         WHERE i.tenant_id = ? AND i.revoked_at IS NULL
         ORDER BY i.installed_at DESC
      `).all(req.tenantId);
      const enriched = items.map(it => ({
        ...it,
        scopes_granted: _safeArr(it.scopes_granted),
      }));
      res.json({ items: enriched });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/tenant-apps/:installId — desinstalar (revocar tokens)
  router.delete('/:installId', (req, res) => {
    try {
      const installId = Number(req.params.installId);
      const install = db.prepare('SELECT id, tenant_id FROM dev_app_installs WHERE id = ?').get(installId);
      if (!install) return res.status(404).json({ error: 'Instalación no encontrada' });
      if (install.tenant_id !== req.tenantId) return res.status(403).json({ error: 'No autorizado' });
      oauthSvc.revokeInstall(db, installId, 'uninstalled_by_user');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};

function _safeArr(s) {
  try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; }
  catch { return []; }
}
