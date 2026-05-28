-- Reelance IA — opción de mandar plantilla WhatsApp API en lugar de bot
-- para carritos abandonados.
--
-- Razón: cuando el cliente abandona el carrito, generalmente NO está dentro
-- de la ventana de 24 horas de WhatsApp (no nos ha escrito recientemente).
-- En esa situación los bots con mensajes de texto libre no pueden enviarse —
-- solo plantillas pre-aprobadas funcionan. Por eso el user puede elegir:
--
--   - template_id (recomendado): mensaje pre-aprobado por Meta, siempre
--     entregable. Usa los placeholders del template ({{1}}, {{2}}, etc.)
--   - bot_id (fallback): solo útil si el cliente YA escribió recientemente
--     o si el bot manda template internamente
--
-- Si están ambos configurados, gana el template (es más confiable).

ALTER TABLE reelance_ia_config ADD COLUMN abandoned_template_id INTEGER;
