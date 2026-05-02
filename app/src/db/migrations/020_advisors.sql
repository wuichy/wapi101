CREATE TABLE IF NOT EXISTS advisors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  username     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email        TEXT    UNIQUE COLLATE NOCASE,
  password_hash TEXT   NOT NULL,
  role         TEXT    NOT NULL DEFAULT 'asesor' CHECK(role IN ('admin','asesor')),
  permissions  TEXT    NOT NULL DEFAULT '{"write":true,"delete":false,"manage_advisors":false}',
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS advisor_sessions (
  token        TEXT    PRIMARY KEY,
  advisor_id   INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  expires_at   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Columna advisor_id en expedient_activity
ALTER TABLE expedient_activity ADD COLUMN advisor_id INTEGER REFERENCES advisors(id) ON DELETE SET NULL;
ALTER TABLE expedient_activity ADD COLUMN advisor_name TEXT;
