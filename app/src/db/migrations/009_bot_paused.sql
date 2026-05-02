-- Agrega control de bot por contacto.
-- bot_paused = 1 significa que el bot NO responde a ese contacto.
ALTER TABLE contacts ADD COLUMN bot_paused INTEGER NOT NULL DEFAULT 0;
