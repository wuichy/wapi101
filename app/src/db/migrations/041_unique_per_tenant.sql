-- Migration 041: UNIQUE constraints por tenant
--
-- Reemplaza los UNIQUE/PRIMARY KEY globales (heredados de la era pre-multi-tenant)
-- por compuestos (tenant_id, X) para que dos tenants distintos puedan tener
-- valores iguales sin chocar.
--
-- Tablas afectadas:
--   advisors        — UNIQUE(username), UNIQUE(email) → UNIQUE(tenant_id, username|email)
--   bot_tags        — UNIQUE(name) → UNIQUE(tenant_id, name)
--   template_tags   — UNIQUE(name) → UNIQUE(tenant_id, name)
--   app_settings    — PRIMARY KEY(key) → PRIMARY KEY(tenant_id, key)
--
-- En SQLite no se puede ALTER TABLE DROP CONSTRAINT, así que se recrea cada
-- tabla con INSERT SELECT preservando IDs (las FKs siguen apuntando porque
-- los row ids no cambian) y se hace RENAME al nombre original.
--
-- IMPORTANTE: el runner de migrations (src/db/index.js) desactiva
-- foreign_keys ANTES de la transacción de cada migration y los reactiva
-- después con un foreign_key_check de validación. Esto sigue el patrón
-- oficial de SQLite para alteraciones de tablas con FKs:
-- https://www.sqlite.org/lang_altertable.html#otheralter

-- ========== advisors ==========
CREATE TABLE advisors_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  username      TEXT    NOT NULL COLLATE NOCASE,
  email         TEXT    COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'asesor' CHECK(role IN ('admin','asesor')),
  permissions   TEXT    NOT NULL DEFAULT '{"write":true,"delete":false,"manage_advisors":false}',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  tenant_id     INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, username),
  UNIQUE(tenant_id, email)
);
INSERT INTO advisors_new (id, name, username, email, password_hash, role, permissions, active, created_at, tenant_id)
  SELECT id, name, username, email, password_hash, role, permissions, active, created_at, tenant_id
  FROM advisors;
DROP TABLE advisors;
ALTER TABLE advisors_new RENAME TO advisors;
CREATE INDEX idx_advisors_tenant ON advisors(tenant_id);

-- ========== bot_tags ==========
CREATE TABLE bot_tags_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#94a3b8',
  created_at INTEGER DEFAULT (unixepoch()),
  tenant_id  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, name)
);
INSERT INTO bot_tags_new (id, name, color, created_at, tenant_id)
  SELECT id, name, color, created_at, tenant_id FROM bot_tags;
DROP TABLE bot_tags;
ALTER TABLE bot_tags_new RENAME TO bot_tags;

-- ========== template_tags ==========
CREATE TABLE template_tags_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#94a3b8',
  created_at INTEGER DEFAULT (unixepoch()),
  tenant_id  INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, name)
);
INSERT INTO template_tags_new (id, name, color, created_at, tenant_id)
  SELECT id, name, color, created_at, tenant_id FROM template_tags;
DROP TABLE template_tags;
ALTER TABLE template_tags_new RENAME TO template_tags;

-- ========== app_settings ==========
CREATE TABLE app_settings_new (
  tenant_id  INTEGER NOT NULL DEFAULT 1,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, key)
);
INSERT INTO app_settings_new (tenant_id, key, value, updated_at)
  SELECT tenant_id, key, value, updated_at FROM app_settings;
DROP TABLE app_settings;
ALTER TABLE app_settings_new RENAME TO app_settings;
