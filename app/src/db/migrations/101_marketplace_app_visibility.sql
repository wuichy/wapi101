-- Visibilidad de apps del marketplace.
-- Por defecto TODAS las marketplace_apps son públicas (visibles en "Available"
-- para cualquier tenant). Con hidden=1, una app SOLO la ve el tenant que ya la
-- tiene instalada — para apps privadas/específicas de un negocio.
--
-- Pedido de wuichy (2026-07-09): que otros tenants solo vean "WooCommerce"; las
-- apps custom de Reelance (Reelance IA, Carritos Abandonados) quedan privadas.

ALTER TABLE marketplace_apps ADD COLUMN hidden INTEGER DEFAULT 0;

-- Reelance WooCommerce → nombre genérico "WooCommerce" (será la única pública).
UPDATE marketplace_apps SET name = 'WooCommerce' WHERE slug = 'reelance-woocommerce';

-- Apps específicas de Reelance → privadas (solo Reelance, que ya las tiene instaladas).
UPDATE marketplace_apps SET hidden = 1 WHERE slug IN ('reelance-ia', 'reelance-abandoned-cart');
