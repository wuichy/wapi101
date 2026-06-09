-- IA por etapa del pipeline.
-- Si ai_enabled = 1, la IA (fallback) responde automáticamente a los leads que
-- están en esa etapa, SIEMPRE respetando las reglas existentes: modo humano /
-- takeover del asesor, bots con waits activos, y el master ia_fallback_enabled
-- del tenant. OFF por defecto: la IA no responde en una etapa hasta que el
-- usuario prende el toggle de esa columna.
ALTER TABLE stages ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 0;
