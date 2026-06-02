-- Flag: cuando llega un order COMPLETED/FULFILLED/SHIPPED, ¿pausar
-- los bot_runs activos del contacto/lead? Útil para que los bots de
-- seguimiento previos no choquen con el nuevo pipeline destino.
ALTER TABLE reelance_ia_config ADD COLUMN order_stop_active_bots INTEGER DEFAULT 0;
