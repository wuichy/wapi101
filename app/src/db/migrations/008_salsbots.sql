-- Salsbots: bots de flujo de conversación automática.
-- Cada bot tiene un disparador y una lista de pasos (JSON).
CREATE TABLE IF NOT EXISTS salsbots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 0,
  trigger_type TEXT    NOT NULL DEFAULT 'keyword',  -- keyword | new_contact | pipeline_stage
  trigger_value TEXT,
  steps        TEXT    NOT NULL DEFAULT '[]',        -- JSON array of step objects
  created_at   INTEGER DEFAULT (unixepoch()),
  updated_at   INTEGER DEFAULT (unixepoch())
);
