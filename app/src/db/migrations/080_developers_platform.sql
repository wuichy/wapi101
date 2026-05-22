-- Developers Platform — Fase 1: Foundation
-- ============================================================================
-- Tablas para soportar:
--   - Developer accounts (separados de advisors/tenants; un dev no es cliente)
--   - Apps que cada dev crea (con client_id/secret tipo OAuth)
--   - Instalaciones de apps por tenant (cliente final autoriza una app)
--   - OAuth 2.0 codes + tokens (authorization_code + access + refresh)
--   - Audit log de uso de cada app

-- ── Developer accounts ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dev_accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  company         TEXT,
  country         TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  last_login_at   INTEGER,
  last_login_ip   TEXT
);

CREATE TABLE IF NOT EXISTS dev_sessions (
  token           TEXT    PRIMARY KEY,
  dev_account_id  INTEGER NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  ip              TEXT,
  user_agent      TEXT
);
CREATE INDEX IF NOT EXISTS idx_dev_sessions_dev ON dev_sessions(dev_account_id);

-- ── Apps ────────────────────────────────────────────────────────────────────
-- status:
--   draft     → solo visible para su dev, no se puede instalar
--   in_review → enviada para revisión Wapi (todavía instalable solo por su dev)
--   approved  → aprobada, pública en marketplace si is_public=1
--   rejected  → rechazada (rejection_reason explica)
--   suspended → suspendida por abuso/seguridad
CREATE TABLE IF NOT EXISTS apps (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  dev_account_id      INTEGER NOT NULL REFERENCES dev_accounts(id) ON DELETE CASCADE,
  name                TEXT    NOT NULL,
  slug                TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  short_description   TEXT,
  description         TEXT,           -- markdown long
  icon_url            TEXT,
  client_id           TEXT    NOT NULL UNIQUE,
  client_secret_hash  TEXT    NOT NULL,     -- argon2/scrypt hash del secret
  redirect_uris       TEXT    NOT NULL DEFAULT '[]', -- JSON array
  scopes_requested    TEXT    NOT NULL DEFAULT '[]', -- JSON array
  webhook_url         TEXT,
  webhook_secret      TEXT,           -- HMAC secret para firmar webhooks
  webhook_events      TEXT    NOT NULL DEFAULT '[]', -- JSON array de eventos suscritos
  homepage_url        TEXT,
  privacy_policy_url  TEXT,
  category            TEXT,           -- crm / pagos / email / sms / productividad / otros
  status              TEXT    NOT NULL DEFAULT 'draft'
                                CHECK(status IN ('draft','in_review','approved','rejected','suspended')),
  is_public           INTEGER NOT NULL DEFAULT 0,  -- visible en marketplace
  rejection_reason    TEXT,
  suspended_reason    TEXT,
  rate_limit_per_min  INTEGER NOT NULL DEFAULT 600, -- default 10 req/sec
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_apps_dev    ON apps(dev_account_id);
CREATE INDEX IF NOT EXISTS idx_apps_status ON apps(status);
CREATE INDEX IF NOT EXISTS idx_apps_public ON apps(is_public, status) WHERE is_public = 1;

-- ── App installs ────────────────────────────────────────────────────────────
-- Cada vez que un cliente final autoriza una app vía OAuth, se crea un install
-- linking app ↔ tenant. La revocación se hace marcando revoked_at.
CREATE TABLE IF NOT EXISTS app_installs (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id                  INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id               INTEGER NOT NULL,
  installed_by_advisor_id INTEGER, -- quién autorizó el OAuth (advisor del tenant)
  scopes_granted          TEXT    NOT NULL DEFAULT '[]',
  installed_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at              INTEGER,
  revoked_reason          TEXT,
  UNIQUE(app_id, tenant_id)  -- una app solo se instala una vez por tenant (re-instalación = reactivar)
);
CREATE INDEX IF NOT EXISTS idx_app_installs_tenant ON app_installs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_app_installs_app    ON app_installs(app_id);

-- ── OAuth 2.0 authorization codes ───────────────────────────────────────────
-- Códigos temporales (10 min TTL) emitidos en /oauth/authorize, canjeables
-- por access_token en /oauth/token. One-shot — al usar se marca used=1.
CREATE TABLE IF NOT EXISTS app_oauth_codes (
  code         TEXT    PRIMARY KEY,
  app_id       INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id    INTEGER NOT NULL,
  advisor_id   INTEGER NOT NULL,
  redirect_uri TEXT    NOT NULL,
  scopes       TEXT    NOT NULL DEFAULT '[]',
  state        TEXT,                -- echo back para CSRF protection
  expires_at   INTEGER NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0,
  used_at      INTEGER,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON app_oauth_codes(expires_at);

-- ── OAuth 2.0 access tokens ─────────────────────────────────────────────────
-- Tokens reales que las apps usan en `Authorization: Bearer X` para llamar
-- la API. Tienen TTL corto (1 hora). Refresh token con TTL largo (90 días).
CREATE TABLE IF NOT EXISTS app_oauth_tokens (
  token              TEXT    PRIMARY KEY,
  refresh_token      TEXT    UNIQUE,
  install_id         INTEGER NOT NULL REFERENCES app_installs(id) ON DELETE CASCADE,
  scopes             TEXT    NOT NULL DEFAULT '[]',
  expires_at         INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  revoked_at         INTEGER,
  last_used_at       INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_install ON app_oauth_tokens(install_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON app_oauth_tokens(refresh_token) WHERE refresh_token IS NOT NULL;

-- ── Audit log de llamadas API por app ──────────────────────────────────────
-- Para detección de abuso, rate limit, debugging del dev y compliance.
-- Se llena por middleware en cada request autenticado con OAuth token.
-- Se limpia periódicamente (cron: borrar > 30 días).
CREATE TABLE IF NOT EXISTS app_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id      INTEGER NOT NULL,
  install_id  INTEGER,
  tenant_id   INTEGER,
  method      TEXT,
  path        TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  ip          TEXT,
  error_msg   TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_app_audit_app_time  ON app_audit_log(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_audit_tenant    ON app_audit_log(tenant_id, created_at DESC);

-- ── Webhook delivery queue ──────────────────────────────────────────────────
-- Cola para mandar eventos a apps suscritas. Se popula desde el código que
-- detecta eventos (ej. lead.created). El worker la procesa con retry.
CREATE TABLE IF NOT EXISTS app_webhook_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id          INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  install_id      INTEGER NOT NULL REFERENCES app_installs(id) ON DELETE CASCADE,
  tenant_id       INTEGER NOT NULL,
  event_type      TEXT    NOT NULL,
  payload_json    TEXT    NOT NULL,
  url             TEXT    NOT NULL,        -- snapshot del webhook_url al momento
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','sent','failed','giving_up')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_retry_at   INTEGER,
  last_attempt_at INTEGER,
  last_status_code INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status_retry
  ON app_webhook_deliveries(status, next_retry_at)
  WHERE status IN ('pending','failed');
