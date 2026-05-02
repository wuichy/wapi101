CREATE TABLE IF NOT EXISTS expedient_activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expedient_id INTEGER NOT NULL REFERENCES expedients(id) ON DELETE CASCADE,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  type         TEXT NOT NULL,
  description  TEXT NOT NULL,
  metadata     TEXT,
  created_at   INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_exp_activity_exp ON expedient_activity(expedient_id, created_at ASC);
