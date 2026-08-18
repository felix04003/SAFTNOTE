-- ============================================================
-- MIGRATION 012 — PÉRIODE + ÉVALUATION DE TEST
-- Complète 010_test_seed_enseignant_parent.sql : ajoute une
-- période (trimestre 1) pour l'année scolaire de test TEST_LBD
-- (aucune période n'existait, bloquant toute saisie de notes/
-- bulletins) et une évaluation sur l'affectation existante de
-- l'enseignant de test, pour permettre de tester en direct
-- POST/PUT /evaluations/:id/notes.
--
-- Idempotent : utilise ON CONFLICT DO NOTHING.
-- ============================================================

DO $$
DECLARE
    v_annee_id       UUID := '22222222-2222-2222-2222-222222222222'; -- 2025-2026
    v_periode_id     UUID := '88888888-8888-8888-8888-888888888888';
    v_affectation_id UUID := '77777777-7777-7777-7777-777777777777'; -- ens Diop / Classe A / Maths
    v_evaluation_id  UUID := '99999999-9999-9999-9999-999999999999';
BEGIN

    -- ── 1. Trimestre 1 (aucune période n'existait pour TEST_LBD) ──
    INSERT INTO periodes (id, annee_scolaire_id, numero, libelle, date_debut, date_fin)
    VALUES (v_periode_id, v_annee_id, 1, 'Trimestre 1', '2025-10-01', '2025-12-20')
    ON CONFLICT (id) DO NOTHING;

    -- ── 2. Évaluation de test sur l'affectation enseignant Diop ──
    INSERT INTO evaluations (
        id, affectation_id, periode_id, type, numero, titre,
        note_max, date_evaluation, notes_publiees
    ) VALUES (
        v_evaluation_id, v_affectation_id, v_periode_id, 'devoir', 1, 'Devoir de test',
        20, '2025-11-05', FALSE
    )
    ON CONFLICT (id) DO NOTHING;

END $$;
