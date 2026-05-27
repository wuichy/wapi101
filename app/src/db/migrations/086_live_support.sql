-- Live Support — co-browsing con rrweb.
--
-- Cuando un asesor/tenant tiene un problema, da click a "Compartir mi sesión"
-- en Settings → Soporte. Se genera un código corto (ej XQ7-K42) que él lee
-- al super-admin por teléfono. El super-admin entra a /super#live-support,
-- pega el código y ve el navegador del cliente en cuasi tiempo real con
-- cursor rojo visible.
--
-- Datos:
--   token       — código corto legible (formato XQ7-K42, 6 chars + dash)
--                 Único activo a la vez (tabla UNIQUE pero re-usable cuando
--                 status='ended'). En la práctica generamos 7 chars del
--                 alfabeto SAFE_ALPHABET para evitar confusión (no 0/O/1/I).
--   tenant_id  — el tenant del cliente (para identificación rápida)
--   advisor_id — el asesor específico que inició la sesión
--   status     — 'active' | 'ended' | 'expired'
--   viewer_jwt — opcional, JWT del super-admin que se conectó (para audit)

CREATE TABLE IF NOT EXISTS live_support_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token           TEXT NOT NULL,                    -- ej. 'XQ7-K42'
  tenant_id       INTEGER NOT NULL,
  advisor_id      INTEGER,                          -- nullable si es admin del tenant
  client_label    TEXT,                             -- snapshot del nombre del advisor
  status          TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'ended' | 'expired'
  viewer_label    TEXT,                             -- snapshot del super-admin que se conectó
  user_agent      TEXT,                             -- info del browser del cliente
  started_at      INTEGER DEFAULT (unixepoch()),
  ended_at        INTEGER,
  last_event_at   INTEGER,                          -- timestamp último chunk rrweb recibido
  event_count     INTEGER DEFAULT 0
);

-- Solo UN token activo a la vez por valor (sesiones ended pueden re-usarse
-- después, pero en la práctica generamos nuevo cada vez).
CREATE UNIQUE INDEX IF NOT EXISTS idx_lss_token_active
  ON live_support_sessions(token) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_lss_status ON live_support_sessions(status);
CREATE INDEX IF NOT EXISTS idx_lss_tenant ON live_support_sessions(tenant_id);
