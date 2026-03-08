-- ============================================================
-- MIGRATION 007 — VUES & FONCTIONS UTILITAIRES
-- Vues pour les interfaces, procédures de calcul en masse,
-- fonctions de rapport, et helpers de synchronisation mobile
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- VUE : Bulletin d'un élève pour une période
-- Agrège toutes les données nécessaires à l'affichage du bulletin
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_bulletins AS
SELECT
    mg.id                           AS bulletin_id,
    mg.inscription_id,
    mg.periode_id,
    mg.moyenne_generale,
    mg.rang,
    mg.rang_sur,
    mg.mention,
    mg.decision_conseil,
    mg.decision_passage,
    mg.nb_absences_justifiees,
    mg.nb_absences_injustifiees,
    mg.nb_heures_absence_just,
    mg.nb_heures_absence_injust,
    mg.nb_retards,
    mg.note_conduite,
    nc.appreciation                 AS appreciation_conduite,
    mg.appreciation_conseil,
    mg.bulletin_genere,
    mg.bulletin_url,

    -- Élève
    u.nom                           AS eleve_nom,
    u.prenom                        AS eleve_prenom,
    u.date_naissance                AS eleve_naissance,
    e.matricule                     AS eleve_matricule,
    i.redoublant,

    -- Classe
    n.nom || ' ' || cl.nom          AS classe_libelle,
    n.nom                           AS niveau,
    s.code                          AS serie_code,
    s.libelle                       AS serie_libelle,

    -- Établissement
    et.nom                          AS etablissement_nom,
    et.ville                        AS etablissement_ville,

    -- Année et période
    a.libelle                       AS annee_libelle,
    p.libelle                       AS periode_libelle,
    p.numero                        AS periode_numero

FROM moyennes_generales mg
JOIN inscriptions i         ON i.id       = mg.inscription_id
JOIN eleves e               ON e.id       = i.eleve_id
JOIN utilisateurs u         ON u.id       = e.utilisateur_id
JOIN classes cl             ON cl.id      = i.classe_id
JOIN niveaux n              ON n.id       = cl.niveau_id
JOIN annees_scolaires a     ON a.id       = i.annee_scolaire_id
JOIN etablissements et      ON et.id      = a.etablissement_id
JOIN periodes p             ON p.id       = mg.periode_id
LEFT JOIN series s          ON s.id       = i.serie_id
LEFT JOIN notes_conduite nc ON nc.inscription_id = mg.inscription_id
                            AND nc.periode_id = mg.periode_id;

COMMENT ON VIEW v_bulletins IS 'Données complètes d''un bulletin. Utilisée par le worker de génération PDF.';


-- ──────────────────────────────────────────────────────────────
-- VUE : Tableau de bord élève
-- Endpoint le plus consulté de l'application mobile
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_tableau_bord_eleve AS
SELECT
    i.id                                AS inscription_id,
    i.eleve_id,
    i.classe_id,
    i.annee_scolaire_id,

    -- Identité
    u.nom,
    u.prenom,
    u.photo_url,
    e.matricule,

    -- Classe courante
    n.nom || ' ' || cl.nom             AS classe_libelle,
    s.code                             AS serie_code,

    -- Moyennes générales (3 trimestres côte à côte)
    mg1.moyenne_generale               AS moy_t1,
    mg1.rang                           AS rang_t1,
    mg2.moyenne_generale               AS moy_t2,
    mg2.rang                           AS rang_t2,
    mg3.moyenne_generale               AS moy_t3,
    mg3.rang                           AS rang_t3,

    -- Absences année complète
    COALESCE(r1.nb_seances_absences_injust, 0) +
    COALESCE(r2.nb_seances_absences_injust, 0) +
    COALESCE(r3.nb_seances_absences_injust, 0) AS abs_injust_annee,

    COALESCE(r1.nb_seances_absences_just, 0) +
    COALESCE(r2.nb_seances_absences_just, 0) +
    COALESCE(r3.nb_seances_absences_just, 0)  AS abs_just_annee,

    -- Statut
    i.statut,
    et.id                              AS etablissement_id,
    a.est_courante

FROM inscriptions i
JOIN eleves e               ON e.id = i.eleve_id
JOIN utilisateurs u         ON u.id = e.utilisateur_id
JOIN classes cl             ON cl.id = i.classe_id
JOIN niveaux n              ON n.id = cl.niveau_id
JOIN annees_scolaires a     ON a.id = i.annee_scolaire_id
JOIN etablissements et      ON et.id = a.etablissement_id
LEFT JOIN series s          ON s.id = i.serie_id

-- Jointures sur les 3 trimestres
LEFT JOIN periodes p1       ON p1.annee_scolaire_id = a.id AND p1.numero = 1
LEFT JOIN periodes p2       ON p2.annee_scolaire_id = a.id AND p2.numero = 2
LEFT JOIN periodes p3       ON p3.annee_scolaire_id = a.id AND p3.numero = 3
LEFT JOIN moyennes_generales mg1 ON mg1.inscription_id = i.id AND mg1.periode_id = p1.id
LEFT JOIN moyennes_generales mg2 ON mg2.inscription_id = i.id AND mg2.periode_id = p2.id
LEFT JOIN moyennes_generales mg3 ON mg3.inscription_id = i.id AND mg3.periode_id = p3.id
LEFT JOIN recapitulatifs_absences r1 ON r1.inscription_id = i.id AND r1.periode_id = p1.id
LEFT JOIN recapitulatifs_absences r2 ON r2.inscription_id = i.id AND r2.periode_id = p2.id
LEFT JOIN recapitulatifs_absences r3 ON r3.inscription_id = i.id AND r3.periode_id = p3.id;

COMMENT ON VIEW v_tableau_bord_eleve IS 'Données synthétiques pour l''écran d''accueil mobile. Endpoint le plus consulté.';


-- ──────────────────────────────────────────────────────────────
-- VUE : Notes d'un élève par matière et par période
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_notes_eleve AS
SELECT
    n.id                            AS note_id,
    n.inscription_id,
    n.valeur,
    n.est_absent,
    n.absence_justifiee,
    n.appreciation,
    n.saisie_at,

    -- Évaluation
    ev.type                         AS type_eval,
    ev.numero                       AS num_eval,
    ev.titre,
    ev.date_evaluation,
    ev.notes_publiees,
    ev.note_max,
    ev.moyenne_classe,

    -- Matière
    m.nom                           AS matiere_nom,
    m.nom_court                     AS matiere_code,
    m.code                          AS matiere_code_ref,
    d.couleur_affichage,

    -- Période
    p.numero                        AS periode_numero,
    p.libelle                       AS periode_libelle,

    -- Moyenne de l'élève dans cette matière pour cette période
    mm.moyenne                      AS moyenne_matiere,
    mm.coefficient,
    mm.rang_dans_classe,

    -- Établissement (pour l'isolation)
    a.etablissement_id

FROM notes n
JOIN evaluations ev             ON ev.id = n.evaluation_id
JOIN affectations_enseignants ae ON ae.id = ev.affectation_id
JOIN matieres m                 ON m.id = ae.matiere_id
JOIN disciplines_matieres d     ON d.id = m.discipline_id
JOIN periodes p                 ON p.id = ev.periode_id
JOIN annees_scolaires a         ON a.id = p.annee_scolaire_id
JOIN inscriptions i             ON i.id = n.inscription_id
LEFT JOIN moyennes_matieres mm  ON mm.inscription_id = n.inscription_id
                               AND mm.matiere_id = m.id
                               AND mm.periode_id = p.id;

COMMENT ON VIEW v_notes_eleve IS 'Toutes les notes d''un élève avec contexte complet. Filtrée côté backend par inscription_id.';


-- ──────────────────────────────────────────────────────────────
-- VUE : Emploi du temps d'une classe ou d'un enseignant
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_emploi_du_temps AS
SELECT
    edt.id,
    edt.classe_id,
    edt.jour_semaine,
    edt.salle,
    edt.date_debut_validite,
    edt.date_fin_validite,
    edt.actif,

    -- Horaire
    ph.numero                       AS plage_numero,
    ph.heure_debut,
    ph.heure_fin,
    ph.libelle                      AS plage_libelle,
    ph.est_pause,

    -- Matière
    m.nom                           AS matiere_nom,
    m.code                          AS matiere_code,
    d.couleur_affichage,

    -- Enseignant
    ae.enseignant_id,
    u.nom                           AS ens_nom,
    u.prenom                        AS ens_prenom,

    -- Classe
    n.nom || ' ' || cl.nom          AS classe_libelle,
    n.cycle,

    -- Établissement
    a.etablissement_id

FROM emplois_du_temps edt
JOIN plages_horaires ph         ON ph.id = edt.plage_id
JOIN affectations_enseignants ae ON ae.id = edt.affectation_id
JOIN matieres m                 ON m.id = ae.matiere_id
JOIN disciplines_matieres d     ON d.id = m.discipline_id
JOIN enseignants ens            ON ens.id = ae.enseignant_id
JOIN utilisateurs u             ON u.id = ens.utilisateur_id
JOIN classes cl                 ON cl.id = edt.classe_id
JOIN niveaux n                  ON n.id = cl.niveau_id
JOIN annees_scolaires a         ON a.id = cl.annee_scolaire_id
WHERE edt.actif = TRUE;

COMMENT ON VIEW v_emploi_du_temps IS 'EDT avec contexte complet. Filtrée par classe_id ou enseignant_id selon le profil.';


-- ──────────────────────────────────────────────────────────────
-- VUE : Statistiques d'absences par classe
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_stats_absences_classe AS
SELECT
    i.classe_id,
    cl.annee_scolaire_id,
    p.id                                    AS periode_id,
    p.numero                                AS periode_numero,
    COUNT(DISTINCT i.id)                    AS nb_eleves,
    SUM(r.nb_seances_absences_injust)       AS total_abs_injust,
    SUM(r.nb_seances_absences_just)         AS total_abs_just,
    SUM(r.nb_seances_retards)               AS total_retards,
    ROUND(AVG(r.nb_seances_absences_injust), 1) AS moy_abs_injust_par_eleve,
    COUNT(*) FILTER (WHERE r.seuil_alerte_atteint) AS nb_eleves_en_alerte,
    a.etablissement_id
FROM inscriptions i
JOIN classes cl                 ON cl.id = i.classe_id
JOIN annees_scolaires a         ON a.id = cl.annee_scolaire_id
JOIN periodes p                 ON p.annee_scolaire_id = a.id
LEFT JOIN recapitulatifs_absences r ON r.inscription_id = i.id AND r.periode_id = p.id
WHERE i.statut = 'actif'
GROUP BY i.classe_id, cl.annee_scolaire_id, p.id, p.numero, a.etablissement_id;

COMMENT ON VIEW v_stats_absences_classe IS 'Statistiques d''absences par classe. Utilisée par le censeur et le directeur.';


-- ──────────────────────────────────────────────────────────────
-- PROCÉDURE : Calcul des moyennes générales pour une classe/période
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE calculer_moyennes_classe(
    p_classe_id     UUID,
    p_periode_id    UUID
)
LANGUAGE plpgsql AS $$
DECLARE
    v_inscription   RECORD;
    v_matiere       RECORD;
    v_calc          RECORD;
    v_total_pts     NUMERIC(8,2);
    v_total_coef    NUMERIC(6,2);
    v_config        RECORD;
BEGIN
    -- Charger la configuration
    SELECT c.* INTO v_config
    FROM configs_systeme_notes c
    JOIN annees_scolaires a ON a.etablissement_id = c.etablissement_id
    JOIN classes cl ON cl.annee_scolaire_id = a.id
    WHERE cl.id = p_classe_id;

    -- Pour chaque élève actif de la classe
    FOR v_inscription IN
        SELECT i.id, i.eleve_id, i.serie_id
        FROM inscriptions i
        WHERE i.classe_id = p_classe_id
          AND i.statut = 'actif'
    LOOP
        v_total_pts  := 0;
        v_total_coef := 0;

        -- Pour chaque matière affectée à cette classe
        FOR v_matiere IN
            SELECT ae.matiere_id, COALESCE(cmn.coefficient, 1) AS coef
            FROM affectations_enseignants ae
            JOIN configs_matieres_niveau cmn
                ON cmn.matiere_id = ae.matiere_id
                AND cmn.niveau_id = (SELECT niveau_id FROM classes WHERE id = p_classe_id)
                AND (cmn.serie_id = v_inscription.serie_id OR cmn.serie_id IS NULL)
                AND cmn.annee_scolaire_id = (
                    SELECT annee_scolaire_id FROM periodes WHERE id = p_periode_id
                )
            WHERE ae.classe_id = p_classe_id
        LOOP
            -- Calculer la moyenne de cet élève dans cette matière
            SELECT * INTO v_calc
            FROM calculer_moyenne_matiere(v_inscription.id, v_matiere.matiere_id, p_periode_id);

            -- Insérer ou mettre à jour la moyenne matière
            INSERT INTO moyennes_matieres (
                inscription_id, matiere_id, periode_id,
                moyenne, coefficient, points,
                somme_notes_devoirs, nb_devoirs_comptes, note_composition,
                denominateur, est_complete, calculee_at
            ) VALUES (
                v_inscription.id, v_matiere.matiere_id, p_periode_id,
                v_calc.moyenne, v_matiere.coef,
                CASE WHEN v_calc.moyenne IS NOT NULL
                     THEN ROUND(v_calc.moyenne * v_matiere.coef, 4) ELSE NULL END,
                v_calc.somme_devoirs, v_calc.nb_devoirs_comptes, v_calc.note_composition,
                v_calc.denominateur, v_calc.est_complete, now()
            )
            ON CONFLICT (inscription_id, matiere_id, periode_id)
            DO UPDATE SET
                moyenne              = EXCLUDED.moyenne,
                coefficient          = EXCLUDED.coefficient,
                points               = EXCLUDED.points,
                somme_notes_devoirs  = EXCLUDED.somme_notes_devoirs,
                nb_devoirs_comptes   = EXCLUDED.nb_devoirs_comptes,
                note_composition     = EXCLUDED.note_composition,
                denominateur         = EXCLUDED.denominateur,
                est_complete         = EXCLUDED.est_complete,
                calculee_at          = now();

            -- Accumuler pour la moyenne générale
            IF v_calc.moyenne IS NOT NULL THEN
                v_total_pts  := v_total_pts  + (v_calc.moyenne * v_matiere.coef);
                v_total_coef := v_total_coef + v_matiere.coef;
            END IF;
        END LOOP;

        -- Calculer et insérer la moyenne générale
        INSERT INTO moyennes_generales (
            inscription_id, periode_id,
            total_points, total_coefficients, moyenne_generale,
            calculee_at
        ) VALUES (
            v_inscription.id, p_periode_id,
            v_total_pts, v_total_coef,
            CASE WHEN v_total_coef > 0
                 THEN ROUND(v_total_pts / v_total_coef, 2) ELSE NULL END,
            now()
        )
        ON CONFLICT (inscription_id, periode_id)
        DO UPDATE SET
            total_points         = EXCLUDED.total_points,
            total_coefficients   = EXCLUDED.total_coefficients,
            moyenne_generale     = EXCLUDED.moyenne_generale,
            calculee_at          = now();
    END LOOP;

    -- Calculer les rangs après toutes les moyennes
    CALL calculer_rangs_classe(p_classe_id, p_periode_id);

    RAISE NOTICE 'Calcul terminé pour la classe % / période %', p_classe_id, p_periode_id;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- PROCÉDURE : Calcul des rangs dans une classe
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE calculer_rangs_classe(
    p_classe_id     UUID,
    p_periode_id    UUID
)
LANGUAGE plpgsql AS $$
BEGIN
    -- Mise à jour des rangs dans moyennes_generales
    WITH rangs AS (
        SELECT
            mg.id,
            RANK() OVER (
                PARTITION BY i.classe_id, mg.periode_id
                ORDER BY mg.moyenne_generale DESC NULLS LAST
            )::SMALLINT AS rang,
            COUNT(*) OVER (
                PARTITION BY i.classe_id, mg.periode_id
            )::SMALLINT AS rang_sur
        FROM moyennes_generales mg
        JOIN inscriptions i ON i.id = mg.inscription_id
        WHERE i.classe_id = p_classe_id
          AND mg.periode_id = p_periode_id
          AND i.statut = 'actif'
    )
    UPDATE moyennes_generales mg
    SET rang     = rangs.rang,
        rang_sur = rangs.rang_sur
    FROM rangs
    WHERE mg.id = rangs.id;

    -- Mise à jour des rangs dans moyennes_matieres
    WITH rangs_mat AS (
        SELECT
            mm.id,
            RANK() OVER (
                PARTITION BY i.classe_id, mm.matiere_id, mm.periode_id
                ORDER BY mm.moyenne DESC NULLS LAST
            )::SMALLINT AS rang,
            COUNT(*) OVER (
                PARTITION BY i.classe_id, mm.matiere_id, mm.periode_id
            )::SMALLINT AS rang_sur
        FROM moyennes_matieres mm
        JOIN inscriptions i ON i.id = mm.inscription_id
        WHERE i.classe_id = p_classe_id
          AND mm.periode_id = p_periode_id
          AND i.statut = 'actif'
    )
    UPDATE moyennes_matieres mm
    SET rang_dans_classe = rangs_mat.rang,
        rang_sur         = rangs_mat.rang_sur
    FROM rangs_mat
    WHERE mm.id = rangs_mat.id;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- FONCTION : Payload de synchronisation mobile (descendante)
-- Retourne toutes les données modifiées depuis un timestamp
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_sync_payload_enseignant(
    p_enseignant_id     UUID,
    p_etablissement_id  UUID,
    p_depuis            TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
BEGIN
    SELECT jsonb_build_object(
        'sync_at', now(),
        'classes', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', cl.id,
                'libelle', n.nom || ' ' || cl.nom,
                'niveau', n.nom,
                'cycle', n.cycle
            ))
            FROM affectations_enseignants ae
            JOIN classes cl ON cl.id = ae.classe_id
            JOIN niveaux n  ON n.id  = cl.niveau_id
            JOIN annees_scolaires a ON a.id = cl.annee_scolaire_id
            WHERE ae.enseignant_id = p_enseignant_id
              AND a.etablissement_id = p_etablissement_id
              AND a.est_courante = TRUE
        ),
        'evaluations', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', ev.id,
                'type', ev.type,
                'numero', ev.numero,
                'titre', ev.titre,
                'date_evaluation', ev.date_evaluation,
                'notes_publiees', ev.notes_publiees,
                'affectation_id', ev.affectation_id,
                'periode_id', ev.periode_id,
                'updated_at', ev.updated_at
            ))
            FROM evaluations ev
            JOIN affectations_enseignants ae ON ae.id = ev.affectation_id
            WHERE ae.enseignant_id = p_enseignant_id
              AND ev.updated_at > p_depuis
        ),
        'edt', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', edt.id,
                'classe_id', edt.classe_id,
                'jour_semaine', edt.jour_semaine,
                'heure_debut', ph.heure_debut,
                'heure_fin', ph.heure_fin,
                'matiere', m.nom,
                'salle', edt.salle
            ))
            FROM emplois_du_temps edt
            JOIN affectations_enseignants ae ON ae.id = edt.affectation_id
            JOIN plages_horaires ph ON ph.id = edt.plage_id
            JOIN matieres m ON m.id = ae.matiere_id
            WHERE ae.enseignant_id = p_enseignant_id
              AND edt.actif = TRUE
        )
    ) INTO v_payload;

    RETURN v_payload;
END;
$$ LANGUAGE plpgsql STABLE;


-- Payload pour l'application parent
CREATE OR REPLACE FUNCTION get_sync_payload_parent(
    p_parent_id         UUID,
    p_depuis            TIMESTAMPTZ
) RETURNS JSONB AS $$
DECLARE
    v_payload JSONB;
BEGIN
    SELECT jsonb_build_object(
        'sync_at', now(),
        'enfants', (
            SELECT jsonb_agg(jsonb_build_object(
                'eleve_id', e.id,
                'nom', u.nom,
                'prenom', u.prenom,
                'photo_url', u.photo_url,
                'inscription_id', i.id,
                'classe', n.nom || ' ' || cl.nom,
                'serie', s.code
            ))
            FROM parents_eleves pe
            JOIN eleves e           ON e.id = pe.eleve_id
            JOIN utilisateurs u     ON u.id = e.utilisateur_id
            JOIN inscriptions i     ON i.eleve_id = e.id
            JOIN classes cl         ON cl.id = i.classe_id
            JOIN niveaux n          ON n.id = cl.niveau_id
            JOIN annees_scolaires a ON a.id = i.annee_scolaire_id
            LEFT JOIN series s      ON s.id = i.serie_id
            WHERE pe.parent_id = p_parent_id
              AND a.est_courante = TRUE
              AND i.statut = 'actif'
        ),
        'notes_publiees', (
            SELECT jsonb_agg(jsonb_build_object(
                'note_id', n.id,
                'inscription_id', n.inscription_id,
                'valeur', n.valeur,
                'matiere', m.nom,
                'type_eval', ev.type,
                'date_evaluation', ev.date_evaluation,
                'moyenne_classe', ev.moyenne_classe,
                'publie_at', ev.publie_at
            ))
            FROM parents_eleves pe
            JOIN inscriptions i     ON i.eleve_id = pe.eleve_id
            JOIN notes n            ON n.inscription_id = i.id
            JOIN evaluations ev     ON ev.id = n.evaluation_id
            JOIN affectations_enseignants ae ON ae.id = ev.affectation_id
            JOIN matieres m         ON m.id = ae.matiere_id
            JOIN annees_scolaires a ON a.id = (SELECT annee_scolaire_id FROM periodes WHERE id = ev.periode_id)
            WHERE pe.parent_id = p_parent_id
              AND a.est_courante = TRUE
              AND ev.notes_publiees = TRUE
              AND ev.publie_at > p_depuis
        ),
        'absences', (
            SELECT jsonb_agg(jsonb_build_object(
                'presence_id', pr.id,
                'inscription_id', pr.inscription_id,
                'statut', pr.statut,
                'date_cours', ap.date_cours,
                'est_justifie', pr.est_justifie,
                'saisie_at', pr.saisie_at
            ))
            FROM parents_eleves pe
            JOIN inscriptions i     ON i.eleve_id = pe.eleve_id
            JOIN presences pr       ON pr.inscription_id = i.id
            JOIN appels ap          ON ap.id = pr.appel_id
            JOIN emplois_du_temps edt ON edt.id = ap.emploi_du_temps_id
            JOIN annees_scolaires a ON a.id = edt.annee_scolaire_id
            WHERE pe.parent_id = p_parent_id
              AND a.est_courante = TRUE
              AND pr.statut != 'present'
              AND pr.saisie_at > p_depuis
        )
    ) INTO v_payload;

    RETURN v_payload;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_sync_payload_enseignant IS 'Payload de sync différentielle pour l''app mobile enseignant.';
COMMENT ON FUNCTION get_sync_payload_parent      IS 'Payload de sync différentielle pour l''app mobile parent.';


-- ──────────────────────────────────────────────────────────────
-- FONCTION : Tableau de bord administration
-- Indicateurs clés pour la page d'accueil du directeur
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_dashboard_etablissement(
    p_etablissement_id  UUID
) RETURNS JSONB AS $$
DECLARE
    v_annee_id  UUID;
BEGIN
    -- Trouver l'année courante
    SELECT id INTO v_annee_id
    FROM annees_scolaires
    WHERE etablissement_id = p_etablissement_id
      AND est_courante = TRUE;

    RETURN jsonb_build_object(
        'annee_id', v_annee_id,

        'nb_eleves_actifs', (
            SELECT COUNT(*) FROM inscriptions i
            JOIN classes cl ON cl.id = i.classe_id
            WHERE cl.annee_scolaire_id = v_annee_id AND i.statut = 'actif'
        ),
        'nb_classes', (
            SELECT COUNT(*) FROM classes WHERE annee_scolaire_id = v_annee_id AND actif = TRUE
        ),
        'nb_enseignants', (
            SELECT COUNT(DISTINCT enseignant_id)
            FROM affectations_enseignants WHERE annee_scolaire_id = v_annee_id
        ),

        -- Absences du jour
        'absences_aujourd_hui', (
            SELECT COUNT(*)
            FROM presences pr
            JOIN appels ap ON ap.id = pr.appel_id
            JOIN emplois_du_temps edt ON edt.id = ap.emploi_du_temps_id
            JOIN classes cl ON cl.id = edt.classe_id
            WHERE cl.annee_scolaire_id = v_annee_id
              AND ap.date_cours = CURRENT_DATE
              AND pr.statut = 'absent'
              AND pr.est_justifie = FALSE
        ),

        -- Incidents ouverts
        'incidents_ouverts', (
            SELECT COUNT(*)
            FROM incidents_discipline id2
            JOIN inscriptions i ON i.id = id2.inscription_id
            JOIN classes cl ON cl.id = i.classe_id
            WHERE cl.annee_scolaire_id = v_annee_id
              AND id2.statut != 'clos'
        ),

        -- Notifications en attente
        'notifs_en_attente', (
            SELECT COUNT(*)
            FROM taches_notifications tn
            JOIN inscriptions i ON i.id = tn.inscription_id
            JOIN classes cl ON cl.id = i.classe_id
            WHERE cl.annee_scolaire_id = v_annee_id
              AND tn.statut = 'en_attente'
        )
    );
END;
$$ LANGUAGE plpgsql STABLE;


DO $$
BEGIN
  RAISE NOTICE 'Migration 007 terminée — Vues et fonctions créées :';
  RAISE NOTICE '  Vues : v_bulletins, v_tableau_bord_eleve, v_notes_eleve, v_emploi_du_temps, v_stats_absences_classe';
  RAISE NOTICE '  Procédures : calculer_moyennes_classe(), calculer_rangs_classe()';
  RAISE NOTICE '  Fonctions : get_sync_payload_enseignant(), get_sync_payload_parent(), get_dashboard_etablissement()';
END;
$$;
