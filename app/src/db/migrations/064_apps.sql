-- App Store: catálogo de apps disponibles
CREATE TABLE IF NOT EXISTS marketplace_apps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  description  TEXT,
  version      TEXT    DEFAULT '1.0.0',
  icon_emoji   TEXT    DEFAULT '🧩',
  category     TEXT    DEFAULT 'integration',
  requirements TEXT    DEFAULT '[]',   -- JSON: ["WooCommerce", "WordPress"]
  download_url TEXT,                   -- path relativo al plugin ZIP descargable
  is_system    INTEGER DEFAULT 0,      -- 1 = viene con Wapi101, no se puede borrar
  created_at   INTEGER DEFAULT (unixepoch())
);

-- Instalaciones por tenant
CREATE TABLE IF NOT EXISTS app_installs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id       INTEGER NOT NULL REFERENCES marketplace_apps(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL,
  enabled      INTEGER DEFAULT 1,
  installed_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(app_id, tenant_id)
);

-- Configuración de la app WooCommerce (por tenant)
CREATE TABLE IF NOT EXISTS woo_config (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id      INTEGER NOT NULL UNIQUE,
  token          TEXT    NOT NULL,        -- token secreto para autenticar el plugin WP
  enabled        INTEGER DEFAULT 1,
  products_json  TEXT    DEFAULT '[]',    -- [{id, name, duration_days}]
  pipeline_rules TEXT    DEFAULT '[]',    -- [{duration_days, pipeline_id, stage_id}]
  connected_at   INTEGER,
  created_at     INTEGER DEFAULT (unixepoch()),
  updated_at     INTEGER DEFAULT (unixepoch())
);

-- Seed: app de WooCommerce (sistema)
INSERT OR IGNORE INTO marketplace_apps (slug, name, description, version, icon_emoji, category, requirements, download_url, is_system)
VALUES (
  'reelance-woocommerce',
  'Reelance WooCommerce',
  'Sincroniza pedidos de WooCommerce con Wapi101. Crea contactos y leads automáticamente cuando alguien compra, llena campos de envío y mueve leads al pipeline correcto según los productos comprados.',
  '1.0.0',
  '🛒',
  'integration',
  '["WordPress", "WooCommerce", "WooCommerce Orders Tracking Premium"]',
  '/api/apps/woo/plugin-download',
  1
);
