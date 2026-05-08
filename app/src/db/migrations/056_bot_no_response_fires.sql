-- Track which (bot, conversation, last_outgoing_msg_id) combos already fired
-- the no_response trigger, so the poller no dispara dos veces al mismo mensaje.
-- Cuando llega un nuevo outgoing al chat, last_outgoing_id cambia y el bot
-- vuelve a ser elegible.

CREATE TABLE IF NOT EXISTS bot_no_response_fires (
  tenant_id        INTEGER NOT NULL,
  bot_id           INTEGER NOT NULL,
  conversation_id  INTEGER NOT NULL,
  last_outgoing_id INTEGER NOT NULL,
  fired_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (bot_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_bot_nr_fires_tenant   ON bot_no_response_fires(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_nr_fires_convo    ON bot_no_response_fires(conversation_id);
