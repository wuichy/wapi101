-- Migration 045: módulo de Recordatorios / Tareas
--
-- Tabla `tasks` para que los advisors creen recordatorios con fecha,
-- asignación a advisors, vinculación opcional a leads (expedients) o
-- contactos. Las tareas vencidas se marcan en rojo en cards de leads.
--
-- Multi-tenant: cada tarea pertenece a un tenant. El advisor que la crea
-- y el advisor asignado pueden ser distintos (asignación entre miembros
-- del equipo). Si la tarea está vinculada a un lead, ese lead debe ser
-- del mismo tenant (no se valida en DB con FK porque expedients tiene
-- ON DELETE SET NULL según patrón del proyecto).

CREATE TABLE IF NOT EXISTS tasks (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id               INTEGER NOT NULL DEFAULT 1,
  title                   TEXT    NOT NULL,
  description             TEXT,
  due_at                  INTEGER NOT NULL,                 -- unix ts
  assigned_advisor_id     INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  expedient_id            INTEGER REFERENCES expedients(id) ON DELETE SET NULL,
  contact_id              INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  completed               INTEGER NOT NULL DEFAULT 0,       -- 0|1
  completed_at            INTEGER,
  created_by_advisor_id   INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tasks_tenant       ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned     ON tasks(assigned_advisor_id);
CREATE INDEX IF NOT EXISTS idx_tasks_expedient    ON tasks(expedient_id);
CREATE INDEX IF NOT EXISTS idx_tasks_contact      ON tasks(contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_at       ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_completed    ON tasks(completed, due_at);

-- Switch global del módulo: si tasks_enabled='false' en app_settings, el
-- frontend oculta la sección Recordatorios para este tenant. Default true
-- (módulo activo). Se setea solo si no existe.
INSERT OR IGNORE INTO app_settings (tenant_id, key, value)
SELECT id, 'tasks_enabled', '{"value": true}' FROM tenants;
