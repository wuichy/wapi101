-- Estado del poller de comentarios TikTok (último comment_id procesado por video).
CREATE TABLE tiktok_video_state (
  integration_id INTEGER NOT NULL,
  video_id       TEXT NOT NULL,
  last_comment_id TEXT,
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (integration_id, video_id)
);

-- meta_json en messages: almacena contexto provider-específico (ej: commentId/videoId de TikTok).
ALTER TABLE messages ADD COLUMN meta_json TEXT;
