-- Migration 050: perfil del negocio en tenants
--
-- Añade campos de marca/contacto que el cliente ve en su pestaña
-- "Configuración → Negocio". Se usan para:
--   • Mostrar el nombre y logo del negocio dentro del CRM (avatar de tenant).
--   • Auto-completar firmas, plantillas de bot, citas con el teléfono y URL.
--   • SEO/landing del subdominio futuro (slug.wapi101.com) y para URLs
--     internas tipo wapi101.com/{slug}.
--
-- Campos:
--   business_url      — sitio web del cliente (https://...)
--   business_address  — domicilio físico (texto libre, una sola línea o varias)
--   business_logo_url — URL de logo (puede ser /uploads/... o externa)
--   business_phone    — teléfono comercial principal
--
-- El nombre del negocio (display_name) y el slug (subdominio/URL) ya existen
-- en la tabla tenants desde la migration 038. Aquí solo agregamos los nuevos.

ALTER TABLE tenants ADD COLUMN business_url      TEXT;
ALTER TABLE tenants ADD COLUMN business_address  TEXT;
ALTER TABLE tenants ADD COLUMN business_logo_url TEXT;
ALTER TABLE tenants ADD COLUMN business_phone    TEXT;
