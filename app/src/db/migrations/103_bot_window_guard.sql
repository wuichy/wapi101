-- Vigilante de la ventana de 24 h (bots con trigger_type='window_24h').
-- Una fila por (bot, lead) con la ÚLTIMA decisión que tomó el vigilante solo.
-- Sirve para dos cosas:
--   1. No mover dos veces al mismo lead (si alguien lo regresa, se respeta).
--   2. No repetir en el historial la misma decisión cada minuto: solo se anota
--      cuando cambia (decisión, motivo o el último mensaje del cliente).
--
-- decision: moved | returned | move_failed | stay | skip
-- reason:   pending | paused | human_only | other_open_lead | not_api | no_convo | no_customer_message

CREATE TABLE IF NOT EXISTS bot_window_guard (
  tenant_id     INTEGER NOT NULL,
  bot_id        INTEGER NOT NULL,
  expedient_id  INTEGER NOT NULL,
  decision      TEXT    NOT NULL,
  reason        TEXT,
  last_in_at    INTEGER,
  slot_at       INTEGER,
  detail        TEXT,
  decided_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bot_id, expedient_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_window_guard_tenant ON bot_window_guard(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_window_guard_exp    ON bot_window_guard(expedient_id);
