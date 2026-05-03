ALTER TABLE stages ADD COLUMN stale_hours INTEGER;
ALTER TABLE expedients ADD COLUMN stage_entered_at INTEGER;
UPDATE expedients SET stage_entered_at = COALESCE(updated_at, created_at) WHERE stage_entered_at IS NULL;
