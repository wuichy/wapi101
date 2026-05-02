ALTER TABLE conversations ADD COLUMN last_incoming_at INTEGER DEFAULT NULL;

-- Backfill from existing messages
UPDATE conversations
SET last_incoming_at = (
  SELECT MAX(created_at) FROM messages
  WHERE conversation_id = conversations.id
    AND direction = 'incoming'
);
