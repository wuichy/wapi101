-- Configuración global del sistema (no pertenece a ningún tenant).
-- Almacena pares key→value JSON para settings como mail_config, smtp, etc.
CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
