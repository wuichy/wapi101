-- Extiende social_comments para enlazar al contacto y guardar URL del post.
-- contact_id se llena cuando el commenter ya tenía conversación previa con
-- este tenant (FB PSID o IG user ID coinciden con conversations.external_id),
-- o cuando se auto-crea contacto al recibir el comentario por primera vez.

ALTER TABLE social_comments ADD COLUMN permalink_url TEXT;
ALTER TABLE social_comments ADD COLUMN contact_id    INTEGER REFERENCES contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_comments_contact ON social_comments(contact_id);
