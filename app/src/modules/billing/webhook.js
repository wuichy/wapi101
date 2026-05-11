// Webhook handler de Stripe.
//
// El raw body es CRÍTICO para verificar la firma — Express con express.json()
// destruye el body. Usar express.raw({ type: 'application/json' }) en la ruta.
//
// Eventos que escuchamos:
//   checkout.session.completed              — primera vez que un tenant completa pago
//   customer.subscription.created           — suscripción creada
//   customer.subscription.updated           — cambio de plan, pausa, reanudación
//   customer.subscription.deleted           — cancelación final
//   invoice.payment_succeeded               — cobro exitoso
//   invoice.payment_failed                  — cobro falló (downgrade flow)
//
// Idempotencia: Stripe puede reintentar. La sincronización a tenants es
// idempotente (UPDATE por tenant_id basado en metadata).

const express = require('express');
const billingSvc = require('./service');

// Obtener tenant + admin para poder enviarle emails desde webhooks Stripe.
function _getTenantInfo(db, stripeCustomerId) {
  if (!stripeCustomerId) return null;
  const tenant = db.prepare('SELECT id, display_name, plan FROM tenants WHERE stripe_customer_id = ?').get(stripeCustomerId);
  if (!tenant) return null;
  const admin = db.prepare("SELECT name, email FROM advisors WHERE tenant_id = ? AND role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get(tenant.id);
  return { tenant, admin };
}

module.exports = function createStripeWebhookRouter(db) {
  const router = express.Router();

  router.post('/',
    express.raw({ type: 'application/json' }),
    (req, res) => {
      const signature = req.headers['stripe-signature'];
      if (!signature) {
        console.warn('[stripe webhook] sin x-stripe-signature header');
        return res.sendStatus(400);
      }

      let event;
      try {
        event = billingSvc.constructWebhookEvent(req.body, signature);
      } catch (err) {
        console.warn(`[stripe webhook] firma inválida: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      // Responder 200 inmediato para que Stripe no reintente.
      // El procesamiento se hace después.
      res.sendStatus(200);

      try {
        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object;
            console.log(`[stripe] checkout.session.completed: ${session.id} customer=${session.customer} subscription=${session.subscription}`);
            // El subscription.created event llegará después y hará el sync.
            break;
          }

          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted': {
            const sub = event.data.object;
            // Capturar plan actual ANTES de sincronizar para detectar cambio
            const tenantBefore = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(
              Number(sub?.metadata?.tenant_id || 0)
            );
            const tenantId = billingSvc.syncSubscriptionToTenant(db, sub);
            console.log(`[stripe] ${event.type} sub=${sub.id} status=${sub.status} → tenant=${tenantId ?? '?'}`);

            if (tenantId) {
              const info = _getTenantInfo(db, sub.customer);
              if (info?.admin?.email) {
                const mailer = require('../mailer/transactional');
                const tenantAfter = db.prepare('SELECT plan FROM tenants WHERE id = ?').get(tenantId);

                if (event.type === 'customer.subscription.deleted' && sub.status === 'canceled') {
                  mailer.sendSubscriptionCancelled({
                    to:          info.admin.email,
                    name:        info.admin.name,
                    companyName: info.tenant.display_name,
                    plan:        info.tenant.plan,
                    periodEnd:   sub.current_period_end,
                  }).catch(e => console.error('[mailer] sendSubscriptionCancelled:', e.message));

                } else if (event.type === 'customer.subscription.updated'
                  && tenantBefore && tenantAfter
                  && tenantBefore.plan !== tenantAfter.plan) {
                  mailer.sendPlanChanged({
                    to:          info.admin.email,
                    name:        info.admin.name,
                    companyName: info.tenant.display_name,
                    oldPlan:     tenantBefore.plan,
                    newPlan:     tenantAfter.plan,
                  }).catch(e => console.error('[mailer] sendPlanChanged:', e.message));
                }
              }
            }
            break;
          }

          case 'invoice.payment_succeeded': {
            const inv = event.data.object;
            console.log(`[stripe] invoice.payment_succeeded: ${inv.id} amount=${inv.amount_paid / 100} ${inv.currency} customer=${inv.customer}`);
            // No enviar recibo en cobros de $0 (e.g. trial setup)
            if ((inv.amount_paid || 0) > 0) {
              const info = _getTenantInfo(db, inv.customer);
              if (info?.admin?.email) {
                const mailer = require('../mailer/transactional');
                mailer.sendPaymentReceipt({
                  to:          info.admin.email,
                  name:        info.admin.name,
                  companyName: info.tenant.display_name,
                  amount:      inv.amount_paid / 100,
                  currency:    inv.currency,
                  plan:        info.tenant.plan,
                  invoiceUrl:  inv.hosted_invoice_url || inv.invoice_pdf || null,
                  periodEnd:   inv.lines?.data?.[0]?.period?.end || null,
                }).catch(e => console.error('[mailer] sendPaymentReceipt:', e.message));
              }
            }
            break;
          }

          case 'invoice.payment_failed': {
            const inv = event.data.object;
            console.warn(`[stripe] invoice.payment_failed: ${inv.id} customer=${inv.customer} attempt=${inv.attempt_count}`);
            // Si Stripe agota reintentos y la sub queda past_due / unpaid,
            // ese estado llega vía customer.subscription.updated y se persiste.
            const info = _getTenantInfo(db, inv.customer);
            if (info?.admin?.email) {
              const mailer = require('../mailer/transactional');
              mailer.sendPaymentFailed({
                to:           info.admin.email,
                name:         info.admin.name,
                companyName:  info.tenant.display_name,
                attempt:      inv.attempt_count || 1,
                nextAttempt:  inv.next_payment_attempt || null,
                billingUrl:   'https://wapi101.com/app',
              }).catch(e => console.error('[mailer] sendPaymentFailed:', e.message));
            }
            break;
          }

          default:
            // Eventos que no nos interesan (hay decenas). Ignorar silencioso.
            break;
        }
      } catch (err) {
        console.error(`[stripe webhook] error procesando ${event.type}:`, err.message);
        // Ya respondimos 200 al endpoint, no hay nada que devolver.
      }
    }
  );

  return router;
};
