-- Reelance IA: notificaciones por ESTADO del pedido (spec wuichy 2026-06-10).
-- Antes había una sola plantilla (order_template_id = "compra confirmada") para
-- cualquier orden notificable. Ahora cada etapa tiene su plantilla opcional:
--   ON_HOLD                      → on_hold_template_id   (recordatorio comprobante SPEI/OXXO)
--   PROCESSING/PAID sin guía     → order_template_id     (compra confirmada — ya existía)
--   COMPLETED/FULFILLED con guía → shipping_template_id  (pedido en camino)
--   CANCELLED                    → cancelled_template_id
--   REFUNDED                     → refunded_template_id
-- Si una plantilla no está configurada, esa etapa simplemente no notifica.
ALTER TABLE reelance_ia_config ADD COLUMN on_hold_template_id   INTEGER REFERENCES message_templates(id) ON DELETE SET NULL;
ALTER TABLE reelance_ia_config ADD COLUMN shipping_template_id  INTEGER REFERENCES message_templates(id) ON DELETE SET NULL;
ALTER TABLE reelance_ia_config ADD COLUMN cancelled_template_id INTEGER REFERENCES message_templates(id) ON DELETE SET NULL;
ALTER TABLE reelance_ia_config ADD COLUMN refunded_template_id  INTEGER REFERENCES message_templates(id) ON DELETE SET NULL;

-- Anti-duplicados por (pedido, tipo de notificación): "no repitas el mismo
-- mensaje para el mismo orderNumberDisplay + status". Un pedido recibe máximo
-- UNA notificación de cada tipo (hold/confirmed/shipped/cancelled/refunded).
CREATE TABLE IF NOT EXISTS reelance_ia_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL,
  external_id TEXT    NOT NULL,   -- Order.id (cuid de Prisma)
  kind        TEXT    NOT NULL,   -- 'hold' | 'confirmed' | 'shipped' | 'cancelled' | 'refunded'
  sent_at     INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, external_id, kind)
);

-- Backfill: las órdenes históricas procesadas con éxito en estados de venta ya
-- recibieron su "compra confirmada" (era la única notificación que existía).
-- Marcarlas evita que un re-sync raro les mande otra confirmación.
INSERT OR IGNORE INTO reelance_ia_notifications (tenant_id, external_id, kind)
SELECT DISTINCT tenant_id, external_id, 'confirmed'
FROM reelance_ia_events
WHERE event_type = 'order' AND error IS NULL
  AND UPPER(COALESCE(external_status, '')) IN ('PENDING', 'PROCESSING', 'PAID', 'COMPLETED', 'FULFILLED', 'INVOICED');
