-- Trigger keyword: modo de coincidencia (any / all / exact).
--
-- Antes el trigger keyword era siempre OR puro: si el mensaje contiene
-- CUALQUIERA de las palabras → dispara. Eso causa false positives con
-- palabras genéricas como "descuento" o "info".
--
-- Ahora cada bot keyword tiene un modo configurable:
--   'any'   (default, retrocompat) → mensaje contiene ALGUNA de las palabras
--   'all'   → mensaje contiene TODAS las palabras (en cualquier orden)
--   'exact' → mensaje contiene la frase exacta (busca substring del valor completo)
--
-- Aplicable solo a triggers tipo 'keyword'. Para otros tipos el campo es ignorado.

ALTER TABLE salsbots ADD COLUMN trigger_match_mode TEXT DEFAULT 'any';
