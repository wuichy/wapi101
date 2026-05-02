-- Configuraciones generales de la app (clave → valor JSON).
-- Se usa para el bot, preferencias globales, etc.
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Config inicial del bot (desactivado por defecto)
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('bot', json_object(
  'enabled',      0,
  'name',         'Asistente',
  'language',     'es',
  'instructions', '',
  'triggers',     json_object(
    'always',        0,
    'outsideHours',  1,
    'keywords',      json_array()
  ),
  'schedule', json_object(
    'timezone', 'America/Mexico_City',
    'days', json_object(
      'mon', json_object('active',1,'from','09:00','to','18:00'),
      'tue', json_object('active',1,'from','09:00','to','18:00'),
      'wed', json_object('active',1,'from','09:00','to','18:00'),
      'thu', json_object('active',1,'from','09:00','to','18:00'),
      'fri', json_object('active',1,'from','09:00','to','18:00'),
      'sat', json_object('active',0,'from','09:00','to','14:00'),
      'sun', json_object('active',0,'from','09:00','to','14:00')
    )
  )
));
