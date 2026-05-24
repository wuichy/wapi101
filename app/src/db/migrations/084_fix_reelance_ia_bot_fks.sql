-- Fix de FK rotos en reelance_ia_config — la migration 083 usaba REFERENCES
-- bots(id) pero la tabla real se llama `salsbots`. Con foreign_keys=ON eso
-- rompe cualquier INSERT/UPDATE al intentar validar el FK.
--
-- SQLite no permite cambiar FKs con ALTER TABLE, así que recreamos la tabla.
-- Como la app es nueva (2026-05-22) y probablemente no tiene datos en prod,
-- el riesgo de pérdida es nulo. Aún así preservamos por si acaso.

-- 1. Crear tabla nueva con FKs correctos a `salsbots`
CREATE TABLE IF NOT EXISTS reelance_ia_config_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                INTEGER NOT NULL UNIQUE,
  token                    TEXT    NOT NULL,
  site_url                 TEXT,
  enabled                  INTEGER DEFAULT 1,
  order_pipeline_id        INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
  order_stage_id           INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  abandoned_pipeline_id    INTEGER REFERENCES pipelines(id) ON DELETE SET NULL,
  abandoned_stage_id       INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  abandoned_bot_id         INTEGER REFERENCES salsbots(id) ON DELETE SET NULL,
  order_bot_id             INTEGER REFERENCES salsbots(id) ON DELETE SET NULL,
  connected_at             INTEGER,
  last_order_at            INTEGER,
  last_abandoned_cart_at   INTEGER,
  created_at               INTEGER DEFAULT (unixepoch()),
  updated_at               INTEGER DEFAULT (unixepoch())
);

-- 2. Copiar data si la tabla vieja existe (no-op si está vacía)
INSERT OR IGNORE INTO reelance_ia_config_new
  (id, tenant_id, token, site_url, enabled,
   order_pipeline_id, order_stage_id,
   abandoned_pipeline_id, abandoned_stage_id,
   abandoned_bot_id, order_bot_id,
   connected_at, last_order_at, last_abandoned_cart_at,
   created_at, updated_at)
SELECT
  id, tenant_id, token, site_url, enabled,
  order_pipeline_id, order_stage_id,
  abandoned_pipeline_id, abandoned_stage_id,
  abandoned_bot_id, order_bot_id,
  connected_at, last_order_at, last_abandoned_cart_at,
  created_at, updated_at
FROM reelance_ia_config;

-- 3. Borrar tabla vieja con FKs rotos
DROP TABLE reelance_ia_config;

-- 4. Renombrar nueva
ALTER TABLE reelance_ia_config_new RENAME TO reelance_ia_config;

-- 5. Re-crear index del token
CREATE INDEX IF NOT EXISTS idx_reelance_ia_config_token ON reelance_ia_config(token);
