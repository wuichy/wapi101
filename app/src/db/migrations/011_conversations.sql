-- Conversaciones: un hilo entre un contacto y un canal
CREATE TABLE IF NOT EXISTS conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id      INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  integration_id  INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  provider        TEXT NOT NULL,
  external_id     TEXT,              -- e.g. wa_id (número E.164 del remitente)
  last_message_at INTEGER DEFAULT (unixepoch()),
  last_message    TEXT,
  unread_count    INTEGER DEFAULT 0,
  bot_paused      INTEGER DEFAULT 0,
  created_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_convos_contact ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_convos_last    ON conversations(last_message_at DESC);

-- Mensajes individuales
CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  external_id     TEXT,
  direction       TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  provider        TEXT NOT NULL,
  body            TEXT,
  media_url       TEXT,
  status          TEXT DEFAULT 'sent',
  created_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_ext   ON messages(provider, external_id);
