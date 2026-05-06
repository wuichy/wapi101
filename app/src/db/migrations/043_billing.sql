-- Migration 043: campos billing en tenants
--
-- Agrega los campos necesarios para sincronizar el estado de la suscripción
-- de cada tenant con Stripe. Sin esto, el webhook de Stripe no tiene dónde
-- guardar el subscription_id ni el status, y no podemos saber qué tenants
-- están activos / past_due / cancelled / trialing.
--
-- Campos:
--   stripe_customer_id        — ID del Customer en Stripe (cu_...)
--   stripe_subscription_id    — ID de la Subscription activa (sub_...)
--   subscription_status       — espejo del status de Stripe (trialing, active,
--                               past_due, cancelled, incomplete, paused, etc.)
--   subscription_period_end   — unixtimestamp del fin del período actual
--                               (para mostrar "te toca renovar el dd/mm")
--   trial_ends_at             — fin del trial de 14 días
--
-- Idempotente: usa ALTER TABLE ... ADD COLUMN. SQLite no soporta IF NOT EXISTS
-- en ADD COLUMN nativamente, pero el _migrations table garantiza que solo
-- corre una vez.

ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE tenants ADD COLUMN subscription_status TEXT;
ALTER TABLE tenants ADD COLUMN subscription_period_end INTEGER;
ALTER TABLE tenants ADD COLUMN trial_ends_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription ON tenants(stripe_subscription_id);
