-- Etiquetas de expedientes (separadas de las de contactos)
CREATE TABLE IF NOT EXISTS expedient_tags (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  expedient_id INTEGER NOT NULL REFERENCES expedients(id) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  UNIQUE(expedient_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_exp_tags_exp ON expedient_tags(expedient_id);

-- Definiciones de campos personalizados (por tipo de entidad: expedient | contact)
CREATE TABLE IF NOT EXISTS custom_field_defs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL DEFAULT 'expedient',
  label      TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',  -- text | number | toggle | select | multi_select | date | url | long_text | birthday | datetime
  options    TEXT,                           -- JSON array para select / multi_select
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_cfd_entity ON custom_field_defs(entity, sort_order);

-- Valores de campos personalizados por registro
CREATE TABLE IF NOT EXISTS custom_field_values (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity    TEXT NOT NULL DEFAULT 'expedient',
  record_id INTEGER NOT NULL,
  field_id  INTEGER NOT NULL REFERENCES custom_field_defs(id) ON DELETE CASCADE,
  value     TEXT,
  UNIQUE(entity, record_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_cfv_record ON custom_field_values(entity, record_id);
