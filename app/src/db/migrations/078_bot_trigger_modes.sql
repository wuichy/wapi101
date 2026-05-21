-- Migration 078: Modos del trigger pipeline_stage (created / moved)
--
-- Hasta hoy el trigger `pipeline_stage` disparaba sin distinguir si el lead
-- fue CREADO en esa etapa o MOVIDO/ARRASTRADO a ella. Ahora cada bot puede
-- elegir explícitamente en qué modos quiere ejecutarse.
--
-- Valor del campo:
--   • NULL o vacío → equivale a ["created","moved"] (ambos, comportamiento
--     histórico de los bots existentes — compatibilidad total).
--   • '["created"]'         → solo cuando el lead se crea ahí
--   • '["moved"]'           → solo cuando el lead se mueve ahí
--   • '["created","moved"]' → ambos (explícito)

ALTER TABLE salsbots ADD COLUMN trigger_modes TEXT;
-- No backfill necesario: NULL ya significa "ambos" por la lógica del engine.
