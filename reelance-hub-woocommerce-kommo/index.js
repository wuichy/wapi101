const express = require('express');
const config = require('./config');
const { verifyWooSignature } = require('./verify');
const { normalizeOrder } = require('./normalize');
const { syncOrder } = require('./kommo-sync');

const router = express.Router();

const auditLog = [];
const AUDIT_LIMIT = 100;

function pushAudit(entry) {
  auditLog.unshift({ at: new Date().toISOString(), ...entry });
  if (auditLog.length > AUDIT_LIMIT) auditLog.length = AUDIT_LIMIT;
}

router.post(
  '/woocommerce/order',
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  }),
  async (req, res) => {
    const signature = req.get('x-wc-webhook-signature');
    const topic = req.get('x-wc-webhook-topic') || '';
    const sourceUrl = req.get('x-wc-webhook-source') || '';

    if (!config.webhook.skipSignatureCheck) {
      const valid = verifyWooSignature(req.rawBody || '', signature, config.webhook.secret);
      if (!valid) {
        pushAudit({
          type: 'signature_invalid',
          topic,
          sourceUrl,
          hasSignature: Boolean(signature)
        });
        return res.status(401).json({ error: 'Firma de webhook inválida.' });
      }
    }

    const payload = req.body || {};
    const order = normalizeOrder(payload);

    if (!order.orderNumber) {
      pushAudit({ type: 'order_missing_number', topic, sourceUrl });
      return res.status(400).json({ error: 'El payload no incluye número de pedido.' });
    }

    if (!order.contact.phone && !order.contact.email) {
      pushAudit({
        type: 'order_missing_contact',
        topic,
        orderNumber: order.orderNumber
      });
      return res.status(400).json({ error: 'El pedido no trae teléfono ni email del cliente.' });
    }

    res.status(202).json({ ok: true, orderNumber: order.orderNumber });

    try {
      const audit = await syncOrder(order);
      pushAudit({ type: 'sync_ok', topic, sourceUrl, ...audit });
    } catch (error) {
      pushAudit({
        type: 'sync_error',
        topic,
        sourceUrl,
        orderNumber: order.orderNumber,
        message: error.message,
        status: error?.response?.status || null,
        kommoBody: error?.response?.data || null
      });
      console.error('[wc-kommo] sync error:', error.message);
    }
  }
);

router.get('/audit', (_req, res) => {
  res.json({ items: auditLog });
});

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    pipelineConfigured: Boolean(
      config.kommo.pipelineClientesId && config.kommo.statusRecientesId
    ),
    botsToStop: config.kommo.botsToStop,
    skipSignatureCheck: config.webhook.skipSignatureCheck
  });
});

module.exports = router;
