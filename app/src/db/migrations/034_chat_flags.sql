-- Flags para acciones del menú contextual del inbox.
ALTER TABLE conversations ADD COLUMN pinned INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN archived INTEGER DEFAULT 0;
ALTER TABLE conversations ADD COLUMN muted_until INTEGER;  -- unixepoch hasta cuándo está silenciada
