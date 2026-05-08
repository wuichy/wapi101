-- Tracking de disparos para bots con triggers programados (Fase 3).
-- Evita disparar 2 veces el mismo bot al mismo contacto en la misma "ventana".
--
-- Para scheduled_one_time: scope_key = '' (un solo registro por (bot, contact))
-- Para scheduled_daily:    scope_key = 'YYYY-MM-DD' (un disparo por día)
-- Para scheduled_field:    scope_key = `${fieldId}:${valueAtFire}` (un disparo
--                          por valor del campo; si cambia la fecha, vuelve a
--                          ser elegible)

CREATE TABLE IF NOT EXISTS bot_schedule_runs (
  tenant_id    INTEGER NOT NULL,
  bot_id       INTEGER NOT NULL,
  contact_id   INTEGER NOT NULL,
  scope_key    TEXT NOT NULL DEFAULT '',
  fired_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bot_id, contact_id, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_bot_sched_tenant ON bot_schedule_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_sched_bot    ON bot_schedule_runs(bot_id);
