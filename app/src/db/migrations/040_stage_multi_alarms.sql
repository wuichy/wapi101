-- Múltiples alarmas por etapa.
-- Antes: cada stage tenía 1 alarma fija en columnas alarm_type/threshold/meta.
-- Ahora: stages.alarms_json guarda un array [{ id, type, threshold_seconds, meta }, ...].
-- Las columnas legacy se mantienen por compat — si alarms_json está vacío y hay
-- alarm_type, el frontend lo usa como fallback (single-alarm legacy).
-- Backfill: las stages que ya tienen alarm_type configurado se migran a un array
-- de un solo elemento en alarms_json.

ALTER TABLE stages ADD COLUMN alarms_json TEXT NOT NULL DEFAULT '[]';

-- Backfill: stages con alarm_type configurado → array de 1 elemento.
-- alarm_meta puede ser NULL (la columna lo permite) o un JSON string.
-- Construimos el JSON manualmente con json_object para preservar tipos.
UPDATE stages
   SET alarms_json = json_array(
     json_object(
       'id', 'a1',
       'type', alarm_type,
       'threshold_seconds', alarm_threshold_seconds,
       'meta', CASE
         WHEN alarm_meta IS NULL OR alarm_meta = '' THEN json_object()
         ELSE json(alarm_meta)
       END
     )
   )
 WHERE alarm_type IS NOT NULL AND alarm_type <> '';
