-- Fase 1 SaaS: foundation multi-tenant.
-- Agrega tenant_id a todas las tablas con datos de cliente, sin cambiar la
-- lógica de la app. Todo lo existente queda asignado al tenant id=1 (Lucho101)
-- vía DEFAULT 1, así nada se rompe — el código actual sigue funcionando como
-- single-tenant. La Fase 2 agregará middleware de resolución de tenant y
-- filtros automáticos en queries.
--
-- Lo que NO toca esta migración:
--   - UNIQUE constraints existentes (siguen globales, no por-tenant). Mientras
--     solo haya tenant_id=1 no hay colisión. Fase 2 las hará UNIQUE(tenant_id, ...).
--   - Foreign keys a tenants (se podrá agregar después si conviene).
--   - El runner de migraciones (_migrations) — es system-wide, no se toca.

-- ─── Tabla maestra de tenants (clientes del SaaS) ───
CREATE TABLE IF NOT EXISTS tenants (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- slug: usado para subdominio (ej. lucho101.app.com) y URLs internas
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  -- status: active = todo OK, suspended = no paga, trial = periodo gratis,
  --         cancelled = se dió de baja, los datos siguen pero nadie puede entrar
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK(status IN ('active','suspended','trial','cancelled')),
  -- plan: free, starter, pro, owner (este último es Lucho, sin límites)
  plan         TEXT NOT NULL DEFAULT 'free',
  -- meta_json: contacto del cliente, billing email, notas internas, etc.
  meta_json    TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Tenant inicial: Lucho. Forzamos id=1 porque las demás tablas usan DEFAULT 1
-- en sus columnas tenant_id, así todo lo existente apunta acá.
INSERT OR IGNORE INTO tenants (id, slug, display_name, status, plan)
  VALUES (1, 'lucho101', 'Lucho 101', 'active', 'owner');

-- ─── Agregar tenant_id a cada tabla de datos ───
-- DEFAULT 1 hace que las inserciones existentes sigan funcionando sin cambios
-- de código. La columna NO es NULLABLE para evitar registros huérfanos.

ALTER TABLE advisors                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE advisor_sessions           ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alert_log                  ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE app_settings               ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bot_run_waits              ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bot_runs                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bot_tags                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contact_bot_pauses         ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contact_tags               ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE contacts                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE conversations              ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE custom_field_defs          ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE custom_field_values        ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expedient_activity         ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expedient_tags             ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expedients                 ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE integrations               ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE machine_tokens             ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE message_templates          ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE oauth_states               ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE outgoing_webhooks          ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE personal_contact_tags      ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE personal_conversation_state ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE personal_tags              ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pipelines                  ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_subscriptions         ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reports                    ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE salsbot_tag_assignments    ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE salsbots                   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stages                     ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE template_tag_assignments   ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE template_tags              ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE trash                      ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE webhook_events             ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1;

-- ─── Índices en tenant_id para tablas calientes ───
-- Solo en las que se queryean mucho. El resto se puede agregar después si pinchan.
CREATE INDEX IF NOT EXISTS idx_advisors_tenant       ON advisors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant       ON contacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant  ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant       ON messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expedients_tenant     ON expedients(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pipelines_tenant      ON pipelines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stages_tenant         ON stages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_salsbots_tenant       ON salsbots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bot_runs_tenant       ON bot_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant   ON integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_tenant      ON message_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_advisor_sessions_tenant ON advisor_sessions(tenant_id);
