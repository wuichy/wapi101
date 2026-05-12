-- Distinguir pausas naturales (timer, wait_response) de pausas manuales del usuario.
-- Cuando es manual: paused_manually=1, paused_at=unixepoch(), y bot_run_waits guarda
-- los segundos restantes para que al reanudar se ajuste expires_at correctamente.

ALTER TABLE bot_runs ADD COLUMN paused_manually INTEGER DEFAULT 0;
ALTER TABLE bot_runs ADD COLUMN paused_at       INTEGER DEFAULT NULL;

ALTER TABLE bot_run_waits ADD COLUMN paused_remaining INTEGER DEFAULT NULL;
