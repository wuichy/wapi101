-- Capa personal por asesor sobre chats y contactos.
-- Vista en /chat: cada asesor (admin o asesor) puede ocultar conversaciones
-- y poner etiquetas a contactos sin que afecte el CRM público (lucho101.com).
--
-- Auto-unhide: una conversación oculta se "reaparece" automáticamente cuando
-- llega un mensaje nuevo (last_message_at > hidden_at).

CREATE TABLE IF NOT EXISTS personal_conversation_state (
  advisor_id      INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  hidden_at       INTEGER NOT NULL,
  PRIMARY KEY (advisor_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_conv_advisor
  ON personal_conversation_state(advisor_id);

-- Etiquetas privadas: cada asesor tiene su catálogo. Mismo "name" puede
-- existir en distintos asesores sin chocar.
CREATE TABLE IF NOT EXISTS personal_tags (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  advisor_id  INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#94a3b8',
  created_at  INTEGER DEFAULT (unixepoch()),
  UNIQUE (advisor_id, name COLLATE NOCASE)
);

CREATE INDEX IF NOT EXISTS idx_personal_tags_advisor
  ON personal_tags(advisor_id);

-- Asignación de etiquetas personales a contactos (M:N).
CREATE TABLE IF NOT EXISTS personal_contact_tags (
  advisor_id  INTEGER NOT NULL REFERENCES advisors(id) ON DELETE CASCADE,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES personal_tags(id) ON DELETE CASCADE,
  created_at  INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (advisor_id, contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_personal_contact_tags_advisor_contact
  ON personal_contact_tags(advisor_id, contact_id);

CREATE INDEX IF NOT EXISTS idx_personal_contact_tags_tag
  ON personal_contact_tags(tag_id);
