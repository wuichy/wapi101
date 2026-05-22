-- User Switching: cuando el super-admin "entra como" un tenant, guardamos
-- el token de su sesión super original aquí. Al cerrar la impersonation,
-- se restaura ese token como cookie del browser y la sesión del advisor
-- impersonado se invalida.
--
-- Si impersonator_super_token es NULL → sesión normal (no impersonada).
-- Si tiene valor → estamos en modo "switched", y ese es el token a restaurar.

ALTER TABLE advisor_sessions ADD COLUMN impersonator_super_token TEXT DEFAULT NULL;
ALTER TABLE advisor_sessions ADD COLUMN impersonator_super_admin_id INTEGER DEFAULT NULL;
ALTER TABLE advisor_sessions ADD COLUMN impersonated_at INTEGER DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_advisor_sessions_impersonator
  ON advisor_sessions(impersonator_super_token)
  WHERE impersonator_super_token IS NOT NULL;
