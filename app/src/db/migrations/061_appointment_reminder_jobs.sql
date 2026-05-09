-- Jobs programados por el step 'reminder_timer'.
-- Cada rama del step genera un job que se ejecuta en fire_at.
-- El poller revisa cada minuto y ejecuta los sub-steps de cada job vencido.

CREATE TABLE IF NOT EXISTS appointment_reminder_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL,
  bot_id       INTEGER NOT NULL,
  run_id       INTEGER,
  contact_id   INTEGER,
  expedient_id INTEGER,
  convo_id     INTEGER,
  reminder_id  TEXT    NOT NULL,   -- ID de la rama en el config del step
  steps_json   TEXT    NOT NULL,   -- JSON con los sub-steps a ejecutar
  ctx_json     TEXT    NOT NULL DEFAULT '{}',
  fire_at      INTEGER NOT NULL,   -- unixepoch cuando debe ejecutarse
  fired        INTEGER NOT NULL DEFAULT 0,
  fired_at     INTEGER,
  skipped      INTEGER NOT NULL DEFAULT 0,
  skip_reason  TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_appt_rj_fire
  ON appointment_reminder_jobs(fired, skipped, fire_at);

CREATE INDEX IF NOT EXISTS idx_appt_rj_contact
  ON appointment_reminder_jobs(contact_id, fired);
