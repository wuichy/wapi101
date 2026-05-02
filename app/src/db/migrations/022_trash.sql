CREATE TABLE IF NOT EXISTS trash (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type     TEXT NOT NULL,      -- 'contact' | 'expedient' | 'pipeline' | 'stage'
  entity_id       INTEGER NOT NULL,   -- ID original del registro eliminado
  entity_name     TEXT,               -- Nombre legible para mostrar en UI
  snapshot        TEXT NOT NULL,      -- JSON completo del registro al momento de eliminar
  deleted_by_id   INTEGER,            -- advisor_id que hizo la eliminación
  deleted_by_name TEXT,
  deleted_at      INTEGER DEFAULT (unixepoch()),
  expires_at      INTEGER             -- deleted_at + 2592000 (30 días)
);
CREATE INDEX IF NOT EXISTS idx_trash_entity ON trash(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_trash_expires ON trash(expires_at);
