-- ============================================================
-- MIGRATION 015 — COMPTE DE TEST SUPER_ADMIN
-- Complète 009_test_seed.sql (établissement TEST_LBD) avec un
-- utilisateur super_admin, pour vérifier en exécution réelle le
-- bug suspecté (mais jamais reproduit) dans permission.middleware.js
-- : isolerEtablissement() a un retour anticipé pour super_admin
-- qui saute la ligne req.etablissement_id = etablissement_id,
-- cassant toute route qui lit exclusivement req.etablissement_id
-- (ex. GET /discipline/sanctions, GET /configs/matieres).
--
-- Note : la connexion (POST /auth/connexion) exige toujours un
-- etablissement_code et résout l'utilisateur via
-- utilisateurs.etablissement_id (cf. auth.routes.js) — même un
-- super_admin est rattaché à un établissement "domicile" et se
-- connecte avec son code. Il n'existe aujourd'hui aucun mécanisme
-- de bascule cross-établissement au login ; ce compte de test suit
-- donc le même schéma que le directeur/enseignant de test.
--
-- Idempotent : utilise ON CONFLICT DO NOTHING.
-- ============================================================

DO $$
DECLARE
    v_etab_id       UUID := '11111111-1111-1111-1111-111111111111'; -- Lycée Test E2E (TEST_LBD)
    v_sa_user_id    UUID := '88888888-8888-8888-8888-888888888888';
    v_role_super_admin SMALLINT;
BEGIN

    SELECT id INTO v_role_super_admin FROM roles WHERE code = 'super_admin';

    -- ── 1. Utilisateur super_admin ───────────────────────────
    -- Hash bcrypt pour 'Test1234!' (identique aux autres comptes de test)
    INSERT INTO utilisateurs (
        id, etablissement_id, nom, prenom, email, mot_de_passe_hash, actif
    ) VALUES (
        v_sa_user_id, v_etab_id, 'Super', 'Admin', 'superadmin@test.sn',
        '$2a$10$0iwhiiXClQJBP2u.hdiZyu2PT5/6458lgyymijhXCRdNMu0hEvRqS', TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    IF v_role_super_admin IS NOT NULL THEN
        INSERT INTO utilisateur_roles (id, utilisateur_id, role_id, etablissement_id, actif)
        VALUES (uuid_generate_v4(), v_sa_user_id, v_role_super_admin, v_etab_id, TRUE)
        ON CONFLICT (utilisateur_id, role_id, etablissement_id) DO NOTHING;
    END IF;

    RAISE NOTICE 'Migration 015 terminée — compte super_admin de test créé';
    RAISE NOTICE '  - Super admin : superadmin@test.sn / Test1234! (etablissement_code TEST_LBD)';

END;
$$;
