-- Reelance IA — simetría con carrito abandonado: etiqueta + plantilla para órdenes.
--
-- Etiquetas:
--   order_tag                  — nombre de la etiqueta a aplicar al recibir orden.
--   order_tag_target           — 'contact' | 'lead' | 'both' (default 'contact').
--   abandoned_tag_target       — agregado al existente abandoned_tag, mismo dominio.
--                                Default 'contact' por retrocompatibilidad.
--
-- Plantillas:
--   order_template_id          — plantilla WhatsApp API a mandar al recibir orden.
--                                Si está configurada, gana sobre order_bot_id.

ALTER TABLE reelance_ia_config ADD COLUMN order_tag TEXT;
ALTER TABLE reelance_ia_config ADD COLUMN order_tag_target TEXT DEFAULT 'contact';
ALTER TABLE reelance_ia_config ADD COLUMN order_template_id INTEGER;

ALTER TABLE reelance_ia_config ADD COLUMN abandoned_tag_target TEXT DEFAULT 'contact';
