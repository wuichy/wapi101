// WhatsApp Catalog REST routes
//
// Endpoints:
//   GET    /api/catalog/status           — feature flag + catálogo + último sync
//   POST   /api/catalog/auto-detect      — corre detección en Meta (smart-default)
//   PATCH  /api/catalog/settings         — { enabled: true|false } actualizar flag
//   POST   /api/catalog/sync             — disparar sync manual ahora
//   GET    /api/catalog/products         — listar productos (search + paginado)
//   GET    /api/catalog/products/:id     — detalle de producto
//   POST   /api/catalog/send             — enviar producto en chat
//   POST   /api/catalog/send-list        — enviar product_list en chat
//   GET    /api/catalog/sends/contact/:id — productos enviados a un contacto

const express = require('express');
const svc = require('./service');

module.exports = (db) => {
  const router = express.Router();

  // GET /status — siempre permitido (necesitamos saber si activarlo)
  router.get('/status', (req, res) => {
    const flag = svc.getTenantFlag(db, req.tenantId);
    const local = svc.getLocalCatalog(db, req.tenantId);
    res.json({
      enabled: flag === 1,
      configured: flag !== null, // si ya se decidió (no mostrar banner)
      catalog: local || null,
    });
  });

  // POST /auto-detect — preguntarle a Meta si el WABA tiene catálogo (sin guardar nada)
  router.post('/auto-detect', async (req, res) => {
    try {
      const detected = await svc.detectCatalogForTenant(db, req.tenantId);
      res.json({ detected: !!detected, catalog: detected || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // PATCH /settings — { enabled: bool, autoSync?: bool }
  router.patch('/settings', (req, res) => {
    const enabled = !!req.body?.enabled;
    svc.setTenantFlag(db, req.tenantId, enabled);
    // Si se activó, lanzar primer sync async (no bloquea response)
    if (enabled) {
      svc.syncCatalog(db, req.tenantId, { force: true })
        .then(r => console.log(`[wa-catalog] first sync tenant ${req.tenantId}:`, r))
        .catch(e => console.error(`[wa-catalog] first sync tenant ${req.tenantId} crashed:`, e.message));
    }
    res.json({ ok: true, enabled });
  });

  // ─── A partir de aquí, todos los endpoints requieren feature ON ──
  router.use(svc.requireCatalogEnabled(db));

  router.post('/sync', async (req, res) => {
    try {
      const r = await svc.syncCatalog(db, req.tenantId, { force: true });
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/products', (req, res) => {
    const out = svc.listProducts(db, req.tenantId, {
      search: String(req.query.search || ''),
      page: Number(req.query.page) || 1,
      pageSize: Math.min(Number(req.query.pageSize) || 24, 100),
      onlyActive: req.query.onlyActive !== '0',
    });
    res.json(out);
  });

  router.get('/products/:id', (req, res) => {
    const p = svc.getProduct(db, req.tenantId, Number(req.params.id));
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(p);
  });

  router.post('/send', async (req, res) => {
    try {
      const r = await svc.sendProductToConversation(db, req.tenantId, {
        conversationId: Number(req.body?.conversationId),
        productId: Number(req.body?.productId),
        contactId: req.body?.contactId ? Number(req.body.contactId) : null,
        via: req.body?.via || 'manual',
      });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.post('/send-list', async (req, res) => {
    try {
      const r = await svc.sendProductListToConversation(db, req.tenantId, {
        conversationId: Number(req.body?.conversationId),
        sections: Array.isArray(req.body?.sections) ? req.body.sections : [],
        headerText: req.body?.headerText,
        bodyText: req.body?.bodyText,
        footerText: req.body?.footerText,
        via: req.body?.via || 'manual',
      });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/sends/contact/:id', (req, res) => {
    const out = svc.getProductSendsForContact(db, req.tenantId, Number(req.params.id), {
      limit: Math.min(Number(req.query.limit) || 20, 100),
    });
    res.json({ items: out });
  });

  return router;
};
