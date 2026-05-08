-- Comentarios de redes sociales (FB Page feed + Instagram comments).
-- Meta los manda al webhook bajo `entry.changes[].field`:
--   FB:  field='feed', value.item IN ('comment','post','status','reaction'...)
--   IG:  field='comments'
-- Solo procesamos comentarios reales (no likes/reactions).
--
-- Cada comentario se guarda con su comment_id (único globalmente por provider+id).
-- Si es reply a otro comentario: parent_comment_id apunta al padre.

CREATE TABLE IF NOT EXISTS social_comments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id           INTEGER NOT NULL DEFAULT 1,
  integration_id      INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
  provider            TEXT NOT NULL,                  -- 'messenger' | 'instagram'
  post_id             TEXT,                           -- id del post/media
  comment_id          TEXT NOT NULL,                  -- id del comentario en Meta
  parent_comment_id   TEXT,                           -- id del comentario padre (si es reply)
  from_id             TEXT,                           -- user/page id de quien comentó
  from_name           TEXT,
  body                TEXT,
  meta_json           TEXT,                           -- payload original por si se necesita
  status              TEXT NOT NULL DEFAULT 'unread', -- 'unread' | 'read' | 'replied' | 'archived'
  replied_at          INTEGER,
  replied_by_advisor  INTEGER REFERENCES advisors(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comments_tenant   ON social_comments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_status   ON social_comments(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_comments_post     ON social_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_social_comments_provider ON social_comments(provider, comment_id);
