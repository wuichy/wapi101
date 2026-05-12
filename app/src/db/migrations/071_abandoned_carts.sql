-- Carritos abandonados (integración con CartBounty Pro)
-- Configuración por tenant + tabla histórica

ALTER TABLE woo_config ADD COLUMN abandoned_cart_enabled       INTEGER DEFAULT 0;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_pipeline_id   INTEGER DEFAULT NULL;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_stage_id      INTEGER DEFAULT NULL;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_template_id   INTEGER DEFAULT NULL;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_dedup_hours   INTEGER DEFAULT 24;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_min_minutes   INTEGER DEFAULT 60;
ALTER TABLE woo_config ADD COLUMN abandoned_cart_tag           TEXT    DEFAULT 'Carrito abandonado';

CREATE TABLE IF NOT EXISTS woo_abandoned_carts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL DEFAULT 1,
  cb_cart_id      INTEGER NOT NULL,                  -- id del wp_cartbounty_pro
  contact_id      INTEGER,
  expedient_id    INTEGER,
  customer_name   TEXT,
  customer_phone  TEXT,
  customer_email  TEXT,
  cart_total      REAL    DEFAULT 0,
  currency        TEXT    DEFAULT 'MXN',
  products_json   TEXT    DEFAULT '[]',
  cart_url        TEXT,
  template_id     INTEGER,
  message_sent    INTEGER DEFAULT 0,
  send_error      TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, cb_cart_id)
);

CREATE INDEX IF NOT EXISTS idx_abandoned_carts_contact ON woo_abandoned_carts(contact_id);
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_created ON woo_abandoned_carts(created_at);
