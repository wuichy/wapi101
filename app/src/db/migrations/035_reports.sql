-- Reportes / soporte: form que permite a los asesores enviar bugs, sugerencias
-- o preguntas con archivos adjuntos (foto, video) para iterar el producto.
CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id   INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  advisor_name TEXT,
  type         TEXT NOT NULL DEFAULT 'bug',     -- bug | design | suggestion | question
  priority     TEXT NOT NULL DEFAULT 'medium',  -- low | medium | high | urgent
  title        TEXT NOT NULL,
  body         TEXT,
  attachments  TEXT,                            -- JSON array de URLs locales
  status       TEXT NOT NULL DEFAULT 'open',    -- open | in_progress | resolved | wontfix
  admin_response TEXT,
  created_at   INTEGER DEFAULT (unixepoch()),
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_advisor ON reports(advisor_id);
