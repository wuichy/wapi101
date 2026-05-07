-- Estado del poller IMAP por integración (último UID procesado).
CREATE TABLE email_imap_state (
  integration_id INTEGER PRIMARY KEY,
  last_uid       INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
