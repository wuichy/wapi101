-- Modelo extendido de alarmas por etapa: tipo + umbral en segundos + meta JSON.
-- Reemplaza al simple stale_hours (que se conserva por compat pero ya no se usa).
ALTER TABLE stages ADD COLUMN alarm_type TEXT;
ALTER TABLE stages ADD COLUMN alarm_threshold_seconds INTEGER;
ALTER TABLE stages ADD COLUMN alarm_meta TEXT;

-- Backfill: las stages que ya tenían stale_hours configurado se migran al nuevo
-- modelo como una alarma de tipo 'time_in_stage'.
UPDATE stages
   SET alarm_type = 'time_in_stage',
       alarm_threshold_seconds = stale_hours * 3600
 WHERE stale_hours IS NOT NULL AND stale_hours > 0;

-- Para la condición "bot pausado hace X tiempo" necesitamos el momento de pausa.
ALTER TABLE conversations ADD COLUMN bot_paused_at INTEGER;
