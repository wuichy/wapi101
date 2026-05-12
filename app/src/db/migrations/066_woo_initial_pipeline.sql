-- Pipeline/etapa inicial para leads nuevos (order.processing)
ALTER TABLE woo_config ADD COLUMN initial_pipeline_id INTEGER DEFAULT NULL;
ALTER TABLE woo_config ADD COLUMN initial_stage_id    INTEGER DEFAULT NULL;
