-- Migration 044: avatar URL en contactos
--
-- Agrega 2 columnas a `contacts` para almacenar la foto de perfil del contacto:
--   avatar_url         — URL pública de la imagen (puede ser de WhatsApp, FB, IG)
--   avatar_updated_at  — unixtimestamp del último refresh
--
-- La sincronización real de avatares (fetch desde provider APIs) se hace
-- desde el código de la app (no en DB). Esta migration solo prepara las
-- columnas. Los avatares se llenarán de varias formas:
--   1) Webhook de Meta (Messenger/IG): el payload incluye sender.profile_pic
--   2) WhatsApp Cloud API: GET /{phone-number-id}/profile_picture (requiere
--      permisos del app review)
--   3) Manualmente via UI (subir avatar)
--
-- Sin avatar_url, el frontend muestra iniciales por default (comportamiento
-- actual). Cuando hay avatar_url, se renderiza la imagen.

ALTER TABLE contacts ADD COLUMN avatar_url TEXT;
ALTER TABLE contacts ADD COLUMN avatar_updated_at INTEGER;
