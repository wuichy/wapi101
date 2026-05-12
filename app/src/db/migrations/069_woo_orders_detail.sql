-- Campos de detalle para mostrar en la vista de pedidos
ALTER TABLE woo_orders ADD COLUMN payment_method    TEXT DEFAULT '';
ALTER TABLE woo_orders ADD COLUMN order_total       TEXT DEFAULT '0';
ALTER TABLE woo_orders ADD COLUMN shipping_total    TEXT DEFAULT '0';
ALTER TABLE woo_orders ADD COLUMN discount_total    TEXT DEFAULT '0';
ALTER TABLE woo_orders ADD COLUMN tax_total         TEXT DEFAULT '0';
ALTER TABLE woo_orders ADD COLUMN shipping_address_json TEXT DEFAULT '{}';
ALTER TABLE woo_orders ADD COLUMN customer_note     TEXT DEFAULT '';
