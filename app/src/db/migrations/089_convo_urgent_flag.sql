-- Marcar conversaciones que requieren atención humana urgente.
--
-- Se setea cuando un bot ejecuta el step 'handover' (cliente pidió hablar
-- con un humano). Mientras esté en 1, las push notifications de mensajes
-- entrantes en esta convo se prefijan con 🚨 para distinguirlas visualmente.
--
-- Se limpia automáticamente cuando el asesor envía un mensaje saliente
-- (significa que ya tomó la conversación).

ALTER TABLE conversations ADD COLUMN is_urgent INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conv_urgent
  ON conversations(is_urgent) WHERE is_urgent = 1;
