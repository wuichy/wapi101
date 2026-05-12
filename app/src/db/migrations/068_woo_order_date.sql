-- Fecha real del pedido en WooCommerce (date_created del order)
ALTER TABLE woo_orders ADD COLUMN wc_order_date INTEGER DEFAULT NULL;
