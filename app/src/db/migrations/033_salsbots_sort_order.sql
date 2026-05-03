-- Orden manual de bots en la lista. NULL = ordena por defecto (created_at desc).
ALTER TABLE salsbots ADD COLUMN sort_order INTEGER;

-- Backfill: los bots existentes reciben sort_order según created_at descendente
-- para que el orden inicial coincida con lo que el usuario veía antes.
UPDATE salsbots SET sort_order = (
  SELECT COUNT(*) FROM salsbots b2 WHERE b2.created_at >= salsbots.created_at
);
