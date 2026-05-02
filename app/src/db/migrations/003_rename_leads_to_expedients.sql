-- Rename: leads → expedients (mantiene los datos)
ALTER TABLE leads RENAME TO expedients;

-- Renombrar índices viejos al nuevo nombre
DROP INDEX IF EXISTS idx_leads_contact;
DROP INDEX IF EXISTS idx_leads_pipeline;
DROP INDEX IF EXISTS idx_leads_stage;
CREATE INDEX IF NOT EXISTS idx_expedients_contact ON expedients(contact_id);
CREATE INDEX IF NOT EXISTS idx_expedients_pipeline ON expedients(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_expedients_stage ON expedients(stage_id);
