-- Etiquetas para bots (salsbots): entidad propia con color, asignables a múltiples bots.
CREATE TABLE IF NOT EXISTS bot_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#94a3b8',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS salsbot_tag_assignments (
  bot_id INTEGER NOT NULL REFERENCES salsbots(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES bot_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bot_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_salsbot_tag_assignments_tag ON salsbot_tag_assignments(tag_id);
