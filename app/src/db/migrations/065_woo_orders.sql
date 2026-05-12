-- Tabla para guardar órdenes de WooCommerce recibidas via webhook
CREATE TABLE IF NOT EXISTS woo_orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       TEXT NOT NULL,
  wc_order_id     INTEGER NOT NULL,
  wc_order_number TEXT,
  customer_name   TEXT,
  customer_phone  TEXT,
  customer_email  TEXT,
  status          TEXT,         -- 'processing' | 'completed'
  products_json   TEXT DEFAULT '[]',
  tracking_carrier      TEXT DEFAULT '',
  tracking_number       TEXT DEFAULT '',
  tracking_status       TEXT DEFAULT '',  -- '' | 'pendiente' | 'en_camino' | 'entregado'
  raw_json        TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, wc_order_id)
);

-- Columnas adicionales en woo_config para WC REST API
ALTER TABLE woo_config ADD COLUMN site_url TEXT DEFAULT '';
ALTER TABLE woo_config ADD COLUMN wc_consumer_key TEXT DEFAULT '';
ALTER TABLE woo_config ADD COLUMN wc_consumer_secret TEXT DEFAULT '';
