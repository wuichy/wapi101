-- App de Carritos Abandonados — independiente de la app WooCommerce.
-- Comparte el mismo plugin WP (reelance-conexion-wapi101) y la misma woo_config
-- para pragmatismo: si un tenant no tiene woo_config, al instalar esta app se
-- le creará automáticamente al primer GET de su config.

INSERT OR IGNORE INTO marketplace_apps (slug, name, description, version, icon_emoji, category, requirements, download_url, is_system)
VALUES (
  'reelance-abandoned-cart',
  'Carritos Abandonados',
  'Recupera ventas automáticamente. Cuando alguien deja un carrito sin pagar en WooCommerce, Wapi101 le envía una plantilla de WhatsApp Business para invitarlo a completar la compra. Requiere CartBounty Pro y la app de WooCommerce instalada.',
  '1.0.0',
  '🛍️',
  'integration',
  '["WordPress", "WooCommerce", "CartBounty Pro"]',
  '/api/apps/woo/plugin-download',
  1
);
