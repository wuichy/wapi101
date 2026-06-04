-- Analítica de visitantes de la LANDING pública de wapi101.com (no del CRM).
-- Datos a nivel PLATAFORMA (no por tenant) — se ven en /super.
-- Tracker en las páginas públicas → POST /api/track → estas tablas.

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT UNIQUE NOT NULL,        -- uuid persistente en localStorage del visitante
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  utm_content   TEXT,
  referrer      TEXT,
  landing_page  TEXT,                          -- primera página donde aterrizó
  user_agent    TEXT,
  country       TEXT,                          -- ISO-2 vía Cloudflare CF-IPCountry
  region        TEXT,                          -- vía CF-Region (requiere Managed Transform)
  city          TEXT,                          -- vía CF-IPCity
  is_bot        INTEGER NOT NULL DEFAULT 0,    -- detectado por user-agent
  created_at    INTEGER DEFAULT (unixepoch()),
  last_seen_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_vsess_session  ON visitor_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_vsess_created  ON visitor_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_vsess_lastseen ON visitor_sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_vsess_country  ON visitor_sessions(country);

CREATE TABLE IF NOT EXISTS visitor_pageviews (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL,
  path        TEXT NOT NULL,
  title       TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_vpv_session ON visitor_pageviews(session_id);
CREATE INDEX IF NOT EXISTS idx_vpv_created ON visitor_pageviews(created_at);
