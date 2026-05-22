-- Fix: la tabla `app_installs` ya existía en producción (del marketplace
-- antiguo con marketplace_apps), entonces nuestra migration 080 hizo
-- IF NOT EXISTS y no creó las columnas nuevas (revoked_at, scopes_granted, etc).
-- Solución: usar un nombre con prefijo dev_ que no colisione.

CREATE TABLE IF NOT EXISTS dev_app_installs (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id                  INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id               INTEGER NOT NULL,
  installed_by_advisor_id INTEGER,
  scopes_granted          TEXT    NOT NULL DEFAULT '[]',
  installed_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at              INTEGER,
  revoked_reason          TEXT,
  UNIQUE(app_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_dev_app_installs_tenant ON dev_app_installs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dev_app_installs_app    ON dev_app_installs(app_id);
