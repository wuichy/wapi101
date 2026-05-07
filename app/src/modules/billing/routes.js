// Endpoints de billing:
//   GET  /api/billing/plans        — catálogo de planes con priceIds (público para advisors)
//   GET  /api/billing/subscription — estado actual del tenant (status, plan, period_end)
//   POST /api/billing/checkout     — crea Checkout Session para nueva suscripción
//   POST /api/billing/portal       — link al Customer Portal de Stripe
//
// Solo admins pueden tocar billing (checkout/portal). El tenantId viene del authMiddleware.

const express = require('express');
const billingSvc = require('./service');

// Definición de planes.
// promoPrice = precio promoción de lanzamiento.
// monthlyPrice = precio real (se muestra tachado mientras haya promo).
// Las priceId vienen del .env. Si están vacías el plan no es comprable hasta configurarlas.
function getPlans() {
  return [
    {
      key:      'free',
      name:     'Gratis',
      tagline:  'Para empezar sin compromisos',
      currency: 'MXN',
      monthlyPrice: 0,
      promoPrice:   0,
      free:         true,
      limits: { leads: null, contacts: 500, users: 1 },
      features: [
        '1 usuario (solo admin)',
        '500 contactos',
        'WhatsApp, Instagram y más',
        'Bots con flujos visuales',
        'Pipelines y Leads ilimitados',
        'Recordatorios',
        'Sin tarjeta de crédito',
      ],
    },
    {
      key:          'basico',
      name:         'Básico',
      tagline:      'Para negocios que empiezan',
      currency:     'MXN',
      monthlyPrice: 349,
      promoPrice:   149,
      // Semestral: paga 5 meses, usa 6 (−16.7%)
      semestralTotal: 745,   // 149 × 5
      semestralMonthly: 124, // equivalente mensual
      // Anual: paga 9 meses, usa 12 (−25%)
      annualTotal:   1341,  // 149 × 9
      annualMonthly: 112,   // equivalente mensual
      limits: { leads: 4000, contacts: 8000, users: 2 },
      features: [
        '2 usuarios incluidos',
        '4,000 leads',
        '8,000 contactos',
        'Bots con flujos visuales',
        'Pipelines ilimitados',
        'Plantillas WhatsApp',
        'Webhooks salientes',
        'API pública',
        'Reportes completos',
      ],
      priceIdMonthly:   process.env.STRIPE_PRICE_BASICO_MONTHLY   || null,
      priceIdSemestral: process.env.STRIPE_PRICE_BASICO_SEMESTRAL || null,
      priceIdYearly:    process.env.STRIPE_PRICE_BASICO_YEARLY    || null,
    },
    {
      key:          'pro',
      name:         'Pro',
      tagline:      'Para equipos en crecimiento',
      currency:     'MXN',
      monthlyPrice: 699,
      promoPrice:   299,
      semestralTotal: 1495,
      semestralMonthly: 249,
      annualTotal:   2691,
      annualMonthly: 224,
      featured:     true,
      limits: { leads: 15000, contacts: 30000, users: 2 },
      features: [
        '2 usuarios incluidos',
        '15,000 leads',
        '30,000 contactos',
        'Todo lo del plan Básico',
        'IA auto-respuesta (Anthropic)',
        'Soporte prioritario',
      ],
      priceIdMonthly:   process.env.STRIPE_PRICE_PRO_MONTHLY   || null,
      priceIdSemestral: process.env.STRIPE_PRICE_PRO_SEMESTRAL || null,
      priceIdYearly:    process.env.STRIPE_PRICE_PRO_YEARLY    || null,
    },
    {
      key:          'ultra',
      name:         'Ultra',
      tagline:      'Para operaciones a gran escala',
      currency:     'MXN',
      monthlyPrice: 1199,
      promoPrice:   499,
      semestralTotal: 2495,
      semestralMonthly: 416,
      annualTotal:   4491,
      annualMonthly: 374,
      limits: { leads: 50000, contacts: 100000, users: 2 },
      features: [
        '2 usuarios incluidos',
        '50,000 leads',
        '100,000 contactos',
        'Todo lo del plan Pro',
        'White-label (logo propio)',
        'Onboarding dedicado',
        'Soporte chat 4h SLA',
      ],
      priceIdMonthly:   process.env.STRIPE_PRICE_ULTRA_MONTHLY   || null,
      priceIdSemestral: process.env.STRIPE_PRICE_ULTRA_SEMESTRAL || null,
      priceIdYearly:    process.env.STRIPE_PRICE_ULTRA_YEARLY    || null,
    },
    {
      key:      'ejecutivo',
      name:     'Ejecutivo',
      tagline:  'Plan a tu medida',
      currency: 'MXN',
      custom:   true,
      limits:   { leads: null, contacts: null, users: null },
      features: [
        'Leads y contactos ilimitados',
        'Usuarios ilimitados',
        'Todo lo del plan Ultra',
        'Integraciones personalizadas',
        'SLA dedicado',
        'Precio según necesidades',
      ],
    },
  ];
}

const EXTRA_USER = {
  promoPrice:   99,
  monthlyPrice: 199,
  currency:     'MXN',
  priceIdMonthly: process.env.STRIPE_PRICE_EXTRA_USER_MONTHLY || null,
};

module.exports = function createBillingRouter(db) {
  const router = express.Router();

  // ─── Catálogo de planes ───────────────────────────────────────────────
  router.get('/plans', (_req, res) => {
    res.json({ plans: getPlans(), extraUser: EXTRA_USER });
  });

  // ─── Estado actual de la suscripción ──────────────────────────────────
  router.get('/subscription', (req, res) => {
    const t = db.prepare(`
      SELECT id, slug, display_name, plan, status, extra_users,
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
      extraUsers: t.extra_users || 0,
      hasStripeCustomer: !!t.stripe_customer_id,
      subscription: t.stripe_subscription_id ? {
        id: t.stripe_subscription_id,
        status: t.subscription_status,
        periodEnd: t.subscription_period_end,
        trialEndsAt: t.trial_ends_at,
      } : null,
    });
  });

  // ─── Agregar usuarios extra (con proration) ───────────────────────────
  router.post('/extra-users', async (req, res) => {
    if (req.advisor?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
    const qty     = Math.max(1, Math.min(10, Number(req.body?.qty) || 1));
    const preview = req.body?.preview !== false; // default true
    try {
      const result = await billingSvc.addExtraUsers(db, req.tenantId, qty, preview);
      res.json(result);
    } catch (err) {
      console.error('[billing/extra-users]', err.message);
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  // ─── Iniciar checkout ─────────────────────────────────────────────────
  router.post('/checkout', async (req, res) => {
    if (req.advisor?.role !== 'admin') {
      return res.status(403).json({ error: 'Solo admins pueden iniciar checkout' });
    }
    const { priceId, successUrl, cancelUrl, quantity } = req.body || {};
    if (!priceId) return res.status(400).json({ error: 'priceId requerido' });
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
    try {
      const session = await billingSvc.createCheckoutSession(db, req.tenantId, priceId, {
        successUrl: successUrl || `${baseUrl}/?billing=success`,
        cancelUrl: cancelUrl || `${baseUrl}/?billing=cancelled`,
        quantity,
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

module.exports.getPlans = getPlans;
