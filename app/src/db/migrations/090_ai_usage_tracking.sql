-- Tracking del consumo de IA por tenant.
--
-- Cada vez que aiSvc.callAI termina con éxito, se inserta una fila aquí
-- con los tokens consumidos y el costo estimado en USD.
--
-- También guardamos el "saldo cargado" por el tenant (lo ingresa
-- manualmente desde Settings → IA) para calcular el restante estimado.

-- ─── Tabla de log de uso ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL,
  provider        TEXT NOT NULL,           -- 'anthropic' | 'openai' | 'google' | 'ollama'
  model           TEXT,                    -- modelo exacto (claude-haiku-4-5..., gpt-4o-mini, etc.)
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  cost_usd        REAL DEFAULT 0,          -- costo calculado en USD (estimado)
  kind            TEXT,                    -- 'matcher' | 'fallback' | 'ai_reply' | 'copilot' | 'other'
  created_at      INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_time
  ON ai_usage_log(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_kind
  ON ai_usage_log(tenant_id, kind);

-- ─── Saldo cargado por el tenant (manual) ───────────────────────────
ALTER TABLE tenants ADD COLUMN ai_credit_loaded_usd REAL DEFAULT 0;
ALTER TABLE tenants ADD COLUMN ai_credit_loaded_at INTEGER;
-- ai_credit_low_alert_threshold: si el restante baja de este valor, alertar
ALTER TABLE tenants ADD COLUMN ai_credit_alert_threshold_usd REAL DEFAULT 5;
