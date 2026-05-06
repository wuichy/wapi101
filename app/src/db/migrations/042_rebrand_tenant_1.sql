-- Migration 042: rebrand tenant 1 a Wapi101
--
-- Migration 038 creó el tenant 1 con slug='lucho101' y display_name='Lucho 101'
-- (era el branding previo al rebrand de mayo 2026). Esta migration actualiza
-- ese tenant al nuevo branding "Wapi101".
--
-- Idempotente: solo actualiza si el slug todavía es 'lucho101'. En instalaciones
-- nuevas (donde 038 podría ser editado a futuro o donde el tenant 1 ya tenga
-- otro slug) NO hace nada.

UPDATE tenants
   SET slug = 'wapi101',
       display_name = 'Wapi101'
 WHERE id = 1
   AND slug = 'lucho101';
