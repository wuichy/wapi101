-- Migration 047: log de actividad para Dashboard Analytics
--
-- Tabla `activity_log` registra eventos significativos del CRM para que el
-- Dashboard pueda mostrar métricas de productividad por equipo y por asesor.
--
-- kind: tipo de evento. Vocabulario controlado:
--   contact_created     contacto nuevo creado
--   lead_created        lead/expedient creado
--   lead_stage_changed  lead movido de etapa
--   lead_won            lead ganado (etapa kind=won)
--   lead_lost           lead perdido (etapa kind=lost)
--   message_sent        mensaje saliente
--   message_received    mensaje entrante (no se trackea aquí — está en messages.direction)
--   advisor_login       advisor inicia sesión
--   advisor_logout      advisor cierra sesión
--   call_logged         llamada registrada (futuro)
--
-- target_type / target_id: el objeto al que se refiere (contact, expedient, etc).
-- advisor_id: quién hizo la acción. NULL si fue automática (bot, webhook, sistema).

CREATE TABLE IF NOT EXISTS activity_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL DEFAULT 1,
  kind         TEXT NOT NULL,
  advisor_id   INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  target_type  TEXT,                              -- contact | expedient | message | etc
  target_id    INTEGER,
  meta         TEXT,                              -- JSON opcional con datos adicionales
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_kind ON activity_log(tenant_id, kind, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_advisor    ON activity_log(advisor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(tenant_id, created_at);
