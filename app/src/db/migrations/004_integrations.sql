-- Integraciones de mensajería: WhatsApp, Messenger, Instagram, TikTok.
-- Las credenciales (tokens, secrets) se guardan cifradas en credentials_enc.

CREATE TABLE IF NOT EXISTS integrations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT NOT NULL,                       -- whatsapp | messenger | instagram | tiktok
  status          TEXT DEFAULT 'disconnected',         -- connected | disconnected | error
  display_name    TEXT,                                -- nombre visible (ej: '+52 5512345678' o 'Mi Página FB')
  external_id     TEXT,                                -- phone_number_id, page_id, ig_user_id, open_id...
  credentials_enc TEXT,                                -- JSON cifrado AES-256-GCM con tokens y secrets
  config          TEXT,                                -- JSON no-secreto (preferencias del usuario)
  last_error      TEXT,
  connected_at    INTEGER,
  created_at      INTEGER DEFAULT (unixepoch()),
  updated_at      INTEGER DEFAULT (unixepoch()),
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_integrations_provider ON integrations(provider);
CREATE INDEX IF NOT EXISTS idx_integrations_status ON integrations(status);

-- Idempotencia de webhooks: nunca procesamos el mismo evento dos veces.
CREATE TABLE IF NOT EXISTS webhook_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  provider       TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  signature_hash TEXT,
  received_at    INTEGER DEFAULT (unixepoch()),
  processed_at   INTEGER,
  payload        TEXT,
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_received ON webhook_events(received_at);
