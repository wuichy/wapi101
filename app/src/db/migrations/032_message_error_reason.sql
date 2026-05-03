-- Razón legible cuando un mensaje saliente falla (status='failed').
-- Se llena desde el webhook value.statuses[].errors[] de Meta.
ALTER TABLE messages ADD COLUMN error_reason TEXT;
