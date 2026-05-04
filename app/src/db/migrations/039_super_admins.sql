-- Fase 3 SaaS: super-admin panel.
-- Tabla independiente de advisors — los super-admins administran TENANTS,
-- no datos de un tenant particular. Tienen su propio flujo de login en
-- /super con sesiones aparte (sa_*).

CREATE TABLE IF NOT EXISTS super_admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email         TEXT UNIQUE COLLATE NOCASE,
  -- password_hash usa el mismo formato que advisors (PBKDF2 hex con sha256)
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  -- last_login_at: para auditoría — saber cuándo entró por última vez
  last_login_at INTEGER,
  last_login_ip TEXT,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS super_admin_sessions (
  -- token con prefijo "sa_" — distinto del prefijo de advisor sessions y mt_
  token          TEXT PRIMARY KEY,
  super_admin_id INTEGER NOT NULL REFERENCES super_admins(id) ON DELETE CASCADE,
  expires_at     INTEGER NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  ip             TEXT,
  user_agent     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sa_sessions_admin ON super_admin_sessions(super_admin_id);
CREATE INDEX IF NOT EXISTS idx_sa_sessions_expires ON super_admin_sessions(expires_at);
