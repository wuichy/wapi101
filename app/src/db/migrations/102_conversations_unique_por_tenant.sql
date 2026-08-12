-- La restricción UNIQUE de conversations nació ANTES del multi-tenant:
--
--     UNIQUE(provider, external_id)     ← sin tenant_id
--
-- `tenant_id` se agregó después con un ALTER y la restricción nunca se
-- actualizó. Resultado: DOS TENANTS NO PUEDEN TENER AL MISMO CLIENTE.
-- Si el tenant A ya tiene una conversación de WhatsApp con +52155512345,
-- cuando ese mismo número le escribe al tenant B, findOrCreate busca
-- filtrando por tenant (no lo encuentra), intenta insertar, y el INSERT
-- revienta con "UNIQUE constraint failed". El mensaje del tenant B se
-- pierde en silencio.
--
-- Detectado el 2026-08-12: al empezar a sincronizar los mensajes salientes
-- de WA Lite, el número personal (tenant 1) escribió a contactos que ya
-- existían en el tenant 101 (MEL BROS CO) y cada uno tiraba el error.
--
-- NO se puede "arreglar" enganchando la conversación existente: es de OTRO
-- tenant, sería una fuga de datos entre clientes. La restricción tiene que
-- incluir el tenant.
--
-- SQLite no deja alterar una restricción: hay que reconstruir la tabla.
-- El runner (src/db/index.js) ya envuelve esto con foreign_keys=OFF antes de
-- la transacción y foreign_key_check después, que es el procedimiento oficial
-- para tablas referenciadas por FKs (messages, personal_conversation_state,
-- bot_run_waits, appointments, whatsapp_product_sends).

CREATE TABLE conversations_new (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id           INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  integration_id       INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  provider             TEXT NOT NULL,
  external_id          TEXT,
  last_message_at      INTEGER DEFAULT (unixepoch()),
  last_message         TEXT,
  unread_count         INTEGER DEFAULT 0,
  bot_paused           INTEGER DEFAULT 0,
  created_at           INTEGER DEFAULT (unixepoch()),
  last_incoming_at     INTEGER DEFAULT NULL,
  bot_paused_at        INTEGER,
  pinned               INTEGER DEFAULT 0,
  archived             INTEGER DEFAULT 0,
  muted_until          INTEGER,
  tenant_id            INTEGER NOT NULL DEFAULT 1,
  ai_mode              TEXT DEFAULT 'auto',
  last_human_msg_at    INTEGER,
  last_ai_msg_at       INTEGER,
  human_takeover_until INTEGER,
  is_urgent            INTEGER DEFAULT 0,
  UNIQUE(tenant_id, provider, external_id)
);

INSERT INTO conversations_new (
  id, contact_id, integration_id, provider, external_id, last_message_at,
  last_message, unread_count, bot_paused, created_at, last_incoming_at,
  bot_paused_at, pinned, archived, muted_until, tenant_id, ai_mode,
  last_human_msg_at, last_ai_msg_at, human_takeover_until, is_urgent
)
SELECT
  id, contact_id, integration_id, provider, external_id, last_message_at,
  last_message, unread_count, bot_paused, created_at, last_incoming_at,
  bot_paused_at, pinned, archived, muted_until, tenant_id, ai_mode,
  last_human_msg_at, last_ai_msg_at, human_takeover_until, is_urgent
FROM conversations;

DROP TABLE conversations;
ALTER TABLE conversations_new RENAME TO conversations;

-- Índices tal cual estaban
CREATE INDEX idx_convos_contact        ON conversations(contact_id);
CREATE INDEX idx_convos_last           ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_tenant  ON conversations(tenant_id);
CREATE INDEX idx_conv_human_takeover   ON conversations(human_takeover_until)
  WHERE human_takeover_until IS NOT NULL;
CREATE INDEX idx_conv_urgent           ON conversations(is_urgent) WHERE is_urgent = 1;
