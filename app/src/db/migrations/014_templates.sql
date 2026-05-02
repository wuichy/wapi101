CREATE TABLE IF NOT EXISTS message_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT    NOT NULL DEFAULT 'free_form', -- 'wa_api' | 'free_form'
  name          TEXT    NOT NULL,
  display_name  TEXT,
  category      TEXT    DEFAULT 'UTILITY',   -- MARKETING | UTILITY | AUTHENTICATION
  language      TEXT    DEFAULT 'es_MX',
  header        TEXT,
  body          TEXT    NOT NULL,
  footer        TEXT,
  wa_status     TEXT    DEFAULT 'draft',     -- draft | pending | approved | rejected
  wa_id         TEXT,                        -- ID de Meta tras enviar
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);
