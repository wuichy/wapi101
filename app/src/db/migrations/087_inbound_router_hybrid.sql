-- Híbrido IA + Bots — el "inbound router" que decide quién contesta cada
-- mensaje entrante para que la IA y los bots NUNCA choquen.
--
-- Concepto clave: cada conversación tiene un "owner" en cada momento.
-- Solo el owner puede responder. Owners posibles:
--   - human          → asesor humano (manualmente o porque mandó msg reciente)
--   - bot_running    → un bot tiene un wait activo (espera msg o timer)
--   - ai_active      → IA libre contesta porque nada anterior aplicó
--   - idle           → nadie (default)
--
-- El owner no se guarda explícito: se DEDUCE en cada msg entrante con este
-- pipeline en orden estricto:
--   [1] ¿Asesor humano activo? (last_human_msg_at < ventana)  → human, fin
--   [2] ¿Bot con wait activo en bot_run_waits?                  → bot_running
--   [3] ¿Algún trigger de bot matchea (matcher IA)?             → bot_running nuevo
--   [4] ¿IA habilitada para el tenant?                          → ai_active
--   [5] idle (no hace nada)
--
-- Lo que sí guardamos:
--   - conversations.ai_mode           — switch manual del asesor: auto/off/human_lock
--   - conversations.last_human_msg_at — para calcular ventana humano
--   - conversations.last_ai_msg_at    — telemetría/debug
--   - conversations.human_takeover_until — modo humano permanente con timeout
--
-- En bot_run_waits agregamos:
--   - wait_kind            — response | timer | scheduled (los 3 tipos distintos)
--   - on_message_behavior  — cancel | branch | ignore  (qué hacer cuando llega
--                            mensaje del cliente DURANTE un wait_timer)
--   - branch_step_id       — el step destino si behavior='branch'
--   - expected_state_snapshot — para waits scheduled (24h cambio pipeline) —
--                              snapshot del stage al programar; si cambió, cancela.

-- ─── conversations: columnas para ownership/takeover ─────────────────
ALTER TABLE conversations ADD COLUMN ai_mode TEXT DEFAULT 'auto';
-- 'auto' (pipeline normal), 'off' (silencia IA, bots siguen), 'human_lock' (silencia todo)

ALTER TABLE conversations ADD COLUMN last_human_msg_at INTEGER;
ALTER TABLE conversations ADD COLUMN last_ai_msg_at INTEGER;
ALTER TABLE conversations ADD COLUMN human_takeover_until INTEGER;
-- unixepoch hasta el cual el modo humano permanente está activo (null = no activo)

CREATE INDEX IF NOT EXISTS idx_conv_human_takeover
  ON conversations(human_takeover_until)
  WHERE human_takeover_until IS NOT NULL;

-- ─── bot_run_waits: distinguir los 3 tipos + comportamiento on_message ─
ALTER TABLE bot_run_waits ADD COLUMN wait_kind TEXT DEFAULT 'response';
-- 'response' — espera mensaje del cliente (default, como hoy)
-- 'timer'    — espera tiempo determinado, msg del cliente puede interrumpir
-- 'scheduled'— acción programada a futuro (ej. mover pipeline en 24h)

ALTER TABLE bot_run_waits ADD COLUMN on_message_behavior TEXT DEFAULT 'cancel';
-- Aplica solo cuando wait_kind='timer':
--   'cancel' (default) — si cliente escribe antes del timer, cancela y reentra
--                        al pipeline (matcher IA + bots + IA libre)
--   'branch'           — si cliente escribe antes, va a branch_step_id
--   'ignore'           — completa el timer ignorando msgs del cliente

ALTER TABLE bot_run_waits ADD COLUMN branch_step_id TEXT;
-- ID del step destino cuando on_message_behavior='branch'

ALTER TABLE bot_run_waits ADD COLUMN expected_state_snapshot TEXT;
-- JSON snapshot del estado relevante al momento de programar el wait_scheduled.
-- Ej: {"expedient_id":123,"stage_id":5}. Al ejecutar, comparas. Si cambió,
-- cancelas silenciosamente (otro bot ya movió el lead, no pisar).

-- ─── tenants: defaults del híbrido ───────────────────────────────────
ALTER TABLE tenants ADD COLUMN ia_hybrid_enabled INTEGER DEFAULT 0;
-- 0 = comportamiento legacy (matcher exacto + IA puede chocar)
-- 1 = inbound router activo (pipeline 5 pasos, sin choque)

ALTER TABLE tenants ADD COLUMN ia_matcher_enabled INTEGER DEFAULT 0;
-- 0 = triggers de bot solo por texto/regex exacto (como hoy)
-- 1 = matcher IA (Haiku) evalúa intent semánticamente

ALTER TABLE tenants ADD COLUMN ia_fallback_enabled INTEGER DEFAULT 0;
-- 0 = si ningún bot matchea, nadie responde (como hoy)
-- 1 = IA libre contesta cuando ningún bot matchea

ALTER TABLE tenants ADD COLUMN human_takeover_window_min INTEGER DEFAULT 15;
-- Minutos desde el último msg del asesor durante los cuales la convo queda
-- en modo humano (IA y bots muteados).

-- ─── Tabla de cache del matcher IA ───────────────────────────────────
-- Para no llamar al LLM por el mismo mensaje N veces. La key es hash del
-- texto normalizado + tenant_id (los bots del tenant). TTL 24h.
CREATE TABLE IF NOT EXISTS bot_matcher_cache (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL,
  msg_hash     TEXT NOT NULL,            -- sha1 del texto normalizado
  bot_id       INTEGER,                  -- null si ningún bot match
  confidence   REAL,                     -- 0.0–1.0 (debug/telemetría)
  created_at   INTEGER DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matcher_cache_lookup
  ON bot_matcher_cache(tenant_id, msg_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_matcher_cache_expires
  ON bot_matcher_cache(expires_at);

-- ─── Log del router (telemetría — qué decidió en cada mensaje) ───────
-- Útil para debuggear "por qué la IA no contestó" o "por qué el bot X
-- disparó cuando no debía". Retención 7 días.
CREATE TABLE IF NOT EXISTS inbound_router_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  conversation_id INTEGER,
  message_id      INTEGER,                -- ref a messages.id si aplica
  decision        TEXT NOT NULL,          -- 'human' | 'bot_resume' | 'bot_start' | 'ai_active' | 'idle'
  reason          TEXT,                   -- explicación corta para debug
  bot_id          INTEGER,                -- bot que ganó (si decision empieza con bot_)
  matcher_used    INTEGER DEFAULT 0,      -- 1 si se usó matcher IA, 0 si regex
  matcher_ms      INTEGER,                -- latencia del matcher en ms
  created_at      INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_router_log_conv
  ON inbound_router_log(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_router_log_tenant_time
  ON inbound_router_log(tenant_id, created_at);
