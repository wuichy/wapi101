-- Migration 076: WhatsApp Catalog (Meta Commerce)
--
-- Agrega capability de catálogo de WhatsApp por tenant:
--   1) Flag por tenant para activar/desactivar (NULL = nunca decidido, smart-detect)
--   2) Tablas locales para cachear catálogo + productos
--   3) Tabla de auditoría de envíos (para analytics y "productos enviados al lead")
--
-- Diseño: multi-tenant estricto. Cada query DEBE filtrar por tenant_id.
-- El cron de sync respeta la flag (skip si está OFF).

-- ─── 1) Flag por tenant ──────────────────────────────────────────────
-- NULL  = nunca configurado → frontend hace auto-detect en primera visita
-- 0     = explícitamente desactivado
-- 1     = explícitamente activado
ALTER TABLE tenants ADD COLUMN whatsapp_catalog_enabled INTEGER DEFAULT NULL;

-- ─── 2) Catálogos ────────────────────────────────────────────────────
-- Una fila por integración de WhatsApp que tenga catálogo linkeado en Meta.
-- Aunque Meta permite N catalogs por business, solo trackeamos el que esté
-- ligado al phone_number_id del tenant (1:1 en la práctica).
CREATE TABLE IF NOT EXISTS whatsapp_catalogs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  integration_id  INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  -- catalog_id de Meta (formato numérico string, ej. "123456789012345")
  catalog_id      TEXT    NOT NULL,
  name            TEXT,
  product_count   INTEGER DEFAULT 0,
  last_synced_at  INTEGER,
  last_sync_error TEXT,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, catalog_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_catalogs_tenant      ON whatsapp_catalogs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_catalogs_integration ON whatsapp_catalogs(integration_id);

-- ─── 3) Productos ────────────────────────────────────────────────────
-- Cache local sincronizado desde Meta cada 60min.
-- retailer_id es el SKU del merchant (lo que ve el cliente final).
-- product_id es el id interno de Meta usado para enviar mensajes.
CREATE TABLE IF NOT EXISTS whatsapp_products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  catalog_id      INTEGER NOT NULL REFERENCES whatsapp_catalogs(id) ON DELETE CASCADE,
  retailer_id     TEXT    NOT NULL,
  product_id      TEXT,
  name            TEXT    NOT NULL,
  description     TEXT,
  price_amount    REAL,
  price_currency  TEXT,
  image_url       TEXT,
  availability    TEXT,
  category        TEXT,
  url             TEXT,
  raw_json        TEXT,
  is_active       INTEGER DEFAULT 1,
  last_seen_at    INTEGER DEFAULT (unixepoch()),
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(catalog_id, retailer_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_products_tenant       ON whatsapp_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_products_catalog      ON whatsapp_products(catalog_id);
CREATE INDEX IF NOT EXISTS idx_wa_products_retailer     ON whatsapp_products(retailer_id);
CREATE INDEX IF NOT EXISTS idx_wa_products_active       ON whatsapp_products(tenant_id, is_active);

-- ─── 4) Envíos (auditoría + analytics) ───────────────────────────────
-- Cada vez que se envía un producto en un chat se registra aquí.
-- Permite:
--   • Mostrar "productos enviados a este lead" en el modal del contacto
--   • Widget "productos más enviados" en analíticas
--   • Sugerir al copilot productos no spamear ("ya le mandaste este 3 veces")
CREATE TABLE IF NOT EXISTS whatsapp_product_sends (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL,
  contact_id       INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id  INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  product_id       INTEGER NOT NULL REFERENCES whatsapp_products(id) ON DELETE CASCADE,
  -- 'manual' = enviado por el operador desde composer
  -- 'bot'    = enviado por un step send_product de un bot
  -- 'copilot'= sugerido por la IA y confirmado por el operador
  -- 'list'   = parte de un product_list_message (multi-producto)
  sent_via         TEXT    NOT NULL CHECK(sent_via IN ('manual','bot','copilot','list')),
  -- 'product' | 'product_list' | 'catalog_message' (tipo de mensaje interactive)
  message_type     TEXT,
  sent_at          INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_wa_sends_tenant_contact ON whatsapp_product_sends(tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_sends_product        ON whatsapp_product_sends(product_id);
CREATE INDEX IF NOT EXISTS idx_wa_sends_recent         ON whatsapp_product_sends(tenant_id, sent_at);
