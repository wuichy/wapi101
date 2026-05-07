// Servicio de billing: helpers para Stripe.
// El SDK de Stripe se inicializa lazy con la STRIPE_SECRET_KEY del .env.
// Si la key no está configurada, las llamadas lanzan error claro.

let _stripe = null;
function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY no está configurada en .env');
  const Stripe = require('stripe');
  _stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
  return _stripe;
}

// ─── Customer (uno por tenant) ────────────────────────────────────────────
// Crea o recupera el Customer de Stripe para un tenant. Idempotente: si el
// tenant ya tiene stripe_customer_id, lo reusa.
async function ensureCustomer(db, tenantId) {
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw new Error(`Tenant ${tenantId} no existe`);
  if (tenant.stripe_customer_id) {
    // Verificar que no haya sido borrado en Stripe
    try {
      const c = await getStripe().customers.retrieve(tenant.stripe_customer_id);
      if (!c.deleted) return tenant.stripe_customer_id;
    } catch (_) { /* fall through y crea uno nuevo */ }
  }
  // Tomar email de un advisor admin del tenant si hay
  const admin = db.prepare(
    "SELECT email, name FROM advisors WHERE tenant_id = ? AND role = 'admin' AND active = 1 ORDER BY id LIMIT 1"
  ).get(tenantId);
  const customer = await getStripe().customers.create({
    email: admin?.email || undefined,
    name: tenant.display_name || tenant.slug,
    metadata: { tenant_id: String(tenantId), tenant_slug: tenant.slug },
  });
  db.prepare('UPDATE tenants SET stripe_customer_id = ?, updated_at = unixepoch() WHERE id = ?')
    .run(customer.id, tenantId);
  return customer.id;
}

// ─── Checkout Session ─────────────────────────────────────────────────────
// Crea una Stripe Checkout Session para que el tenant inicie/cambie su
// suscripción. priceId es el ID del Price en Stripe (price_...).
async function createCheckoutSession(db, tenantId, priceId, { successUrl, cancelUrl, quantity = 1 }) {
  if (!priceId) throw new Error('priceId requerido');
  const customerId = await ensureCustomer(db, tenantId);
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: Math.max(1, Math.min(10, Number(quantity) || 1)) }],
    subscription_data: {
      metadata: { tenant_id: String(tenantId) },
      // Trial 14 días si el tenant nunca ha tenido suscripción.
      // Si ya estuvo en trial, Stripe lo respeta y no lo da de nuevo.
      trial_period_days: 14,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    metadata: { tenant_id: String(tenantId) },
  });
  return { url: session.url, id: session.id };
}

// ─── Agregar usuarios extra (proration) ──────────────────────────────────
// preview=true → simula con upcoming invoice y devuelve monto a cobrar hoy.
// preview=false → aplica el cambio en Stripe con proration real.
async function addExtraUsers(db, tenantId, qty, preview = true) {
  const priceId = process.env.STRIPE_PRICE_EXTRA_USER_MONTHLY;
  if (!priceId) {
    const e = new Error('Opción no disponible aún'); e.statusCode = 503; throw e;
  }
  const tenant = db.prepare('SELECT stripe_subscription_id, stripe_customer_id FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant?.stripe_subscription_id) {
    const e = new Error('Necesitas una suscripción activa para agregar asesores extra'); e.statusCode = 400; throw e;
  }

  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id, {
    expand: ['items.data.price'],
  });

  if (['canceled', 'incomplete_expired'].includes(sub.status)) {
    const e = new Error('La suscripción no está activa'); e.statusCode = 400; throw e;
  }

  const existingItem = sub.items.data.find(i => i.price.id === priceId);
  const currentQty   = existingItem?.quantity || 0;
  const newQty       = currentQty + qty;
  const updatedItems = existingItem
    ? [{ id: existingItem.id, quantity: newQty }]
    : [{ price: priceId, quantity: qty }];

  const now         = Math.floor(Date.now() / 1000);
  const daysLeft    = Math.ceil((sub.current_period_end - now) / 86400);
  const onTrial     = sub.status === 'trialing';

  if (preview) {
    let chargeAmount = 0;
    let currency = 'MXN';
    if (!onTrial) {
      try {
        const upcoming = await stripe.invoices.retrieveUpcoming({
          customer: tenant.stripe_customer_id,
          subscription: tenant.stripe_subscription_id,
          subscription_items: updatedItems,
          subscription_proration_behavior: 'create_prorations',
          subscription_proration_date: now,
        });
        // Suma solo las líneas de proration positivas (cargos nuevos)
        chargeAmount = upcoming.lines.data
          .filter(l => l.proration && l.amount > 0)
          .reduce((s, l) => s + l.amount, 0) / 100;
        currency = (upcoming.currency || 'mxn').toUpperCase();
      } catch (_) { /* Si falla el preview, dejamos chargeAmount = 0 */ }
    }
    return { preview: true, qty, newTotalSeats: newQty, chargeAmount, currency, daysLeft, renewalDate: sub.current_period_end, onTrial };
  }

  // Aplicar el cambio con proration real
  await stripe.subscriptions.update(tenant.stripe_subscription_id, {
    items: updatedItems,
    proration_behavior: 'create_prorations',
  });
  db.prepare('UPDATE tenants SET extra_users = ?, updated_at = unixepoch() WHERE id = ?').run(newQty, tenantId);
  return { ok: true, newTotalSeats: newQty };
}

// ─── Customer Portal ──────────────────────────────────────────────────────
// Genera un link al portal de Stripe donde el customer puede:
//   - cambiar plan
//   - actualizar tarjeta
//   - ver facturas
//   - cancelar suscripción
async function createPortalSession(db, tenantId, returnUrl) {
  const customerId = await ensureCustomer(db, tenantId);
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return { url: session.url };
}

// ─── Sync subscription → tenant row ──────────────────────────────────────
// Llamado desde el webhook handler cuando llega un evento de subscription.
// Toma el subscription object de Stripe y actualiza tenants.subscription_*.
function syncSubscriptionToTenant(db, subscription) {
  const tenantId = Number(subscription?.metadata?.tenant_id || 0);
  if (!tenantId) {
    console.warn('[stripe] subscription sin tenant_id en metadata:', subscription.id);
    return null;
  }
  const status = subscription.status; // trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused
  const periodEnd = subscription.current_period_end || null;
  const subId = subscription.id;
  // Si la suscripción fue cancelada y ya pasó el período, limpiar el id local
  // pero mantener el customer_id (futuras suscripciones lo reusan).
  const finalSubId = (status === 'canceled' && periodEnd && periodEnd < Math.floor(Date.now()/1000)) ? null : subId;
  db.prepare(`
    UPDATE tenants SET
      stripe_subscription_id = ?,
      subscription_status = ?,
      subscription_period_end = ?,
      updated_at = unixepoch()
    WHERE id = ?
  `).run(finalSubId, status, periodEnd, tenantId);
  return tenantId;
}

// ─── Verificación de webhook signature ────────────────────────────────────
// El raw body original es necesario (Express con express.json() lo destruye).
// El router de webhooks/stripe usa express.raw() en la ruta para preservarlo.
function constructWebhookEvent(rawBody, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET no está configurada');
  return getStripe().webhooks.constructEvent(rawBody, signature, secret);
}

module.exports = {
  getStripe,
  ensureCustomer,
  createCheckoutSession,
  createPortalSession,
  syncSubscriptionToTenant,
  constructWebhookEvent,
  addExtraUsers,
};
