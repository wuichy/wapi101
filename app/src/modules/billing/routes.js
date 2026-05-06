// Endpoints de billing:
//   POST /api/billing/checkout     — crea Checkout Session para nueva suscripción
//   POST /api/billing/portal       — link al Customer Portal de Stripe
//   GET  /api/billing/subscription — estado actual del tenant (status, plan, period_end)
//
// Solo admins pueden tocar billing. El tenantId viene del authMiddleware.

const express = require('express');
const billingSvc = require('./service');

module.exports = function createBillingRouter(db) {
  const router = express.Router();

  // ─── Estado actual de la suscripción ──────────────────────────────────
  router.get('/subscription', (req, res) => {
    const t = db.prepare(`
      SELECT id, slug, display_name, plan, status,
             stripe_customer_id, stripe_subscription_id,
             subscription_status, subscription_period_end, trial_ends_at
      FROM tenants WHERE id = ?
    `).get(req.tenantId);
    if (!t) return res.status(404).json({ error: 'Tenant no encontrado' });
    res.json({
      tenantId: t.id,
      slug: t.slug,
      displayName: t.display_name,
      plan: t.plan,
      status: t.status,
      hasStripeCustomer: !!t.stripe_customer_id,
      subscription: t.stripe_subscription_id ? {
        id: t.stripe_subscription_id,
        status: t.subscription_status,
        periodEnd: t.subscription_period_end,
        trialEndsAt: t.trial_ends_at,
      } : null,
    });
  });

  // ─── Iniciar checkout ─────────────────────────────────────────────────
  router.post('/checkout', async (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo admins pueden iniciar checkout' });
    }
    const { priceId, successUrl, cancelUrl } = req.body || {};
    if (!priceId) return res.status(400).json({ error: 'priceId requerido' });
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    try {
      const session = await billingSvc.createCheckoutSession(db, req.tenantId, priceId, {
        successUrl: successUrl || `${baseUrl}/?billing=success`,
        cancelUrl: cancelUrl || `${baseUrl}/?billing=cancelled`,
      });
      res.json(session);
    } catch (err) {
      console.error('[billing/checkout]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Customer Portal ──────────────────────────────────────────────────
  router.post('/portal', async (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo admins pueden abrir el portal' });
    }
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    const returnUrl = req.body?.returnUrl || `${baseUrl}/?billing=portal-return`;
    try {
      const session = await billingSvc.createPortalSession(db, req.tenantId, returnUrl);
      res.json(session);
    } catch (err) {
      console.error('[billing/portal]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
