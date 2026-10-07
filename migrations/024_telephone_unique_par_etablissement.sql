-- ============================================================
-- MIGRATION 024 — Téléphone unique PAR ÉTABLISSEMENT (et non pour toute la base)
--
-- Jusqu'ici utilisateurs.telephone était UNIQUE pour toute la base : un parent
-- (ou un enseignant vacataire) ne pouvait avoir de compte que dans UN seul
-- établissement. Or la quasi-totalité du code travaille déjà par établissement :
-- la connexion, le code SMS, la réinitialisation de mot de passe et le
-- contrôle de doublon filtrent sur (etablissement_id, téléphone), et le
-- JWT/la session sont liés à un établissement.
--
-- Nouvelle règle : un même numéro peut avoir UN compte dans chaque
-- établissement, jamais deux dans le même. Sans risque pour les données
-- existantes : toute paire qui respecte l'unicité globale respecte l'unicité
-- par établissement.
--
-- Les codes SMS (otp_verifications) sont liés au COMPTE (utilisateur_id), pas
-- au numéro seul : voir auth.routes.js (tâche 3.1 du plan).
--
-- Idempotent.
-- ============================================================

ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_telephone_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'utilisateurs'::regclass
           AND conname  = 'utilisateurs_etab_telephone_key'
    ) THEN
        ALTER TABLE utilisateurs
            ADD CONSTRAINT utilisateurs_etab_telephone_key UNIQUE (etablissement_id, telephone);
    END IF;
END $$;

COMMENT ON CONSTRAINT utilisateurs_etab_telephone_key ON utilisateurs IS
    'Un numéro = un compte par établissement. Le même numéro peut exister dans plusieurs établissements (parent multi-écoles).';
