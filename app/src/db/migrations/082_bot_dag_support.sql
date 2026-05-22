-- Soporte para bots en formato DAG (Directed Acyclic Graph)
-- ============================================================================
-- Los bots se siguen guardando en la columna `steps` (TEXT JSON), pero ahora
-- aceptan dos formas:
--   1) Array (formato viejo, "list"):     [ {step}, {step}, ... ]
--   2) Objeto (formato nuevo, "dag"):     { "nodes": [...], "edges": [...] }
--
-- El engine detecta el formato y dispatcha. Esto mantiene compatibilidad total
-- con bots existentes sin requerir migración inmediata.
--
-- Para resumir bots pausados (waits) en formato DAG necesitamos guardar el
-- node_id en lugar del wait_step_index. La columna nueva permite ambos.

ALTER TABLE bot_run_waits ADD COLUMN wait_node_id TEXT DEFAULT NULL;

-- Index opcional para queries de resume
CREATE INDEX IF NOT EXISTS idx_bot_run_waits_node ON bot_run_waits(wait_node_id) WHERE wait_node_id IS NOT NULL;
