-- Migration 051: renombrar planes + columna extra_users
--
-- Cambia las claves de planes:
--   starter  → basico
--   business → ultra
--   free/pro/owner se mantienen
--
-- Agrega extra_users para rastrear slots de usuario adicional comprados.

ALTER TABLE tenants ADD COLUMN extra_users INTEGER NOT NULL DEFAULT 0;

UPDATE tenants SET plan = 'basico' WHERE plan = 'starter';
UPDATE tenants SET plan = 'ultra'  WHERE plan = 'business';
