-- Webhooks salientes: notificar URLs externas cuando ocurren eventos en la app.
CREATE TABLE IF NOT EXISTS outgoing_webhooks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT 'Webhook',
  url        TEXT NOT NULL,
  events     TEXT NOT NULL DEFAULT '["message.received"]',
  active     INTEGER DEFAULT 1,
  secret_enc TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Estados OAuth temporales para el flujo de autorización.
CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  extra      TEXT DEFAULT '{}',
  created_at INTEGER DEFAULT (unixepoch())
);
