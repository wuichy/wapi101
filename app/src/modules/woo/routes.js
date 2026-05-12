'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { generateToken, processOrderProcessing, processOrderCompleted } = require('./service');
const notifSvc = require('../notifications/service');

const DEFAULT_CARRIERS = [
  { id: 'estafeta',       name: 'Estafeta' },
  { id: 'fedex',          name: 'FedEx' },
  { id: 'dhl',            name: 'DHL' },
  { id: 'ups',            name: 'UPS' },
  { id: 'redpack',        name: 'Redpack' },
  { id: 'paquetexpress',  name: 'Paquete Express' },
  { id: 'ampm',           name: 'AM/PM' },
  { id: 'j&t',            name: 'J&T Express' },
  { id: 'tresguerras',    name: 'Tres Guerras' },
  { id: 'otro',           name: 'Otro' },
];

// ── Rutas autenticadas /api/apps/woo/* ───────────────────────────────────────
function authRouter(db) {
  // Migración: agregar columna trigger_statuses si no existe
  try { db.prepare("ALTER TABLE woo_config ADD COLUMN trigger_statuses TEXT DEFAULT '[\"processing\",\"on-hold\"]'").run(); } catch (_) {}

  const router = express.Router();

  // GET /api/apps/woo/config
  router.get('/config', (req, res) => {
    const tenantId = req.tenantId;
    let cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(tenantId);
    if (!cfg) return res.json({ connected: false });
    res.json({
      connected:          true,
      enabled:            cfg.enabled === 1,
      token:              cfg.token,
      connectedAt:        cfg.connected_at,
      products:           JSON.parse(cfg.products_json || '[]'),
      pipelineRules:      JSON.parse(cfg.pipeline_rules || '[]'),
      site_url:           cfg.site_url || '',
      hasCredentials:     !!(cfg.wc_consumer_key && cfg.wc_consumer_secret),
      initialPipelineId:  cfg.initial_pipeline_id || null,
      initialStageId:     cfg.initial_stage_id    || null,
      triggerStatuses:    JSON.parse(cfg.trigger_statuses || '["processing","on-hold"]'),
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

  // PUT /api/apps/woo/initial-pipeline — guardar pipeline/etapa inicial (order.processing)
  router.put('/initial-pipeline', (req, res) => {
    const { pipeline_id, stage_id } = req.body;
    if (!pipeline_id || !stage_id) return res.status(400).json({ error: 'pipeline_id y stage_id son requeridos' });
    const pip = db.prepare('SELECT id FROM pipelines WHERE id = ? AND tenant_id = ?').get(Number(pipeline_id), req.tenantId);
    const stg = db.prepare('SELECT id FROM stages WHERE id = ? AND pipeline_id = ?').get(Number(stage_id), Number(pipeline_id));
    if (!pip) return res.status(400).json({ error: 'Pipeline no encontrado' });
    if (!stg) return res.status(400).json({ error: 'Etapa no encontrada en ese pipeline' });
    db.prepare('UPDATE woo_config SET initial_pipeline_id = ?, initial_stage_id = ?, updated_at = unixepoch() WHERE tenant_id = ?')
      .run(Number(pipeline_id), Number(stage_id), req.tenantId);
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

  // GET /api/apps/woo/order-statuses — trae estatus de WooCommerce (default + custom)
  router.get('/order-statuses', async (req, res) => {
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    const DEFAULT_STATUSES = [
      { slug: 'pending',    name: 'Pago pendiente' },
      { slug: 'processing', name: 'Procesando' },
      { slug: 'on-hold',    name: 'En espera' },
      { slug: 'completed',  name: 'Completado' },
      { slug: 'cancelled',  name: 'Cancelado' },
      { slug: 'refunded',   name: 'Reembolsado' },
      { slug: 'failed',     name: 'Fallido' },
    ];
    if (!cfg?.site_url || !cfg?.wc_consumer_key) return res.json({ statuses: DEFAULT_STATUSES });
    try {
      const base = cfg.site_url.replace(/\/$/, '');
      const auth = 'Basic ' + Buffer.from(`${cfg.wc_consumer_key}:${cfg.wc_consumer_secret}`).toString('base64');
      const resp = await fetch(`${base}/wp-json/wc/v3/reports/orders/totals`, {
        headers: { Authorization: auth }, signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) return res.json({ statuses: DEFAULT_STATUSES });
      const data = await resp.json();
      const statuses = Array.isArray(data)
        ? data.map(s => ({ slug: s.slug, name: s.name }))
        : DEFAULT_STATUSES;
      res.json({ statuses });
    } catch (_) { res.json({ statuses: DEFAULT_STATUSES }); }
  });

  // PUT /api/apps/woo/trigger-statuses — guarda qué estatus disparan la creación de lead
  router.put('/trigger-statuses', (req, res) => {
    const { statuses } = req.body;
    if (!Array.isArray(statuses) || statuses.length === 0)
      return res.status(400).json({ error: 'Selecciona al menos un estatus' });
    db.prepare('UPDATE woo_config SET trigger_statuses = ?, updated_at = unixepoch() WHERE tenant_id = ?')
      .run(JSON.stringify(statuses), req.tenantId);
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

  // GET /api/apps/woo/ping — verifica que el plugin WP esté respondiendo
  router.get('/ping', async (req, res) => {
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    if (!cfg || !cfg.site_url) return res.json({ ok: false, reason: 'no_site_url' });
    try {
      const url = `${cfg.site_url.replace(/\/$/, '')}/wp-json/wapi101/v1/carriers`;
      const resp = await fetch(url, {
        headers: { 'X-Wapi-Token': cfg.token },
        signal: AbortSignal.timeout(8000),
      });
      if (resp.ok) return res.json({ ok: true });
      return res.json({ ok: false, reason: `HTTP ${resp.status}` });
    } catch (e) {
      return res.json({ ok: false, reason: e.message });
    }
  });

  // POST /api/apps/woo/orders/sync — importa órdenes desde WC REST API
  router.post('/orders/sync', async (req, res) => {
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    if (!cfg || !cfg.site_url || !cfg.wc_consumer_key || !cfg.wc_consumer_secret) {
      return res.status(400).json({ error: 'Configura la URL y credenciales WC REST API primero (pestaña Conexión)' });
    }
    const baseUrl  = cfg.site_url.replace(/\/$/, '');
    const authHead = 'Basic ' + Buffer.from(`${cfg.wc_consumer_key}:${cfg.wc_consumer_secret}`).toString('base64');
    let imported = 0;
    let page = 1;
    let hasMore = true;
    try {
      while (hasMore) {
        const url = `${baseUrl}/wp-json/wc/v3/orders?per_page=50&page=${page}&orderby=date&order=desc`;
        const resp = await fetch(url, { headers: { Authorization: authHead }, signal: AbortSignal.timeout(15000) });
        if (!resp.ok) {
          const txt = await resp.text();
          return res.status(502).json({ error: `WooCommerce API error ${resp.status}: ${txt.slice(0,200)}` });
        }
        const orders = await resp.json();
        if (!Array.isArray(orders) || !orders.length) { hasMore = false; break; }

        for (const o of orders) {
          const billing      = o.billing  || {};
          const shipping     = o.shipping || {};
          const customerName = `${billing.first_name || ''} ${billing.last_name || ''}`.trim();
          const products     = (o.line_items || []).map(i => ({
            product_id: i.product_id, name: i.name,
            quantity: i.quantity, total: i.total || '0',
          }));

          // Extraer tracking — WooCommerce Orders Tracking Premium (VillaTheme) usa prefijo _wot_
          let tCarrier = '', tNumber = '', tStatus = '';
          const _meta = (key) => (o.meta_data || []).find(m => m.key === key)?.value || '';

          // 1. VillaTheme WooCommerce Orders Tracking Premium (_wot_ prefix)
          tNumber  = _meta('_wot_tracking_number');
          tCarrier = _meta('_wot_tracking_carrier');
          tStatus  = _meta('_wot_tracking_status');

          // 2. Fallback: WooCommerce Shipment Tracking (SkyVerge/free) — _wc_shipment_tracking_items
          if (!tNumber) {
            const tMeta = (o.meta_data || []).find(m => m.key === '_wc_shipment_tracking_items');
            if (tMeta && Array.isArray(tMeta.value) && tMeta.value.length) {
              const t = tMeta.value[0];
              tCarrier = t.formatted_tracking_provider || t.tracking_provider || t.carrier || '';
              tNumber  = t.tracking_number || '';
            }
          }

          // 3. Fallback: meta keys genéricas
          if (!tNumber) {
            tCarrier = _meta('_order_tracking_carrier') || _meta('_shipping_provider');
            tNumber  = _meta('_order_tracking_number')  || _meta('_tracking_number');
          }

          // 4. Estado desde Wapi101 si no viene de VillaTheme
          if (!tStatus) tStatus = _meta('_wapi101_tracking_status');
          if (!tStatus && o.status === 'completed' && tCarrier) tStatus = 'entregado';

          const wcOrderDate = o.date_created ? Math.floor(new Date(o.date_created).getTime() / 1000) : null;
          const shippingAddr = {
            name:     `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim() || customerName,
            address1: shipping.address_1 || '',
            address2: shipping.address_2 || '',
            city:     shipping.city      || '',
            state:    shipping.state     || '',
            postcode: shipping.postcode  || '',
            country:  shipping.country   || '',
          };

          db.prepare(`
            INSERT INTO woo_orders
              (tenant_id, wc_order_id, wc_order_number, customer_name, customer_phone, customer_email,
               status, products_json, tracking_carrier, tracking_number, tracking_status, raw_json,
               wc_order_date, payment_method, order_total, shipping_total, discount_total, tax_total,
               shipping_address_json, customer_note, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())
            ON CONFLICT(tenant_id, wc_order_id) DO UPDATE SET
              status               = excluded.status,
              customer_name        = excluded.customer_name,
              products_json        = excluded.products_json,
              wc_order_date        = COALESCE(excluded.wc_order_date, wc_order_date),
              payment_method       = excluded.payment_method,
              order_total          = excluded.order_total,
              shipping_total       = excluded.shipping_total,
              discount_total       = excluded.discount_total,
              tax_total            = excluded.tax_total,
              shipping_address_json = excluded.shipping_address_json,
              customer_note        = excluded.customer_note,
              tracking_carrier = CASE WHEN excluded.tracking_carrier != '' THEN excluded.tracking_carrier ELSE tracking_carrier END,
              tracking_number  = CASE WHEN excluded.tracking_number  != '' THEN excluded.tracking_number  ELSE tracking_number  END,
              tracking_status  = CASE WHEN excluded.tracking_status  != '' THEN excluded.tracking_status  ELSE tracking_status  END,
              updated_at       = unixepoch()
          `).run(
            req.tenantId, o.id, String(o.number), customerName,
            billing.phone || '', billing.email || '', o.status,
            JSON.stringify(products), tCarrier, tNumber, tStatus,
            JSON.stringify({ id: o.id, number: o.number, status: o.status }),
            wcOrderDate,
            o.payment_method_title || o.payment_method || '',
            o.total          || '0',
            o.shipping_total || '0',
            o.discount_total || '0',
            o.total_tax      || '0',
            JSON.stringify(shippingAddr),
            o.customer_note || '',
          );
          imported++;
        }
        if (orders.length < 50 || page >= 10) hasMore = false;
        else page++;
      }
      res.json({ ok: true, imported });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/apps/woo/wc-products — trae productos de WooCommerce y los fusiona con duraciones guardadas
  router.get('/wc-products', async (req, res) => {
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    if (!cfg || !cfg.site_url || !cfg.wc_consumer_key || !cfg.wc_consumer_secret) {
      return res.status(400).json({ error: 'Configura las credenciales WC REST API primero (pestaña Conexión)' });
    }
    const baseUrl  = cfg.site_url.replace(/\/$/, '');
    const authHead = 'Basic ' + Buffer.from(`${cfg.wc_consumer_key}:${cfg.wc_consumer_secret}`).toString('base64');
    const saved    = JSON.parse(cfg.products_json || '[]'); // [{id, name, duration_days}]
    const savedMap = Object.fromEntries(saved.map(p => [String(p.id), p.duration_days || 0]));
    try {
      const url  = `${baseUrl}/wp-json/wc/v3/products?per_page=100&status=publish&orderby=title&order=asc`;
      const resp = await fetch(url, { headers: { Authorization: authHead }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) {
        const txt = await resp.text();
        return res.status(502).json({ error: `WooCommerce API error ${resp.status}: ${txt.slice(0, 200)}` });
      }
      const wcProducts = await resp.json();
      const merged = wcProducts.map(p => ({
        id:            p.id,
        name:          p.name,
        sku:           p.sku || '',
        duration_days: savedMap[String(p.id)] ?? 0,
      }));
      res.json({ products: merged });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/apps/woo/plugin-download — descarga el plugin ZIP
  router.get('/plugin-download', (req, res) => {
    const zipPath = path.join(__dirname, '../../..', 'public', 'plugins', 'reelance-conexion-wapi101.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Plugin no disponible aún. Contacta a soporte.' });
    }
    res.download(zipPath, 'reelance-conexion-wapi101.zip');
  });

  // GET /api/apps/woo/orders — listar órdenes con paginación
  router.get('/orders', (req, res) => {
    const page  = Math.max(1, parseInt(req.query.page  || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '25', 10)));
    const offset = (page - 1) * limit;
    const total  = db.prepare('SELECT COUNT(*) as n FROM woo_orders WHERE tenant_id = ?').get(req.tenantId).n;
    const orders = db.prepare(
      'SELECT * FROM woo_orders WHERE tenant_id = ? ORDER BY COALESCE(wc_order_date, created_at) DESC LIMIT ? OFFSET ?'
    ).all(req.tenantId, limit, offset);
    res.json({
      orders: orders.map(o => ({ ...o, products: JSON.parse(o.products_json || '[]') })),
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  });

  // GET /api/apps/woo/orders/carriers — lista paqueterías desde WC
  router.get('/orders/carriers', async (req, res) => {
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    if (!cfg || !cfg.site_url) return res.json({ carriers: DEFAULT_CARRIERS });
    try {
      const url = `${cfg.site_url.replace(/\/$/, '')}/wp-json/wapi101/v1/carriers`;
      const resp = await fetch(url, { headers: { 'X-Wapi-Token': cfg.token } });
      if (!resp.ok) return res.json({ carriers: DEFAULT_CARRIERS });
      const data = await resp.json();
      res.json({ carriers: data.carriers || DEFAULT_CARRIERS });
    } catch (e) {
      res.json({ carriers: DEFAULT_CARRIERS });
    }
  });

  // PATCH /api/apps/woo/orders/:id/tracking — guardar tracking localmente + push a WC
  router.patch('/orders/:id/tracking', async (req, res) => {
    const { carrier, tracking_number, tracking_status } = req.body;
    const order = db.prepare('SELECT * FROM woo_orders WHERE id = ? AND tenant_id = ?').get(Number(req.params.id), req.tenantId);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    // Guardar en DB local
    db.prepare('UPDATE woo_orders SET tracking_carrier=?, tracking_number=?, tracking_status=?, updated_at=unixepoch() WHERE id=?')
      .run(carrier || '', tracking_number || '', tracking_status || '', order.id);

    // Push a WooCommerce si hay credenciales
    const cfg = db.prepare('SELECT * FROM woo_config WHERE tenant_id = ?').get(req.tenantId);
    if (cfg && cfg.site_url && cfg.wc_consumer_key && cfg.wc_consumer_secret) {
      try {
        const url = `${cfg.site_url.replace(/\/$/, '')}/wp-json/wapi101/v1/orders/${order.wc_order_id}/tracking`;
        const resp = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Wapi-Token': cfg.token },
          body: JSON.stringify({ carrier, tracking_number, tracking_status }),
        });
        if (!resp.ok) {
          const text = await resp.text();
          return res.json({ ok: true, wcPush: false, wcError: text });
        }
      } catch (e) {
        return res.json({ ok: true, wcPush: false, wcError: e.message });
      }
    }
    res.json({ ok: true, wcPush: !!(cfg && cfg.site_url) });
  });

  // PUT /api/apps/woo/config/credentials — guardar credenciales WC REST API
  router.put('/config/credentials', (req, res) => {
    const { site_url, wc_consumer_key, wc_consumer_secret } = req.body;
    db.prepare('UPDATE woo_config SET site_url=?, wc_consumer_key=?, wc_consumer_secret=?, updated_at=unixepoch() WHERE tenant_id=?')
      .run(site_url || '', wc_consumer_key || '', wc_consumer_secret || '', req.tenantId);
    res.json({ ok: true });
  });

  return router;
}

// ── Webhook público /webhooks/woo ────────────────────────────────────────────
function webhookRouter(db) {
  const router = express.Router();

  router.post('/', express.json({ limit: '2mb' }), (req, res) => {
    const token = req.headers['x-wapi-token'] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Token requerido' });

    // Token inválido → notificar a todos los admins del tenant que coincida por site_url
    const cfg = db.prepare('SELECT * FROM woo_config WHERE token = ?').get(token);
    if (!cfg) {
      // Intentar identificar tenant por host header para notificar
      try {
        const allCfgs = db.prepare('SELECT * FROM woo_config WHERE connected = 1').all();
        for (const c of allCfgs) {
          notifyWooAdmins(db, c.tenant_id,
            '⚠️ WooCommerce: token inválido',
            'Se recibió un webhook con un token incorrecto. Verifica que el plugin esté bien configurado.',
            'woo_token_invalid');
        }
      } catch (_) {}
      return res.status(401).json({ error: 'Token inválido' });
    }
    if (!cfg.enabled)  return res.status(200).json({ ok: true, skipped: 'disabled' });

    const { event, order } = req.body;
    if (!event || !order) return res.status(400).json({ error: 'Payload inválido' });

    const tenantId = cfg.tenant_id;

    // Actualizar last_webhook_at y limpiar flag de notificación de inactividad
    try {
      db.prepare('UPDATE woo_config SET last_webhook_at = unixepoch(), last_disconnect_notif_at = NULL WHERE tenant_id = ?')
        .run(tenantId);
    } catch (_) {}

    try {
      const triggerStatuses = JSON.parse(cfg.trigger_statuses || '["processing","on-hold"]');
      const eventStatus = event.startsWith('order.') ? event.slice(6) : null;
      let result;

      if (eventStatus && triggerStatuses.includes(eventStatus)) {
        result = processOrderProcessing(db, tenantId, order);
        // Notificación campana: pedido nuevo
        const orderNum  = String(order.number || order.id);
        const custName  = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ') || 'Cliente';
        const total     = order.total ? ` · $${parseFloat(order.total).toLocaleString('es-MX')}` : '';
        notifyWooAdmins(db, tenantId,
          `🛒 Pedido #${orderNum}`,
          `${custName}${total}`,
          'woo_new_order'
        );
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

// ── Helpers de notificaciones ────────────────────────────────────────────────
function notifyWooAdmins(db, tenantId, title, body, type = 'woo_alert') {
  try {
    const admins = db.prepare(
      "SELECT id FROM advisors WHERE tenant_id = ? AND (role = 'admin' OR role = 'owner') AND active = 1"
    ).all(tenantId);
    for (const adv of admins) {
      notifSvc.createNotification(db, {
        tenantId,
        advisorId: adv.id,
        type,
        title,
        body,
        link: null,
      });
    }
  } catch (e) {
    console.error('[woo notify]', e.message);
  }
}

// ── Check de inactividad (llamado desde server.js cada hora) ──────────────────
// Si han pasado más de 1 hora sin recibir un webhook y la app está conectada,
// crea una notificación. Se deduplica con last_disconnect_notif_at para no spamear.
function checkWooInactivity(db) {
  try {
    const ONE_HOUR = 3600;
    const now = Math.floor(Date.now() / 1000);
    const configs = db.prepare(
      'SELECT * FROM woo_config WHERE connected = 1 AND enabled = 1'
    ).all();

    for (const cfg of configs) {
      // Solo revisar si alguna vez llegó un webhook (evita falsos positivos en tiendas nuevas sin pedidos)
      const lastEvent = cfg.last_webhook_at;
      if (!lastEvent) continue;

      const sinceLastEvent = now - lastEvent;
      if (sinceLastEvent < ONE_HOUR) continue; // Menos de 1h → ok

      // Ya notificamos hace menos de 1h → no spamear
      if (cfg.last_disconnect_notif_at && (now - cfg.last_disconnect_notif_at) < ONE_HOUR) continue;

      // Registrar que ya notificamos
      db.prepare('UPDATE woo_config SET last_disconnect_notif_at = ? WHERE tenant_id = ?')
        .run(now, cfg.tenant_id);

      const mins = Math.round(sinceLastEvent / 60);
      const label = mins < 120 ? `${mins} minutos` : `${Math.round(mins / 60)} horas`;
      notifyWooAdmins(
        db,
        cfg.tenant_id,
        '🔌 WooCommerce sin actividad',
        `No se han recibido eventos de WooCommerce en los últimos ${label}. Verifica que el plugin esté activo y el sitio en línea.`,
        'woo_inactivity'
      );
      console.log(`[woo] inactivity notification sent → tenant ${cfg.tenant_id} (${label} without webhook)`);
    }
  } catch (e) {
    console.error('[woo inactivity check]', e.message);
  }
}

module.exports = { authRouter, webhookRouter, checkWooInactivity };
