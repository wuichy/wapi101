-- Pipelines
CREATE TABLE IF NOT EXISTS pipelines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#2563eb',
  sort_order  INTEGER DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- Stages (etapas) de cada pipeline
CREATE TABLE IF NOT EXISTS stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#94a3b8',
  sort_order  INTEGER DEFAULT 0,
  kind        TEXT DEFAULT 'in_progress' CHECK (kind IN ('in_progress','won','lost'))
);
CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON stages(pipeline_id);

-- Contacts (clientes)
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT,
  phone       TEXT,
  email       TEXT,
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);

-- Tags por contacto (1:N)
CREATE TABLE IF NOT EXISTS contact_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag         TEXT NOT NULL,
  UNIQUE(contact_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);

-- Leads (un contacto puede tener varios leads en pipelines distintos)
CREATE TABLE IF NOT EXISTS leads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id),
  stage_id    INTEGER NOT NULL REFERENCES stages(id),
  name        TEXT,
  value       REAL DEFAULT 0,
  created_at  INTEGER DEFAULT (unixepoch()),
  updated_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_leads_contact ON leads(contact_id);
CREATE INDEX IF NOT EXISTS idx_leads_pipeline ON leads(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage_id);
