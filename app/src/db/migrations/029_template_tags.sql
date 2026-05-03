-- Etiquetas para plantillas (mismo patrón que bot_tags).
-- Permite agrupar/filtrar plantillas por tag (ej: "promo", "transaccional",
-- "navidad", "borrar mes que viene").

CREATE TABLE IF NOT EXISTS template_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  color      TEXT    NOT NULL DEFAULT '#94a3b8',
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS template_tag_assignments (
  template_id INTEGER NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES template_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_template_tag_assignments_tag ON template_tag_assignments(tag_id);
