-- Ejemplos por variable de plantilla WhatsApp (paridad con Kommo).
-- Para body con {{1}}, {{2}}, ... el usuario define un nombre amigable
-- y un valor de ejemplo. Meta usa el valor de ejemplo durante la review.
--
-- Estructura JSON: [{ "label": "Nombre", "example": "Luis" }, ...]
-- Posición del array = número del placeholder (índice 0 → {{1}}).

ALTER TABLE message_templates ADD COLUMN body_placeholders TEXT;  -- JSON array
