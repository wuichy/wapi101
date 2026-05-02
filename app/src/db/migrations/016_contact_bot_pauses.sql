-- Pausa individual de bots por contacto
CREATE TABLE IF NOT EXISTS contact_bot_pauses (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  bot_id     INTEGER NOT NULL REFERENCES salsbots(id) ON DELETE CASCADE,
  paused     INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (contact_id, bot_id)
);
