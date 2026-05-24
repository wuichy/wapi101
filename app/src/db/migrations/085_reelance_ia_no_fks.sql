-- Quitar TODOS los FKs de reelance_ia_config — más a prueba de fallas.
--
-- Bug previo: las FKs apuntaban a 'bots' (real: salsbots) y 'pipeline_stages'
-- (real: stages). Cualquier INSERT/UPDATE fallaba con foreign_keys=ON.
--
-- Decisión: en lugar de seguir cazando nombres reales de tablas, eliminamos
-- los FKs por completo. La validación de pipeline/stage/bot IDs se hace en
-- el frontend (los selectores del modal solo muestran IDs válidos). Si un
-- pipeline/bot se borra, los rows quedan con el ID huérfano y el módulo
-- lo ignora silenciosamente (el `_findOrCreateLead` chequea `if (!pipelineId)
-- return null`).

CREATE TABLE IF NOT EXISTS reelance_ia_config_v3 (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                INTEGER NOT NULL UNIQUE,
  token                    TEXT    NOT NULL,
  site_url                 TEXT,
  enabled                  INTEGER DEFAULT 1,
  order_pipeline_id        INTEGER,
  order_stage_id           INTEGER,
  abandoned_pipeline_id    INTEGER,
  abandoned_stage_id       INTEGER,
  abandoned_bot_id         INTEGER,
  order_bot_id             INTEGER,
  connected_at             INTEGER,
  last_order_at            INTEGER,
  last_abandoned_cart_at   INTEGER,
  created_at               INTEGER DEFAULT (unixepoch()),
  updated_at               INTEGER DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO reelance_ia_config_v3
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

DROP TABLE reelance_ia_config;
ALTER TABLE reelance_ia_config_v3 RENAME TO reelance_ia_config;

CREATE INDEX IF NOT EXISTS idx_reelance_ia_config_token ON reelance_ia_config(token);
