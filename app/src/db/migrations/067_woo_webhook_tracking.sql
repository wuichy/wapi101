-- Tracking de último webhook recibido + control de notificaciones de desconexión
ALTER TABLE woo_config ADD COLUMN last_webhook_at INTEGER DEFAULT NULL;
ALTER TABLE woo_config ADD COLUMN last_disconnect_notif_at INTEGER DEFAULT NULL;
