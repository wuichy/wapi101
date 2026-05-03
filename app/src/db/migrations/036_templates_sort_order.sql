-- Orden manual de plantillas en la lista. NULL = ordena por defecto (created_at desc).
ALTER TABLE message_templates ADD COLUMN sort_order INTEGER;

-- Backfill: preservar el orden actual (created_at desc) como sort_order inicial.
UPDATE message_templates SET sort_order = (
  SELECT COUNT(*) FROM message_templates t2 WHERE t2.created_at >= message_templates.created_at
);
