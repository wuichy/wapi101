// Endpoints de billing:
//   GET  /api/billing/plans        — catálogo de planes con priceIds (público para advisors)
//   GET  /api/billing/subscription — estado actual del tenant (status, plan, period_end)
//   POST /api/billing/checkout     — crea Checkout Session para nueva suscripción
//   POST /api/billing/portal       — link al Customer Portal de Stripe
//
// Solo admins pueden tocar billing (checkout/portal). El tenantId viene del authMiddleware.

const express = require('express');
const billingSvc = require('./service');

// Definición de planes — debe matchear con scripts/seed-stripe-products.js.
// Las priceId vienen del .env (cargado en el seed). Si una está vacía, ese
// plan no aparece como comprable hasta que se configure.
function getPlans() {
  return [
    {
      key: 'starter',
      name: 'Starter',
      tagline: 'Para emprendedores solos',
      monthlyPrice: 29,
      yearlyPrice: 23.20, // mensual equivalente del anual con 20% off
      currency: 'USD',
      features: [
        '1 usuario',
        '500 contactos',
        '1 número WhatsApp',
        '1,000 conversaciones/mes',
        '3 pipelines',
        'Plantillas básicas (5)',
        'Adjuntos en chat',
        'Alarmas multi-condición',
      ],
      missingFeatures: ['Bots con flujos', 'Webhooks salientes', 'API pública', 'IA auto-respuesta'],
      priceIdMonthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || null,
      priceIdYearly:  process.env.STRIPE_PRICE_STARTER_YEARLY  || null,
    },
    {
      key: 'pro',
      name: 'Pro',
      tagline: 'Para PyMEs 2-10 personas',
      monthlyPrice: 79,
      yearlyPrice: 63.20,
      currency: 'USD',
      featured: true, // destacado por default
      features: [
        '5 usuarios',
        'Contactos ilimitados',
        '3 números WhatsApp',
        'Conversaciones ilimitadas',
        'Pipelines ilimitados',
        'Bots con flujos visuales',
        '50 plantillas WA aprobadas',
        'Webhooks salientes',
        'API pública',
        'Reportes completos',
      ],
      missingFeatures: ['IA auto-respuesta', 'White-label'],
      priceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY || null,
      priceIdYearly:  process.env.STRIPE_PRICE_PRO_YEARLY  || null,
    },
    {
      key: 'business',
      name: 'Business',
      tagline: 'Para equipos 20+ personas',
      monthlyPrice: 199,
      yearlyPrice: 159.20,
      currency: 'USD',
      features: [
        '20 usuarios',
        'Todo de Pro',
        'Números WhatsApp ilimitados',
        'Plantillas ilimitadas',
        'IA auto-respuesta (Anthropic)',
        'White-label (logo propio)',
        'Reportes avanzados con export',
        'Onboarding dedicado',
        'Soporte chat 4h SLA',
      ],
      missingFeatures: [],
      priceIdMonthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY || null,
      priceIdYearly:  process.env.STRIPE_PRICE_BUSINESS_YEARLY  || null,
    },
  ];
}

module.exports = function createBillingRouter(db) {
  const router = express.Router();

  // ─── Catálogo de planes (para que el frontend renderice cards) ────────
  router.get('/plans', (_req, res) => {
    res.json({ plans: getPlans() });
  });

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
