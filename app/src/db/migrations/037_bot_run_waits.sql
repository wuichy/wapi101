-- Tabla para runs suspendidos en un step 'wait_response'.
-- Cuando un bot llega a un step de espera, en vez de bloquear el server con
-- setTimeout, persiste su estado aquí y sale del event loop. Al llegar la
-- señal correspondiente (mensaje del lead, timeout, error de entrega, etc.)
-- el resumeRun lo carga y continúa la ejecución por la rama elegida.
CREATE TABLE IF NOT EXISTS bot_run_waits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id          INTEGER NOT NULL REFERENCES bot_runs(id) ON DELETE CASCADE,
  bot_id          INTEGER NOT NULL REFERENCES salsbots(id) ON DELETE CASCADE,
  contact_id      INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  expedient_id    INTEGER REFERENCES expedients(id) ON DELETE CASCADE,
  -- ID del step (en sbSteps[]._id) donde se suspendió. Lo necesitamos para
  -- saber qué rama tomar al resumir y desde dónde continuar después de la rama.
  wait_step_id    TEXT NOT NULL,
  -- Posición del step en bot.steps (índice 0-based) — para continuar después
  -- de que la rama termine, si está configurada para fluir al siguiente.
  wait_step_index INTEGER NOT NULL DEFAULT 0,
  -- Snapshot del ctx en el momento de suspender (chainDepth, provider, etc.)
  ctx_json        TEXT NOT NULL DEFAULT '{}',
  -- unixepoch en que el wait expira (rama on_timeout)
  expires_at      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','resumed','expired','cancelled')),
  resumed_branch  TEXT,           -- 'on_button_click' | 'on_text_reply' | 'on_timeout' | 'on_delivery_fail'
  resumed_at      INTEGER,
  created_at      INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_bot_run_waits_status_expires ON bot_run_waits(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_bot_run_waits_contact ON bot_run_waits(contact_id, status);
