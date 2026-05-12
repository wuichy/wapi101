-- Tabla para tokens de "olvidé mi contraseña".
-- El token se guarda hasheado (SHA-256) — nunca en claro — por si la DB es leakeada.
-- Expira en 1 hora.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id   INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  ip_address   TEXT,
  user_agent   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_advisor ON password_reset_tokens(advisor_id);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_expires ON password_reset_tokens(expires_at);
