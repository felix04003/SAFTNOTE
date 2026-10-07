-- ============================================================
-- MIGRATION 020 — Changement de mot de passe obligatoire
--
-- Un compte créé par le directeur (enseignant) reçoit un mot de passe
-- provisoire que le directeur connaît. Ce drapeau force l'utilisateur à
-- le remplacer dès la première connexion : tant qu'il vaut TRUE, l'API
-- refuse toutes les routes protégées sauf le changement de mot de passe,
-- le profil et la déconnexion (403 MDP_CHANGEMENT_REQUIS).
--
-- DEFAULT FALSE : aucun compte existant n'est impacté. Les comptes qui
-- s'auto-inscrivent (directeur via /inscription) choisissent leur propre
-- mot de passe, donc le drapeau reste FALSE pour eux.
-- ============================================================

ALTER TABLE utilisateurs
    ADD COLUMN IF NOT EXISTS mdp_a_changer BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN utilisateurs.mdp_a_changer IS
    'TRUE = mot de passe provisoire : changement obligatoire à la première connexion. Remis à FALSE par POST /auth/changer-mot-de-passe ou par une réinitialisation.';
