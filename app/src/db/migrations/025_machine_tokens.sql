-- Tokens de máquina: credenciales bearer para API access desde devices del admin.
-- Permiten kill-switch (revoke individual o masivo) si se pierde un dispositivo.
-- El plaintext se entrega UNA SOLA VEZ al crear; se guarda solo el sha256 hash.

CREATE TABLE IF NOT EXISTS machine_tokens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  token_hash    TEXT    NOT NULL UNIQUE,
  prefix        TEXT    NOT NULL,
  created_at    INTEGER DEFAULT (unixepoch()),
  created_by    INTEGER REFERENCES advisors(id),
  last_used_at  INTEGER,
  last_used_ip  TEXT,
  revoked_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_machine_tokens_hash ON machine_tokens(token_hash);
