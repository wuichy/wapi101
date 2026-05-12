'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { generateToken, processOrderProcessing, processOrderCompleted } = require('./service');

// ── Rutas autenticadas /api/apps/woo/* ───────────────────────────────────────
function authRouter(db) {
  const router = express.Router();

  // GET /api/apps/woo/config
  router.get('/config', (req, res) => {
    const tenantId = req.tenantId;
    let cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(tenantId);
    if (!cfg) return res.json({ connected: false });
    res.json({
      connected:      true,
      enabled:        cfg.enabled === 1,
      token:          cfg.token,
      connectedAt:    cfg.connected_at,
      products:       JSON.parse(cfg.products_json || '[]'),
      pipelineRules:  JSON.parse(cfg.pipeline_rules || '[]'),
    });
  });

  // POST /api/apps/woo/connect — genera token y guarda config inicial
  router.post('/connect', (req, res) => {
    const tenantId = req.tenantId;
    const existing = db.prepare('SELECT id FROM woo_config WHERE tenant_id = ?').get(tenantId);
    if (existing) return res.json({
      token: db.prepare('SELECT token FROM woo_config WHERE tenant_id = ?').get(tenantId).token,
      alreadyConnected: true,
    });
    const token = generateToken();
    db.prepare(`
      INSERT INTO woo_config (tenant_id, token, enabled, connected_at)
      VALUES (?, ?, 1, unixepoch())
    `).run(tenantId, token);
    res.json({ token });
  });

  // POST /api/apps/woo/disconnect
  router.post('/disconnect', (req, res) => {
    db.prepare('DELETE FROM woo_config WHERE tenant_id = ?').run(req.tenantId);
    res.json({ ok: true });
  });

  // PATCH /api/apps/woo/toggle — activar/pausar
  router.patch('/toggle', (req, res) => {
    const { enabled } = req.body;
    db.prepare('UPDATE woo_config SET enabled = ? WHERE tenant_id = ?')
      .run(enabled ? 1 : 0, req.tenantId);
    res.json({ ok: true });
  });

  // PUT /api/apps/woo/products — guardar lista de productos con duración
  router.put('/products', (req, res) => {
    const { products } = req.body; // [{id, name, duration_days}]
    if (!Array.isArray(products)) return res.status(400).json({ error: 'products debe ser un array' });
    db.prepare('UPDATE woo_config SET products_json = ?, updated_at = unixepoch() WHERE tenant_id = ?')
      .run(JSON.stringify(products), req.tenantId);
    res.json({ ok: true });
  });

  // PUT /api/apps/woo/pipeline-rules — guardar reglas de pipeline por duración
  router.put('/pipeline-rules', (req, res) => {
    const { rules } = req.body; // [{duration_days, pipeline_id, stage_id}]
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules debe ser un array' });

    // Validar que los pipelines y stages existen
    const tenantId = req.tenantId;
    const errors   = [];
    for (const r of rules) {
      const pip = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(r.pipeline_id, tenantId);
      const stg = db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').get(r.stage_id, r.pipeline_id);
      if (!pip) errors.push(`Pipeline id=${r.pipeline_id} no existe`);
      else if (!stg) errors.push(`Etapa id=${r.stage_id} no existe en ese pipeline`);
    }
    if (errors.length) return res.status(400).json({ error: errors.join('; ') });

    db.prepare('UPDATE woo_config SET pipeline_rules = ?, updated_at = unixepoch() WHERE tenant_id = ?')
      .run(JSON.stringify(rules), tenantId);
    res.json({ ok: true });
  });

  // GET /api/apps/woo/pipelines — devuelve pipelines+stages del tenant para el selector
  router.get('/pipelines', (req, res) => {
    const tenantId = req.tenantId;
    const pipelines = db.prepare('SELECT id, name FROM pipelines WHERE tenant_id = ? ORDER BY name').all(tenantId);
    const result = pipelines.map(p => ({
      ...p,
      stages: db.prepare('SELECT id, name FROM stages WHERE pipeline_id = ? AND kind = ? ORDER BY sort_order')
        .all(p.id, 'in_progress'),
    }));
    res.json({ pipelines: result });
  });

  // GET /api/apps/woo/plugin-download — descarga el plugin ZIP
  router.get('/plugin-download', (req, res) => {
    const zipPath = path.join(__dirname, '../../..', 'public', 'plugins', 'reelance-conexion-wapi101.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Plugin no disponible aún. Contacta a soporte.' });
    }
    res.download(zipPath, 'reelance-conexion-wapi101.zip');
  });

  return router;
}

// ── Webhook público /webhooks/woo ────────────────────────────────────────────
function webhookRouter(db) {
  const router = express.Router();

  router.post('/', express.json({ limit: '2mb' }), (req, res) => {
    const token = req.headers['x-wapi-token'] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    const cfg = db.prepare('SELECT * FROM woo_config WHERE token = ?').get(token);
    if (!cfg)          return res.status(401).json({ error: 'Token inválido' });
    if (!cfg.enabled)  return res.status(200).json({ ok: true, skipped: 'disabled' });

    const { event, order } = req.body;
    if (!event || !order) return res.status(400).json({ error: 'Payload inválido' });

    const tenantId = cfg.tenant_id;

    try {
      let result;
      if (event === 'order.processing') {
        result = processOrderProcessing(db, tenantId, order);
      } else if (event === 'order.completed') {
        result = processOrderCompleted(db, tenantId, order, cfg);
      } else {
        return res.json({ ok: true, skipped: `event ${event} not handled` });
      }
      res.json({ ok: true, result });
    } catch (err) {
      console.error('[woo webhook]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { authRouter, webhookRouter };
