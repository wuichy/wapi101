-- Atribución del registro: de dónde venía la persona cuando creó su cuenta.
-- Hasta hoy (2026-09-28) sabíamos cuántas visitas traía Google pero NO cuántos
-- registros — el radar semanal lo repetía cada lunes. Se llena en
-- POST /api/auth/signup cruzando el visitorId (localStorage wapi_vid) con
-- visitor_sessions. Todo nullable: los tenants viejos quedan sin dato.
ALTER TABLE tenants ADD COLUMN signup_session_id TEXT;
ALTER TABLE tenants ADD COLUMN signup_referrer TEXT;
ALTER TABLE tenants ADD COLUMN signup_landing_page TEXT;
ALTER TABLE tenants ADD COLUMN signup_utm_source TEXT;
ALTER TABLE tenants ADD COLUMN signup_utm_medium TEXT;
ALTER TABLE tenants ADD COLUMN signup_utm_campaign TEXT;
ALTER TABLE tenants ADD COLUMN signup_source TEXT;   -- google | IA | directo | social | utm:<x> | otro
