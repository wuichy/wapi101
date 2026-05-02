CREATE TABLE IF NOT EXISTS bot_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id       INTEGER NOT NULL REFERENCES salsbots(id) ON DELETE CASCADE,
  bot_name     TEXT,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  expedient_id INTEGER REFERENCES expedients(id) ON DELETE SET NULL,
  trigger_type TEXT,
  status       TEXT DEFAULT 'running' CHECK(status IN ('running','done','error')),
  current_step INTEGER DEFAULT 0,
  total_steps  INTEGER DEFAULT 0,
  error_msg    TEXT,
  started_at   INTEGER DEFAULT (unixepoch()),
  finished_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bot_runs_contact ON bot_runs(contact_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_runs_status  ON bot_runs(status);
