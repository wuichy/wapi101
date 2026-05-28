-- Reelance IA — config avanzada para carritos abandonados.
--
-- Agrega 3 features que ya existen en WooCommerce abandoned carts pero
-- faltaban en la app Reelance IA (Next.js custom):
--
--   abandoned_tag                  — etiqueta que se agrega al lead cuando
--                                    se envía mensaje de carrito abandonado
--   abandoned_wait_minutes         — minutos a esperar entre el abandono y
--                                    el envío del msg. Si el cliente compra
--                                    antes, se cancela el envío. Default 60.
--   abandoned_dedupe_hours         — ventana anti-spam. Si al mismo contacto
--                                    ya se mandó un msg de carrito abandonado
--                                    dentro de esta ventana, NO se manda otro
--                                    aunque genere un nuevo carrito. Default 24h.

ALTER TABLE reelance_ia_config ADD COLUMN abandoned_tag TEXT;
ALTER TABLE reelance_ia_config ADD COLUMN abandoned_wait_minutes INTEGER DEFAULT 60;
ALTER TABLE reelance_ia_config ADD COLUMN abandoned_dedupe_hours INTEGER DEFAULT 24;

-- Queue de carritos abandonados pendientes de enviar (diferidos por wait_minutes).
-- Un poller cada minuto revisa esta tabla y dispara los que ya cumplieron tiempo.
-- Si en el ínterin se completó la orden, se marca como 'cancelled' y no se manda.
CREATE TABLE IF NOT EXISTS reelance_ia_abandoned_queue (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id          INTEGER NOT NULL,
  external_id        TEXT NOT NULL,                    -- cart id de la app Next.js
  contact_id         INTEGER,
  lead_id            INTEGER,                          -- expedient_id (alias legacy 'lead')
  customer_phone     TEXT,
  customer_name      TEXT,
  cart_total         REAL,
  payload_json       TEXT,                             -- payload completo del evento
  bot_id             INTEGER,                          -- bot a disparar
  status             TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sent' | 'cancelled' | 'failed'
  scheduled_at       INTEGER NOT NULL,                 -- unixepoch cuando debe enviarse
  sent_at            INTEGER,
  cancelled_reason   TEXT,                             -- 'order_completed' | 'dedupe' | 'manual'
  error              TEXT,
  created_at         INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ria_queue_status_scheduled
  ON reelance_ia_abandoned_queue(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_ria_queue_external
  ON reelance_ia_abandoned_queue(tenant_id, external_id);
CREATE INDEX IF NOT EXISTS idx_ria_queue_contact
  ON reelance_ia_abandoned_queue(contact_id, status, sent_at);
