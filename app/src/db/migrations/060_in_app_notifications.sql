-- Notificaciones in-app por asesor.
-- Separadas de las push (alert_log/push_subscriptions) que ya existían.
-- Usadas por: handover (bot asigna conversación), lead_assigned, appointment, task_due.

CREATE TABLE IF NOT EXISTS in_app_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL,
  advisor_id  INTEGER NOT NULL,           -- quién la recibe
  type        TEXT    NOT NULL DEFAULT 'general',
  title       TEXT    NOT NULL,
  body        TEXT,
  link        TEXT,                        -- URL destino al hacer click
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ian_advisor
  ON in_app_notifications(advisor_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ian_tenant
  ON in_app_notifications(tenant_id, created_at DESC);
