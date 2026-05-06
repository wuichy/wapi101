-- Migration 046: fuentes de conocimiento para la IA
--
-- Reemplaza el textarea único "Información de la empresa" por una tabla de
-- múltiples fuentes con título y categoría. La IA concatena las fuentes
-- activas como contexto al generar respuestas.
--
-- Migración suave de datos: NO migra automáticamente el textarea existente
-- de app_settings a una nueva fila. Si wuichy quería su info migrada, la
-- copia manualmente desde el textarea anterior. (No la migramos para evitar
-- crear basura en una DB que no haya usado el feature.)

CREATE TABLE IF NOT EXISTS ai_knowledge_sources (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id    INTEGER NOT NULL DEFAULT 1,
  title        TEXT    NOT NULL,
  category     TEXT,
  content      TEXT    NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1,           -- 0|1, permite desactivar sin borrar
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_ai_kb_tenant   ON ai_knowledge_sources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_kb_active   ON ai_knowledge_sources(tenant_id, active, sort_order);
CREATE INDEX IF NOT EXISTS idx_ai_kb_category ON ai_knowledge_sources(tenant_id, category);
