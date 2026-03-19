-- ============================================================
-- MIGRATION 009 — DONNÉES DE TEST POUR E2E
-- Insère un établissement de test, une année scolaire,
-- un directeur, et les niveaux pour les tests Playwright.
--
-- Idempotent : utilise ON CONFLICT DO NOTHING.
-- ============================================================

DO $$
DECLARE
    v_etab_id   UUID := '11111111-1111-1111-1111-111111111111';
    v_annee_id  UUID := '22222222-2222-2222-2222-222222222222';
    v_user_id   UUID := '33333333-3333-3333-3333-333333333333';
    v_role_id   SMALLINT;
BEGIN

    -- ── 1. Établissement de test ─────────────────────────────
    INSERT INTO etablissements (
        id, nom, code_officiel, type, pays, ville, actif
    ) VALUES (
        v_etab_id,
        'Lycée Test E2E',
        'TEST_LBD',
        'lycee',
        'Sénégal',
        'Dakar',
        TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    -- Assurer le code_officiel unique aussi
    INSERT INTO etablissements (
        id, nom, code_officiel, type, pays, ville, actif
    ) VALUES (
        v_etab_id,
        'Lycée Test E2E',
        'TEST_LBD',
        'lycee',
        'Sénégal',
        'Dakar',
        TRUE
    )
    ON CONFLICT (code_officiel) DO NOTHING;

    -- ── 2. Année scolaire 2025-2026 ──────────────────────────
    INSERT INTO annees_scolaires (
        id, etablissement_id, libelle,
        date_debut, date_fin, nb_periodes,
        type_periode, est_courante
    ) VALUES (
        v_annee_id,
        v_etab_id,
        '2025-2026',
        '2025-09-01',
        '2026-07-31',
        3,
        'trimestre',
        TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── 3. Utilisateur directeur ─────────────────────────────
    -- Hash bcrypt pour 'Test1234!' (10 rounds, bcryptjs $2a$)
    INSERT INTO utilisateurs (
        id, etablissement_id,
        nom, prenom,
        email,
        mot_de_passe_hash,
        actif
    ) VALUES (
        v_user_id,
        v_etab_id,
        'Directeur',
        'Test',
        'directeur@test.sn',
        '$2a$10$0iwhiiXClQJBP2u.hdiZyu2PT5/6458lgyymijhXCRdNMu0hEvRqS',
        TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    -- ── 4. Rôle directeur ────────────────────────────────────
    SELECT id INTO v_role_id FROM roles WHERE code = 'directeur';

    IF v_role_id IS NOT NULL THEN
        INSERT INTO utilisateur_roles (
            id, utilisateur_id, role_id, etablissement_id, actif
        ) VALUES (
            uuid_generate_v4(),
            v_user_id,
            v_role_id,
            v_etab_id,
            TRUE
        )
        ON CONFLICT (utilisateur_id, role_id, etablissement_id) DO NOTHING;
    END IF;

    -- ── 5. Config système de notes ───────────────────────────
    INSERT INTO configs_systeme_notes (etablissement_id)
    VALUES (v_etab_id)
    ON CONFLICT (etablissement_id) DO NOTHING;

    -- ── 6. Politique de sécurité ─────────────────────────────
    INSERT INTO politique_securite (etablissement_id)
    VALUES (v_etab_id)
    ON CONFLICT (etablissement_id) DO NOTHING;

    -- ── 7. Niveaux scolaires (6ème → Terminale) ──────────────
    INSERT INTO niveaux (id, etablissement_id, nom, nom_court, ordre, cycle, actif)
    VALUES
        (uuid_generate_v4(), v_etab_id, '6ème',      '6e',   1, 'college', TRUE),
        (uuid_generate_v4(), v_etab_id, '5ème',      '5e',   2, 'college', TRUE),
        (uuid_generate_v4(), v_etab_id, '4ème',      '4e',   3, 'college', TRUE),
        (uuid_generate_v4(), v_etab_id, '3ème',      '3e',   4, 'college', TRUE),
        (uuid_generate_v4(), v_etab_id, '2nde',      '2nde', 5, 'lycee',   TRUE),
        (uuid_generate_v4(), v_etab_id, '1ère',      '1ere', 6, 'lycee',   TRUE),
        (uuid_generate_v4(), v_etab_id, 'Terminale', 'Tle',  7, 'lycee',   TRUE)
    ON CONFLICT (etablissement_id, nom) DO NOTHING;

    RAISE NOTICE 'Migration 009 terminée — données de test E2E insérées';
    RAISE NOTICE '  - Établissement : Lycée Test E2E (TEST_LBD)';
    RAISE NOTICE '  - Année scolaire : 2025-2026 (courante)';
    RAISE NOTICE '  - Directeur : directeur@test.sn / Test1234!';
    RAISE NOTICE '  - 7 niveaux créés';

END;
$$;
