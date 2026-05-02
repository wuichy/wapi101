-- Suscripciones de Web Push (VAPID).
-- Cada navegador/dispositivo guarda una entry. Endpoint es único.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint     TEXT NOT NULL UNIQUE,
  keys         TEXT NOT NULL,           -- JSON {p256dh, auth}
  user_agent   TEXT,
  advisor_id   INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  created_at   INTEGER DEFAULT (unixepoch()),
  last_seen_at INTEGER DEFAULT (unixepoch()),
  fail_count   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subs_advisor ON push_subscriptions(advisor_id);

-- Bitácora de alertas para diagnóstico (qué se envió, cuándo, a cuántos).
CREATE TABLE IF NOT EXISTS alert_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,             -- 'integration_down' | 'integration_recovered' | 'message' | 'manual' | etc
  title      TEXT,
  body       TEXT,
  payload    TEXT,                      -- JSON con detalles
  sent_count INTEGER DEFAULT 0,
  failed     INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_alert_log_kind_created ON alert_log(kind, created_at);
