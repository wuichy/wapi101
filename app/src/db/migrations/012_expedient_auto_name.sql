-- Marca si el nombre fue auto-generado (1) o puesto manualmente (0)
ALTER TABLE expedients ADD COLUMN name_is_auto INTEGER DEFAULT 0;
