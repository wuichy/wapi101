-- FTS5 para búsqueda rápida en el body de mensajes.
-- Antes: el buscador de chats hacía EXISTS+LIKE sobre messages por cada
-- conversación → 11.8s con 4.6k convos × 12k mensajes. Con FTS5 → ~20ms.
-- tokenize unicode61 remove_diacritics 2 = ignora acentos (luis=lúis).

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Poblar con mensajes existentes
INSERT INTO messages_fts(rowid, body)
  SELECT id, body FROM messages WHERE body IS NOT NULL AND body != '';

-- Triggers para mantener el índice sincronizado
CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
  INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body);
END;
