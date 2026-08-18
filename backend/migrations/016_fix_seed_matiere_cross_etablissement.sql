-- ============================================================
-- MIGRATION 016 — matière de seed TEST_LBD pointait vers un
-- autre établissement (données polluées)
--
-- 010_test_seed_enseignant_parent.sql résout la matière de
-- l'affectation enseignant via :
--   SELECT id INTO v_matiere_id FROM matieres
--   WHERE nom = 'Mathématiques' LIMIT 1;
-- sans filtrer par etablissement_id. TEST_LBD (11111111-...)
-- n'a jamais eu sa propre ligne 'matieres' : la seule
-- "Mathématiques" présente en base appartenait à un tout autre
-- établissement (Prytanée Militaire Saint-Louis, PMS001,
-- d88d242a-9e06-4bf5-82c6-afbb22fae623), probablement créé via
-- POST /etablissements/register lors d'un test E2E antérieur.
--
-- Conséquence vérifiée : affectations_enseignants pour
-- l'enseignant de test TEST_LBD référence matiere_id appartenant
-- à PMS001. GET /enseignants/moi/classes fait donc apparaître
-- "Mathématiques" pour un établissement dont la table `matieres`
-- est par ailleurs vide — un faux positif qui aurait masqué un
-- vrai bug d'isolation multi-tenant si un test avait vérifié le
-- filtrage par établissement sur cette route.
--
-- Fix : créer la matière 'Mathématiques' propre à TEST_LBD (même
-- code que la référence PMS001, unique seulement par
-- etablissement_id+code donc aucun conflit), puis ré-affecter la
-- ligne affectations_enseignants existante vers cette matière
-- correctement scopée.
--
-- Idempotent : ON CONFLICT DO NOTHING sur l'insertion, UPDATE
-- conditionné sur l'ancienne valeur polluée.
-- ============================================================

DO $$
DECLARE
    v_etab_id       UUID := '11111111-1111-1111-1111-111111111111'; -- TEST_LBD
    v_matiere_id    UUID;
    v_ancienne_id   UUID := 'af4d0a71-45ef-47fe-a575-c75398c04c24'; -- matiere PMS001 utilisée par erreur
    v_nb_corrigees  INT;
BEGIN

    -- ── 1. Créer 'Mathématiques' scopée à TEST_LBD si absente ──
    INSERT INTO matieres (id, etablissement_id, nom, nom_court, code, compte_dans_moyenne)
    VALUES (uuid_generate_v4(), v_etab_id, 'Mathématiques', 'Maths', 'MATH', TRUE)
    ON CONFLICT (etablissement_id, code) DO NOTHING;

    SELECT id INTO v_matiere_id
    FROM matieres
    WHERE etablissement_id = v_etab_id AND code = 'MATH';

    -- ── 2. Ré-affecter les lignes polluées vers la bonne matière ──
    IF v_matiere_id IS NOT NULL THEN
        UPDATE affectations_enseignants ae
        SET matiere_id = v_matiere_id
        FROM enseignants ens
        JOIN utilisateurs u ON u.id = ens.utilisateur_id
        WHERE ae.enseignant_id = ens.id
          AND u.etablissement_id = v_etab_id
          AND ae.matiere_id = v_ancienne_id;

        GET DIAGNOSTICS v_nb_corrigees = ROW_COUNT;

        RAISE NOTICE 'Migration 016 terminée — % ligne(s) affectations_enseignants corrigée(s) (matiere_id -> %)', v_nb_corrigees, v_matiere_id;
    ELSE
        RAISE NOTICE 'Migration 016 : matière MATH introuvable pour TEST_LBD après insertion — rien corrigé';
    END IF;

END;
$$;
