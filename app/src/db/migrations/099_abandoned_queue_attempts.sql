-- Retry de carritos abandonados: contador de intentos.
-- Antes un fallo (ej. token caducado) marcaba status='failed' permanente y el
-- poller (que solo lee 'pending') jamás reintentaba — 9 carritos se perdieron
-- así durante el incidente del token del 9-10 jun 2026.
ALTER TABLE reelance_ia_abandoned_queue ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
