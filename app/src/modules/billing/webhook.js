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
            const tenantId = billingSvc.syncSubscriptionToTenant(db, sub);
            console.log(`[stripe] ${event.type} sub=${sub.id} status=${sub.status} → tenant=${tenantId ?? '?'}`);
            break;
          }

          case 'invoice.payment_succeeded': {
            const inv = event.data.object;
            console.log(`[stripe] invoice.payment_succeeded: ${inv.id} amount=${inv.amount_paid / 100} ${inv.currency} customer=${inv.customer}`);
            break;
          }

          case 'invoice.payment_failed': {
            const inv = event.data.object;
            console.warn(`[stripe] invoice.payment_failed: ${inv.id} customer=${inv.customer} attempt=${inv.attempt_count}`);
            // Si Stripe agota reintentos y la sub queda past_due / unpaid,
            // ese estado llega vía customer.subscription.updated y se persiste.
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
