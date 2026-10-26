-- 002_auth.sql — compléments d'authentification (A-01, TOTP).
-- Dernier compteur TOTP accepté : un même code ne peut pas servir deux fois (rejeu).
ALTER TABLE users ADD COLUMN totp_last_counter INTEGER;
-- Date du dernier changement de mot de passe (affichage dans Comptes).
ALTER TABLE users ADD COLUMN pw_changed_at TEXT;
