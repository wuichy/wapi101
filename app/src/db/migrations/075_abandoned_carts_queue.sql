-- Convierte woo_abandoned_carts en una cola con delay.
-- Bug original: el handler enviaba la plantilla INMEDIATAMENTE al recibir el
-- webhook cart.abandoned, ignorando abandoned_cart_min_minutes. Andrea recibió
-- intento de envío 30s después de abandonar el carrito y antes de que pasaran
-- los 27s que le tomó completar la compra.
--
-- Cambios:
--   1) status: pending | sent | cancelled_purchased | failed
--   2) send_at: cuándo el poller debe intentar enviar
--   3) retry_count: cuántas veces se reintentó
--   4) last_attempt_at: último intento (para backoff)
--
-- Backfill:
--   - message_sent=1 → status='sent', send_at=created_at
--   - send_error NOT NULL → status='failed'
--   - resto → status='pending' (improbable en histórico, pero seguro)

ALTER TABLE woo_abandoned_carts ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE woo_abandoned_carts ADD COLUMN send_at INTEGER;
ALTER TABLE woo_abandoned_carts ADD COLUMN retry_count INTEGER DEFAULT 0;
ALTER TABLE woo_abandoned_carts ADD COLUMN last_attempt_at INTEGER;

-- Backfill: los carritos existentes ya están procesados, no queremos que el
-- nuevo poller los reintente. Marcar según estado actual.
UPDATE woo_abandoned_carts SET status = 'sent', send_at = created_at WHERE message_sent = 1;
UPDATE woo_abandoned_carts SET status = 'failed', send_at = created_at WHERE message_sent = 0 AND send_error IS NOT NULL;
UPDATE woo_abandoned_carts SET status = 'pending', send_at = created_at WHERE status IS NULL;

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_queue
  ON woo_abandoned_carts(status, send_at)
  WHERE status = 'pending';
