-- Migration 049: asignación de leads a asesores
--
-- Agrega columna assigned_advisor_id a expedients (leads). Cuando un advisor
-- crea un lead manualmente, el sistema lo auto-asigna a ese advisor.
-- Las citas agendadas por bot también pueden asignar el lead al advisor con
-- disponibilidad en ese horario.

ALTER TABLE expedients ADD COLUMN assigned_advisor_id INTEGER REFERENCES advisors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expedients_assigned ON expedients(assigned_advisor_id, tenant_id);
