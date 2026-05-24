-- App Reelance IA — integración con la tienda Next.js custom (reelance.mx).
--
-- A diferencia de la app "Reelance WooCommerce" (que sincroniza con un WP),
-- esta app recibe webhooks directos desde el código Next.js de la tienda
-- cuando se crean órdenes o se abandonan carritos. La tienda usa Prisma +
-- SQLite, no WooCommerce.
--
-- Una sola app, dos features:
--   1. Sincroniza órdenes nuevas → crea contacto + lead en pipeline
--   2. Sincroniza carritos abandonados → crea contacto + lead + dispara
--      bot de recovery (igual que CartBounty Pro + plantilla WhatsApp)

-- Registrar la app en el marketplace
INSERT OR IGNORE INTO marketplace_apps (slug, name, description, version, icon_emoji, category, requirements, download_url, is_system)
VALUES (
  'reelance-ia',
  'Reelance IA',
  'Sincroniza tu tienda Reelance (Next.js + Prisma) con Wapi101. Importa órdenes y carritos abandonados automáticamente — crea contactos, leads y dispara bots de recovery con WhatsApp Business. Diseñada para reelance.mx.',
  '1.0.0',
  '🤖',
  'integration',
  '["Reelance Store (Next.js + Prisma)"]',
  NULL,
  1
);

-- Config por tenant. Token autogenerado al instalar la app — la tienda
-- Next.js lo usa para autenticar sus webhooks vs Wapi101.
CREATE TABLE IF NOT EXISTS reelance_ia_config (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                INTEGER NOT NULL UNIQUE,
  token                    TEXT    NOT NULL,                 -- Bearer token para auth
  site_url                 TEXT,                              -- ej. https://reelance.mx
  enabled                  INTEGER DEFAULT 1,
  -- Pipeline donde van órdenes nuevas (al crearse status=PAID/PROCESSING)
  order_pipeline_id        INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
  order_stage_id           INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Pipeline donde van carritos abandonados (al detectarse status=abandoned)
  abandoned_pipeline_id    INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
  abandoned_stage_id       INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  -- Bot opcional que se ejecuta cuando entra un carrito abandonado
  abandoned_bot_id         INTEGER REFERENCES bots(id) ON DELETE SET NULL,
  -- Bot opcional para órdenes nuevas (confirmación de compra, tracking, etc.)
  order_bot_id             INTEGER REFERENCES bots(id) ON DELETE SET NULL,
  -- Sobre todo para debug y reconnect
  connected_at             INTEGER,
  last_order_at            INTEGER,
  last_abandoned_cart_at   INTEGER,
  created_at               INTEGER DEFAULT (unixepoch()),
  updated_at               INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_reelance_ia_config_token ON reelance_ia_config(token);

-- Log de webhooks recibidos (debug + idempotencia)
CREATE TABLE IF NOT EXISTS reelance_ia_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  event_type      TEXT NOT NULL,                  -- 'order' | 'abandoned_cart'
  external_id     TEXT NOT NULL,                  -- Order.id o AbandonedCart.id (cuid de Prisma)
  external_status TEXT,                            -- 'PENDING' | 'PAID' | 'abandoned' | etc.
  payload         TEXT,                            -- JSON del payload original
  contact_id      INTEGER,                         -- contacto creado/actualizado
  lead_id         INTEGER,                         -- lead creado
  processed_at    INTEGER DEFAULT (unixepoch()),
  error           TEXT,                            -- si falló el procesamiento
  UNIQUE(tenant_id, event_type, external_id, external_status)
);

CREATE INDEX IF NOT EXISTS idx_reelance_ia_events_tenant ON reelance_ia_events(tenant_id, event_type);
