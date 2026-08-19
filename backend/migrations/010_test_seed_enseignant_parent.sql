-- ============================================================
-- MIGRATION 010 — COMPTES DE TEST ENSEIGNANT + PARENT
-- Complète 009_test_seed.sql (établissement TEST_LBD, directeur)
-- avec un enseignant affecté à la classe existante + un parent
-- lié à un élève existant, pour tester les dashboards mobile.
--
-- Idempotent : utilise ON CONFLICT DO NOTHING.
-- ============================================================

DO $$
DECLARE
    v_etab_id       UUID := '11111111-1111-1111-1111-111111111111'; -- Lycée Test E2E (TEST_LBD)
    v_annee_id      UUID := '22222222-2222-2222-2222-222222222222'; -- 2025-2026
    v_classe_id     UUID := 'e06bc7f0-52e8-411e-8c65-d425c0b9e9c6'; -- Classe A (6ème), déjà seedée ailleurs
    v_matiere_id    UUID;
    v_eleve_id      UUID;
    v_ens_user_id   UUID := '44444444-4444-4444-4444-444444444444';
    v_ens_id        UUID := '44444444-4444-4444-4444-444444444445';
    v_parent_user_id UUID := '55555555-5555-5555-5555-555555555555';
    v_plage_id      UUID := '66666666-6666-6666-6666-666666666666';
    v_affectation_id UUID := '77777777-7777-7777-7777-777777777777';
    v_role_enseignant SMALLINT;
    v_role_parent     SMALLINT;
    v_jour SMALLINT;
BEGIN

    SELECT id INTO v_role_enseignant FROM roles WHERE code = 'enseignant';
    SELECT id INTO v_role_parent     FROM roles WHERE code = 'parent';

    -- Matière 'Mathématiques' scopée à TEST_LBD (v_etab_id) — NE PAS
    -- retirer le filtre etablissement_id : `matieres.code` n'est unique
    -- que par établissement, donc un `LIMIT 1` sans filtre peut piocher
    -- la ligne d'un tout autre établissement (bug corrigé en migration
    -- 016_fix_seed_matiere_cross_etablissement.sql, sur données déjà
    -- insérées via une exécution antérieure de ce fichier).
    INSERT INTO matieres (id, etablissement_id, nom, nom_court, code, compte_dans_moyenne)
    VALUES (uuid_generate_v4(), v_etab_id, 'Mathématiques', 'Maths', 'MATH', TRUE)
    ON CONFLICT (etablissement_id, code) DO NOTHING;

    SELECT id INTO v_matiere_id
    FROM matieres
    WHERE etablissement_id = v_etab_id AND code = 'MATH';

    SELECT e.id INTO v_eleve_id
        FROM eleves e
        JOIN inscriptions i ON i.eleve_id = e.id
        WHERE i.classe_id = v_classe_id
        ORDER BY e.matricule LIMIT 1;

    -- ── 1. Utilisateur enseignant ────────────────────────────
    -- Hash bcrypt pour 'Test1234!' (identique au directeur du seed 009)
    INSERT INTO utilisateurs (
        id, etablissement_id, nom, prenom, email, mot_de_passe_hash, actif
    ) VALUES (
        v_ens_user_id, v_etab_id, 'Diop', 'Amadou', 'enseignant@test.sn',
        '$2a$10$0iwhiiXClQJBP2u.hdiZyu2PT5/6458lgyymijhXCRdNMu0hEvRqS', TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    IF v_role_enseignant IS NOT NULL THEN
        INSERT INTO utilisateur_roles (id, utilisateur_id, role_id, etablissement_id, actif)
        VALUES (uuid_generate_v4(), v_ens_user_id, v_role_enseignant, v_etab_id, TRUE)
        ON CONFLICT (utilisateur_id, role_id, etablissement_id) DO NOTHING;
    END IF;

    INSERT INTO enseignants (id, utilisateur_id, specialite, type_contrat)
    VALUES (v_ens_id, v_ens_user_id, 'Mathématiques', 'titulaire')
    ON CONFLICT (id) DO NOTHING;

    -- ── 2. Utilisateur parent ────────────────────────────────
    -- Pas de mot de passe : connexion uniquement par OTP SMS (comme en prod)
    INSERT INTO utilisateurs (
        id, etablissement_id, nom, prenom, telephone, actif
    ) VALUES (
        v_parent_user_id, v_etab_id, 'Fall', 'Aïssatou', '+221770000099', TRUE
    )
    ON CONFLICT (id) DO NOTHING;

    IF v_role_parent IS NOT NULL THEN
        INSERT INTO utilisateur_roles (id, utilisateur_id, role_id, etablissement_id, actif)
        VALUES (uuid_generate_v4(), v_parent_user_id, v_role_parent, v_etab_id, TRUE)
        ON CONFLICT (utilisateur_id, role_id, etablissement_id) DO NOTHING;
    END IF;

    -- Lien parent → élève existant (premier élève de la classe A)
    IF v_eleve_id IS NOT NULL THEN
        INSERT INTO parents_eleves (
            id, parent_id, eleve_id, lien, est_contact_principal,
            peut_voir_notes, peut_voir_absences, peut_voir_bulletins, peut_voir_discipline
        ) VALUES (
            uuid_generate_v4(), v_parent_user_id, v_eleve_id, 'mere', TRUE,
            TRUE, TRUE, TRUE, TRUE
        )
        ON CONFLICT (parent_id, eleve_id) DO NOTHING;
    END IF;

    -- ── 3. Plage horaire (aucune n'existait pour TEST_LBD) ───
    INSERT INTO plages_horaires (id, etablissement_id, numero, libelle, heure_debut, heure_fin)
    VALUES (v_plage_id, v_etab_id, 1, '8h-9h', '08:00', '09:00')
    ON CONFLICT (etablissement_id, numero) DO NOTHING;

    -- ── 4. Affectation enseignant → classe A, Mathématiques ──
    IF v_matiere_id IS NOT NULL THEN
        INSERT INTO affectations_enseignants (
            id, enseignant_id, classe_id, matiere_id, annee_scolaire_id, est_titulaire
        ) VALUES (
            v_affectation_id, v_ens_id, v_classe_id, v_matiere_id, v_annee_id, TRUE
        )
        ON CONFLICT (classe_id, matiere_id, annee_scolaire_id) DO NOTHING;

        -- ── 5. Emploi du temps — tous les jours ouvrés (1=lundi..5=vendredi) ──
        -- Couvre tous les jours pour que le dashboard enseignant affiche
        -- toujours un cours, quel que soit le jour de test.
        --
        -- ATTENTION : ON CONFLICT (..., date_debut_validite) ne fonctionne
        -- PAS ici — date_debut_validite est NULL, et NULL n'est jamais égal
        -- à NULL pour la déduplication d'une contrainte UNIQUE en Postgres.
        -- Chaque ré-exécution de ce fichier (relance de conteneur Postgres
        -- avec migrations/ monté en docker-entrypoint-initdb.d, ou run
        -- manuel répété) créait donc un doublon silencieux à chaque fois,
        -- constaté en direct : 2 lignes identiques par jour ouvré. D'où le
        -- WHERE NOT EXISTS explicite plutôt que ON CONFLICT.
        FOR v_jour IN 1..5 LOOP
            INSERT INTO emplois_du_temps (
                id, classe_id, affectation_id, plage_id, jour_semaine, salle
            )
            SELECT uuid_generate_v4(), v_classe_id, v_affectation_id, v_plage_id, v_jour, 'Salle 12'
            WHERE NOT EXISTS (
                SELECT 1 FROM emplois_du_temps
                WHERE classe_id = v_classe_id AND plage_id = v_plage_id AND jour_semaine = v_jour
            );
        END LOOP;
    END IF;

END $$;
