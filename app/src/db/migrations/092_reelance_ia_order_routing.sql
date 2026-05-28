-- Reelance IA — ruteo automático de leads a pipelines según duración del producto.
--
-- Replica el mecanismo de WooCommerce woo_config (products_json + pipeline_rules):
--
--   products_json   = JSON array con productos del catálogo y sus días de duración.
--                     Ej: [{"name":"Loción Hombre","duration_days":30}, ...]
--                     Identificación por nombre (case-insensitive) — la app Next.js
--                     manda el nombre del producto en cada line_item.
--
--   pipeline_rules  = JSON array de reglas de ruteo por duración total.
--                     Ej: [{"duration_days":30,"pipeline_id":6,"stage_id":44}, ...]
--                     Se busca la regla cuya duration_days sea la mayor que no
--                     exceda el maxDays del pedido (misma lógica que woo).
--
-- Flujo:
--   1. Cliente compra en lucho101.com (Next.js)
--   2. App manda webhook order PAID/COMPLETED con tracking_number + carrier
--   3. Wapi101 calcula maxDays sumando duración × cantidad de cada producto
--   4. Busca regla que aplica → mueve lead al pipeline destino, stage inicial
--   5. Dispara triggerPipelineStage → activa bots MES 1:1, MES 2:1, etc.

ALTER TABLE reelance_ia_config ADD COLUMN products_json TEXT DEFAULT '[]';
ALTER TABLE reelance_ia_config ADD COLUMN pipeline_rules TEXT DEFAULT '[]';
