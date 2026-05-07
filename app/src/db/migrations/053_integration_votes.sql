-- Solicitudes y votos de integraciones futuras.
-- Un advisor puede votar una vez cada 15 días (se inserta nueva fila).
CREATE TABLE integration_votes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id       INTEGER NOT NULL,
  tenant_id        INTEGER NOT NULL,
  integration_key  TEXT    NOT NULL,  -- key del catálogo o 'custom'
  custom_name      TEXT,              -- solo cuando integration_key = 'custom'
  voted_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_int_votes_key     ON integration_votes(integration_key);
CREATE INDEX idx_int_votes_advisor ON integration_votes(advisor_id, voted_at DESC);
