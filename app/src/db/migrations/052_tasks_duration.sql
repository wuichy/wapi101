-- Migration 052: campo duración en tareas
ALTER TABLE tasks ADD COLUMN duration_minutes INTEGER DEFAULT NULL;
