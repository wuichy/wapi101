-- Migration 077: Soporte para import de chats históricos
--
-- Dos modos de import:
--   • Modo A (histórico): inserta mensajes a la tabla `messages` con flag
--     `imported_from` para distinguirlos. No disparan bots, no cuentan como
--     no-leídos, se muestran con badge "Histórico" en la UI.
--   • Modo C (knowledge base IA): parsea conversaciones en pares Q+A y los
--     guarda en `ai_chat_chunks` para que el copiloto los use como contexto
--     al sugerir respuestas. NO van a la tabla messages.

-- ─── Flag de origen en messages (Modo A) ─────────────────────────────
ALTER TABLE messages ADD COLUMN imported_from TEXT;     -- 'kommo' | 'hubspot' | 'csv' | 'json'
ALTER TABLE messages ADD COLUMN imported_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_messages_imported ON messages(tenant_id, imported_from);

-- ─── Tabla de pares Q+A para el copiloto IA (Modo C) ──────────────────
-- Cada fila es un par "lo que dijo el cliente" → "lo que respondió tu equipo".
-- El copiloto busca pares similares cuando llega un mensaje nuevo y los pasa
-- a Claude como ejemplos de cómo responder.
CREATE TABLE IF NOT EXISTS ai_chat_chunks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL,

  -- Contexto del chunk
  source              TEXT NOT NULL,         -- 'kommo' | 'manual' | etc.
  source_chat_id      TEXT,                  -- agrupar chunks del mismo chat
  contact_id          INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  contact_phone       TEXT,
  contact_name        TEXT,

  -- El par Q+A
  customer_message    TEXT NOT NULL,         -- texto del cliente
  agent_response      TEXT NOT NULL,         -- respuesta del equipo
  context_before      TEXT,                  -- 1-2 mensajes previos para contexto (JSON array)

  -- Embedding (vacío por ahora — se calcula on-demand cuando el copilot lo necesite)
  embedding_vector    BLOB,
  embedding_model     TEXT,                  -- 'voyage-3' | 'text-embedding-3-small' etc

  -- Metadata
  created_at_original INTEGER,               -- cuándo pasó originalmente
  imported_at         INTEGER DEFAULT (unixepoch()),
  topic_tags          TEXT,                  -- ['precio', 'envío', 'producto'] — para filtrar
  quality_score       REAL DEFAULT 1.0,      -- 0-1 — el copiloto puede preferir los mejor calificados

  UNIQUE(tenant_id, source_chat_id, customer_message)
);

CREATE INDEX IF NOT EXISTS idx_aicc_tenant       ON ai_chat_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aicc_source       ON ai_chat_chunks(tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_aicc_contact      ON ai_chat_chunks(contact_id);
-- Para búsqueda textual rápida sin embeddings (fallback)
CREATE INDEX IF NOT EXISTS idx_aicc_customer_msg ON ai_chat_chunks(tenant_id, customer_message);

-- ─── Job de import (para tracking de progreso) ───────────────────────
-- Cuando un import es grande (>5000 mensajes), lo procesamos async y mostramos
-- progreso en la UI. Reutilizamos bulk_jobs que ya existe.
-- No se necesita migración adicional.
