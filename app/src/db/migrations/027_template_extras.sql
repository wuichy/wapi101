-- Plantillas WhatsApp API: paridad con Kommo / Meta — header con media + botones.
-- Soporta:
--   - HEADER tipo TEXT (existente) | IMAGE | VIDEO | DOCUMENT
--   - BUTTONS (hasta 3 QUICK_REPLY o hasta 2 CTA URL/PHONE_NUMBER)

ALTER TABLE message_templates ADD COLUMN header_type TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE message_templates ADD COLUMN header_media_url TEXT;        -- URL del archivo en nuestro server (referencia)
ALTER TABLE message_templates ADD COLUMN header_media_handle TEXT;     -- handle de Resumable Upload de Meta (para crear plantilla)
ALTER TABLE message_templates ADD COLUMN header_media_id TEXT;         -- media_id de Meta (para envíos posteriores)
ALTER TABLE message_templates ADD COLUMN buttons TEXT;                  -- JSON array: [{type, text, url?, phone_number?}]
