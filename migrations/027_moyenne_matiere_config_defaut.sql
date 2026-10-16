-- ============================================================
-- MIGRATION 027 — calculer_moyenne_matiere : valeurs de l'établissement quand aucune config matière × niveau
--
-- Constat (parcours « bulletins » du dashboard) : la fonction lisait ses réglages avec
--   SELECT ... INTO v_nb_devoirs_attendus, v_nb_compos_attendues, v_coef_compo FROM configs_matieres_niveau ...
-- Sans ligne correspondante, PL/pgSQL met les variables INTO à NULL : le coefficient de la composition devenait
-- NULL, la composition n'entrait pas dans le calcul et la moyenne de la matière était fausse (devoirs seuls)
-- ou absente (composition seule). Une école qui n'a pas encore réglé ses coefficients (cas d'une école neuve)
-- obtenait donc des moyennes et des bulletins faux, sans erreur.
--
-- Correctif : on part des valeurs de l'établissement (configs_systeme_notes, défauts 2 / 1 / 2) et la config
-- matière × niveau ne fait que les surcharger. Corps identique à la migration 003 hormis ce bloc.
-- Rejouable : CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION calculer_moyenne_matiere(
    p_inscription_id    UUID,
    p_matiere_id        UUID,
    p_periode_id        UUID
) RETURNS TABLE (
    moyenne             NUMERIC(5,2),
    somme_devoirs       NUMERIC(6,2),
    nb_devoirs_comptes  SMALLINT,
    note_composition    NUMERIC(5,2),
    denominateur        NUMERIC(5,2),
    est_complete        BOOLEAN
) AS $$
DECLARE
    v_config            RECORD;
    v_nb_devoirs_attendus SMALLINT;
    v_nb_compos_attendues SMALLINT;
    v_coef_compo        NUMERIC(3,1);
    v_somme_devoirs     NUMERIC(6,2) := 0;
    v_nb_devoirs        SMALLINT := 0;
    v_note_compo        NUMERIC(5,2) := NULL;
    v_compo_comptee     BOOLEAN := FALSE;
    v_denominateur      NUMERIC(5,2);
    v_moyenne           NUMERIC(5,2);
BEGIN
    -- 1. Charger la configuration de l'établissement
    SELECT
        c.nb_devoirs_par_periode,
        c.nb_compos_par_periode,
        c.coef_composition
    INTO v_config
    FROM configs_systeme_notes c
    JOIN annees_scolaires a ON a.etablissement_id = c.etablissement_id
    JOIN inscriptions i     ON i.annee_scolaire_id = a.id
    WHERE i.id = p_inscription_id;

    -- Valeurs de l'établissement d'abord. Avant la migration 027, le SELECT ... INTO ci-dessous remettait
    -- les trois variables à NULL quand aucune configuration (matière × niveau) n'existait : le coefficient
    -- de la composition devenait NULL et la composition était ignorée en silence (moyenne fausse ou absente
    -- pour toute école qui n'avait pas encore réglé ses coefficients).
    v_nb_devoirs_attendus := COALESCE(v_config.nb_devoirs_par_periode, 2);
    v_nb_compos_attendues := COALESCE(v_config.nb_compos_par_periode, 1);
    v_coef_compo          := COALESCE(v_config.coef_composition, 2);

    -- La config locale (matière × niveau), si elle existe, surcharge les valeurs globales
    SELECT
        COALESCE(cmn.nb_devoirs_periode, v_nb_devoirs_attendus),
        COALESCE(cmn.nb_compos_periode,  v_nb_compos_attendues),
        v_coef_compo
    INTO v_nb_devoirs_attendus, v_nb_compos_attendues, v_coef_compo
    FROM configs_matieres_niveau cmn
    JOIN inscriptions i ON i.id = p_inscription_id
    WHERE cmn.matiere_id = p_matiere_id
      AND cmn.niveau_id = (
          SELECT n.id FROM classes cl JOIN niveaux n ON n.id = cl.niveau_id
          WHERE cl.id = i.classe_id
      )
      AND (cmn.serie_id = i.serie_id OR cmn.serie_id IS NULL)
    LIMIT 1;

    IF NOT FOUND THEN
        v_nb_devoirs_attendus := COALESCE(v_config.nb_devoirs_par_periode, 2);
        v_nb_compos_attendues := COALESCE(v_config.nb_compos_par_periode, 1);
        v_coef_compo          := COALESCE(v_config.coef_composition, 2);
    END IF;

    -- 2. Calculer la somme des devoirs
    SELECT
        COALESCE(SUM(
            CASE
                WHEN n.est_dispense = TRUE              THEN NULL  -- dispensé ignoré
                WHEN n.est_absent AND n.absence_justifiee THEN NULL  -- absent justifié ignoré
                ELSE COALESCE(n.valeur, 0)                          -- absent injustifié = 0
            END
        ), 0),
        COUNT(*) FILTER (
            WHERE NOT (n.est_dispense OR (n.est_absent AND n.absence_justifiee))
        )::SMALLINT
    INTO v_somme_devoirs, v_nb_devoirs
    FROM notes n
    JOIN evaluations ev ON ev.id = n.evaluation_id
    JOIN affectations_enseignants ae ON ae.id = ev.affectation_id
    WHERE n.inscription_id = p_inscription_id
      AND ae.matiere_id = p_matiere_id
      AND ev.periode_id = p_periode_id
      AND ev.type != 'composition';

    -- 3. Récupérer la note de composition
    SELECT
        CASE
            WHEN n.est_dispense = TRUE              THEN NULL
            WHEN n.est_absent AND n.absence_justifiee THEN NULL
            ELSE COALESCE(n.valeur, 0)
        END,
        NOT (n.est_dispense OR (n.est_absent AND n.absence_justifiee))
    INTO v_note_compo, v_compo_comptee
    FROM notes n
    JOIN evaluations ev ON ev.id = n.evaluation_id
    JOIN affectations_enseignants ae ON ae.id = ev.affectation_id
    WHERE n.inscription_id = p_inscription_id
      AND ae.matiere_id = p_matiere_id
      AND ev.periode_id = p_periode_id
      AND ev.type = 'composition'
    LIMIT 1;

    -- 4. Calculer le dénominateur et la moyenne
    v_denominateur := v_nb_devoirs + (CASE WHEN v_compo_comptee THEN v_coef_compo ELSE 0 END);

    IF v_denominateur = 0 THEN
        RETURN QUERY SELECT
            NULL::NUMERIC(5,2),
            v_somme_devoirs,
            v_nb_devoirs,
            v_note_compo,
            v_denominateur,
            FALSE::BOOLEAN;
        RETURN;
    END IF;

    v_moyenne := (v_somme_devoirs + (CASE WHEN v_compo_comptee THEN v_note_compo * v_coef_compo ELSE 0 END))
                 / v_denominateur;

    -- Arrondi au demi-point supérieur (règle francophone)
    v_moyenne := ROUND(v_moyenne::NUMERIC, 2);

    RETURN QUERY SELECT
        v_moyenne,
        v_somme_devoirs,
        v_nb_devoirs,
        v_note_compo,
        v_denominateur,
        (v_nb_devoirs = v_nb_devoirs_attendus AND v_compo_comptee = (v_nb_compos_attendues > 0));
END;
$$ LANGUAGE plpgsql STABLE;
