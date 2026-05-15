-- Jobs en background para operaciones largas (mover masivo de leads,
-- eliminación masiva, etc.). El worker corre en el server y sobrevive
-- el cierre del navegador del usuario.
CREATE TABLE IF NOT EXISTS bulk_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL,
  type        TEXT NOT NULL,                 -- 'expedients_move' | 'expedients_delete' | etc.
  payload     TEXT NOT NULL,                 -- JSON con los args del job
  total       INTEGER NOT NULL DEFAULT 0,    -- total de items a procesar
  processed   INTEGER NOT NULL DEFAULT 0,    -- cuántos llevamos OK
  failed      INTEGER NOT NULL DEFAULT 0,    -- cuántos fallaron
  status      TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | error | cancelled
  label       TEXT,                          -- texto humano para la barra ("Moviendo 653 leads a HOTSALE")
  error_msg   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_status ON bulk_jobs(status);
CREATE INDEX IF NOT EXISTS idx_bulk_jobs_tenant ON bulk_jobs(tenant_id, created_at DESC);
