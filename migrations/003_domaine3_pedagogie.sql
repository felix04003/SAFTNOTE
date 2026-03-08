-- ============================================================
-- MIGRATION 003 — DOMAINE 3 : Pédagogie Francophone
-- Tables : configs_systeme_notes, grilles_appreciations,
--          series, disciplines_matieres, matieres,
--          configs_matieres_niveau, affectations_enseignants,
--          evaluations, notes, moyennes_matieres,
--          notes_conduite, moyennes_generales
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE 15 — configs_systeme_notes
-- Configuration centrale du système de notation par établissement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE configs_systeme_notes (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id            UUID         NOT NULL UNIQUE
                                    REFERENCES etablissements(id) ON DELETE CASCADE,

    -- Échelle de notation (francophone = sur 20)
    note_min                    NUMERIC(4,2) NOT NULL DEFAULT 0,
    note_max                    NUMERIC(4,2) NOT NULL DEFAULT 20,
    note_passage                NUMERIC(4,2) NOT NULL DEFAULT 10,   -- Seuil de la moyenne générale
    nb_decimales                SMALLINT     NOT NULL DEFAULT 2,

    -- Structure des évaluations par période
    -- Formule : (somme_devoirs + coef_compo × compo) / dénominateur
    nb_devoirs_par_periode      SMALLINT     NOT NULL DEFAULT 2,
    nb_compos_par_periode       SMALLINT     NOT NULL DEFAULT 1,
    coef_composition            NUMERIC(3,1) NOT NULL DEFAULT 2,    -- 1 compo = 2 devoirs
    -- Dénominateur calculé = nb_devoirs + (nb_compos × coef_composition) = 4

    -- Note de conduite
    conduite_active             BOOLEAN      NOT NULL DEFAULT TRUE,
    conduite_note_max           NUMERIC(4,2) NOT NULL DEFAULT 10,   -- Sur 10 ou sur 20
    conduite_coefficient        SMALLINT     NOT NULL DEFAULT 1,
    conduite_est_eliminatoire   BOOLEAN      NOT NULL DEFAULT FALSE,
    conduite_seuil_elim         NUMERIC(4,2) DEFAULT 5,             -- En dessous = éliminatoire

    -- Règles de passage
    compensation_autorisee      BOOLEAN      NOT NULL DEFAULT TRUE,
    matieres_eliminatoires      BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Mentions du conseil de classe (seuils sur la moyenne générale)
    seuil_felicitations         NUMERIC(4,2) NOT NULL DEFAULT 16,
    seuil_encouragements        NUMERIC(4,2) NOT NULL DEFAULT 14,
    seuil_tableau_honneur       NUMERIC(4,2) NOT NULL DEFAULT 12,   -- Certains établissements
    seuil_avert_travail         NUMERIC(4,2) NOT NULL DEFAULT 8,
    seuil_avert_conduite        NUMERIC(4,2) NOT NULL DEFAULT 5,    -- Seuil sur la note de conduite

    -- Arrondi
    arrondi_methode             VARCHAR(20)  NOT NULL DEFAULT 'demi_superieur'
                                    CHECK (arrondi_methode IN ('demi_superieur', 'inferieur', 'superieur')),

    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE configs_systeme_notes IS 'Configuration centrale. Une ligne par établissement. Francophone = sur 20, 3 trimestres, formule (D1+D2+2C)/4.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 16 — grilles_appreciations
-- Appréciations automatiques selon la note obtenue
-- ──────────────────────────────────────────────────────────────
CREATE TABLE grilles_appreciations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID         NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    note_min            NUMERIC(4,2) NOT NULL,
    note_max            NUMERIC(4,2) NOT NULL,
    appreciation        VARCHAR(50)  NOT NULL,   -- 'Excellent', 'Très bien', 'Bien'...
    ordre               SMALLINT     NOT NULL,

    CONSTRAINT chk_grille_notes CHECK (note_max > note_min),
    UNIQUE (etablissement_id, note_min)
);

CREATE INDEX idx_grilles_etablissement ON grilles_appreciations(etablissement_id, note_min);

-- Fonction d'initialisation automatique à la création d'un établissement
CREATE OR REPLACE FUNCTION initialiser_grille_appreciations(p_etab_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO grilles_appreciations (etablissement_id, note_min, note_max, appreciation, ordre)
    VALUES
        (p_etab_id,  18.00, 20.00, 'Excellent',         1),
        (p_etab_id,  16.00, 17.99, 'Très bien',         2),
        (p_etab_id,  14.00, 15.99, 'Bien',              3),
        (p_etab_id,  12.00, 13.99, 'Assez bien',        4),
        (p_etab_id,  10.00, 11.99, 'Passable',          5),
        (p_etab_id,   5.00,  9.99, 'Insuffisant',       6),
        (p_etab_id,   0.00,  4.99, 'Très insuffisant',  7);
END;
$$ LANGUAGE plpgsql;

-- Fonction utilitaire : retourne l'appréciation pour une note donnée
CREATE OR REPLACE FUNCTION get_appreciation(p_etab_id UUID, p_note NUMERIC)
RETURNS VARCHAR AS $$
    SELECT appreciation
    FROM grilles_appreciations
    WHERE etablissement_id = p_etab_id
      AND p_note BETWEEN note_min AND note_max
    LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON TABLE grilles_appreciations IS 'Grille des appréciations. Initialisée par initialiser_grille_appreciations() à la création de l''établissement.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 17 — series
-- Séries du lycée par pays (S1/Mali, L/Sénégal, C/CIV, etc.)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE series (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    pays                VARCHAR(50) NOT NULL,
    code                VARCHAR(10) NOT NULL,
    libelle             VARCHAR(150) NOT NULL,
    type                VARCHAR(20) NOT NULL
                            CHECK (type IN ('scientifique', 'litteraire', 'technique', 'gestion', 'franco_arabe')),
    actif               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (etablissement_id, pays, code)
);

CREATE INDEX idx_series_etablissement ON series(etablissement_id, pays);

COMMENT ON TABLE series IS 'Séries du lycée par pays. Le même code peut exister dans plusieurs pays (C au Mali = S1 au Sénégal en mathématiques).';


-- FK vers series depuis inscriptions (ajout différé car series n'existait pas en migration 002)
ALTER TABLE inscriptions
    ADD CONSTRAINT fk_inscriptions_serie
    FOREIGN KEY (serie_id) REFERENCES series(id) ON DELETE SET NULL;


-- ──────────────────────────────────────────────────────────────
-- TABLE 18 — disciplines_matieres
-- Regroupement des matières par domaine disciplinaire
-- ──────────────────────────────────────────────────────────────
CREATE TABLE disciplines_matieres (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    nom                 VARCHAR(100) NOT NULL,
    code                VARCHAR(20) NOT NULL,
    couleur_affichage   VARCHAR(7),     -- Code HEX (#2196F3)
    ordre               SMALLINT,

    UNIQUE (etablissement_id, code)
);

COMMENT ON TABLE disciplines_matieres IS 'Regroupement disciplinaire. Utilisé pour la compensation et les affichages groupés dans l''interface.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 19 — matieres
-- Référentiel des matières de l'établissement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE matieres (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id        UUID         NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    discipline_id           UUID         REFERENCES disciplines_matieres(id) ON DELETE SET NULL,
    nom                     VARCHAR(150) NOT NULL,
    nom_court               VARCHAR(20),
    code                    VARCHAR(20)  NOT NULL,

    -- Comportement dans les calculs
    compte_dans_moyenne     BOOLEAN      NOT NULL DEFAULT TRUE,  -- EPS peut ne pas compter
    est_eliminatoire        BOOLEAN      NOT NULL DEFAULT FALSE,
    seuil_eliminatoire      NUMERIC(4,2),                        -- En dessous = bloque le passage
    est_optionnelle         BOOLEAN      NOT NULL DEFAULT FALSE,

    actif                   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (etablissement_id, code)
);

CREATE INDEX idx_matieres_etablissement ON matieres(etablissement_id, actif);

COMMENT ON TABLE matieres IS 'Référentiel des matières. Un référentiel commun francophone couvre ~20 matières standards.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 20 — configs_matieres_niveau
-- TABLE PIVOT DU PARAMÉTRAGE
-- Coefficients par niveau × matière × série × année
-- C'est ici que réside 100% de la différence entre pays
-- ──────────────────────────────────────────────────────────────
CREATE TABLE configs_matieres_niveau (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    niveau_id           UUID         NOT NULL REFERENCES niveaux(id) ON DELETE CASCADE,
    matiere_id          UUID         NOT NULL REFERENCES matieres(id) ON DELETE CASCADE,
    serie_id            UUID         REFERENCES series(id) ON DELETE CASCADE,
                        -- NULL = s'applique à tous les élèves du niveau (collège, primaire)
                        -- Renseigné = spécifique à cette série (lycée)
    annee_scolaire_id   UUID         NOT NULL REFERENCES annees_scolaires(id) ON DELETE CASCADE,

    -- LE coefficient — seul paramètre qui varie entre pays
    coefficient         NUMERIC(4,2) NOT NULL DEFAULT 1
                            CHECK (coefficient > 0),

    -- Surcharges locales (par rapport aux règles générales de l'établissement)
    est_eliminatoire    BOOLEAN      NOT NULL DEFAULT FALSE,
    seuil_eliminatoire  NUMERIC(4,2),
    nb_devoirs_periode  SMALLINT,   -- NULL = reprend configs_systeme_notes
    nb_compos_periode   SMALLINT,   -- NULL = reprend configs_systeme_notes

    est_obligatoire     BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (niveau_id, matiere_id, serie_id, annee_scolaire_id)
);

CREATE INDEX idx_configs_niveau    ON configs_matieres_niveau(niveau_id, annee_scolaire_id);
CREATE INDEX idx_configs_serie     ON configs_matieres_niveau(serie_id) WHERE serie_id IS NOT NULL;

CREATE TRIGGER trg_configs_updated_at
    BEFORE UPDATE ON configs_matieres_niveau
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE configs_matieres_niveau IS 'TABLE PIVOT. Changer de pays = changer les lignes ici. Le moteur de calcul ne change pas.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 21 — affectations_enseignants
-- Quel enseignant enseigne quoi dans quelle classe
-- ──────────────────────────────────────────────────────────────
CREATE TABLE affectations_enseignants (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    enseignant_id       UUID        NOT NULL REFERENCES enseignants(id) ON DELETE RESTRICT,
    classe_id           UUID        NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    matiere_id          UUID        NOT NULL REFERENCES matieres(id) ON DELETE RESTRICT,
    annee_scolaire_id   UUID        NOT NULL REFERENCES annees_scolaires(id) ON DELETE RESTRICT,
    est_titulaire       BOOLEAN     NOT NULL DEFAULT TRUE,  -- Titulaire ou remplaçant
    date_debut          DATE        NOT NULL DEFAULT CURRENT_DATE,
    date_fin            DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Une seule affectation par classe/matière/année
    UNIQUE (classe_id, matiere_id, annee_scolaire_id)
);

CREATE INDEX idx_affectations_enseignant ON affectations_enseignants(enseignant_id, annee_scolaire_id);
CREATE INDEX idx_affectations_classe     ON affectations_enseignants(classe_id, annee_scolaire_id);

COMMENT ON TABLE affectations_enseignants IS 'Qui enseigne quoi où. UNIQUE (classe_id, matiere_id, annee_scolaire_id).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 22 — evaluations
-- Devoirs et compositions planifiés ou réalisés
-- ──────────────────────────────────────────────────────────────
CREATE TABLE evaluations (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    affectation_id      UUID         NOT NULL REFERENCES affectations_enseignants(id) ON DELETE RESTRICT,
    periode_id          UUID         NOT NULL REFERENCES periodes(id) ON DELETE RESTRICT,

    -- Identification
    type                VARCHAR(20)  NOT NULL
                            CHECK (type IN ('devoir', 'composition', 'interrogation', 'tp', 'expose')),
    numero              SMALLINT     NOT NULL,   -- Devoir n°1, Devoir n°2, Composition n°1
    titre               VARCHAR(200),            -- Titre optionnel

    -- Barème
    note_max            NUMERIC(4,2) NOT NULL DEFAULT 20,
    -- Le coefficient interne est déduit du type :
    -- devoir / interrogation / tp / exposé → 1
    -- composition → valeur de configs_systeme_notes.coef_composition (= 2)

    -- Dates
    date_evaluation     DATE,
    date_retour_prevu   DATE,
    date_notes_saisies  TIMESTAMPTZ, -- Quand l'enseignant a terminé la saisie

    -- Visibilité parents
    notes_publiees      BOOLEAN      NOT NULL DEFAULT FALSE,
    publie_at           TIMESTAMPTZ,

    -- Statistiques classe (cache — mis à jour lors de la saisie des notes)
    moyenne_classe      NUMERIC(5,2),
    note_min_classe     NUMERIC(5,2),
    note_max_classe     NUMERIC(5,2),
    nb_copies           SMALLINT     NOT NULL DEFAULT 0,
    nb_absents          SMALLINT     NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Un seul devoir n°1 par affectation+période
    UNIQUE (affectation_id, type, numero, periode_id)
);

CREATE INDEX idx_evaluations_affectation ON evaluations(affectation_id);
CREATE INDEX idx_evaluations_periode     ON evaluations(periode_id);

CREATE TRIGGER trg_evaluations_updated_at
    BEFORE UPDATE ON evaluations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE evaluations IS 'Devoirs et compositions. Le coefficient interne est déduit du type (composition = 2, devoir = 1).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 23 — notes
-- Note d'un élève à une évaluation
-- Table la plus volumineuse du système
-- ──────────────────────────────────────────────────────────────
CREATE TABLE notes (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_id       UUID         NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    eleve_id            UUID         NOT NULL REFERENCES eleves(id) ON DELETE RESTRICT,
    inscription_id      UUID         NOT NULL REFERENCES inscriptions(id) ON DELETE RESTRICT,

    -- La note
    valeur              NUMERIC(5,2)
                            CHECK (valeur IS NULL OR (valeur >= 0 AND valeur <= 20)),
    -- Règles absence francophone :
    -- Absent non justifié → valeur = 0
    -- Absent justifié     → valeur = NULL (ignoré du calcul)
    -- Dispensé            → valeur = NULL (ignoré du calcul)
    est_absent          BOOLEAN      NOT NULL DEFAULT FALSE,
    absence_justifiee   BOOLEAN      NOT NULL DEFAULT FALSE,
    est_dispense        BOOLEAN      NOT NULL DEFAULT FALSE,

    -- Appréciation de l'enseignant sur cette copie
    appreciation        TEXT,

    -- Traçabilité
    saisie_par          UUID         REFERENCES utilisateurs(id) ON DELETE SET NULL,
    saisie_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    modifie_par         UUID         REFERENCES utilisateurs(id) ON DELETE SET NULL,
    modifie_at          TIMESTAMPTZ,

    UNIQUE (evaluation_id, eleve_id)
);

CREATE INDEX idx_notes_eleve      ON notes(eleve_id);
CREATE INDEX idx_notes_evaluation ON notes(evaluation_id);
CREATE INDEX idx_notes_inscription ON notes(inscription_id);

-- Contrainte : si absent justifié ou dispensé, la valeur doit être NULL
ALTER TABLE notes ADD CONSTRAINT chk_note_absence
    CHECK (
        NOT (est_absent = TRUE AND absence_justifiee = TRUE AND valeur IS NOT NULL)
        AND
        NOT (est_dispense = TRUE AND valeur IS NOT NULL)
    );

COMMENT ON TABLE notes IS 'Table la plus volumineuse du système. UNIQUE (evaluation_id, eleve_id). Absent justifié → valeur NULL (ignoré du calcul).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 24 — moyennes_matieres
-- Cache des moyennes par matière, par période, par élève
-- ──────────────────────────────────────────────────────────────
CREATE TABLE moyennes_matieres (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id          UUID         NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    matiere_id              UUID         NOT NULL REFERENCES matieres(id) ON DELETE RESTRICT,
    periode_id              UUID         NOT NULL REFERENCES periodes(id) ON DELETE RESTRICT,

    -- Résultat
    moyenne                 NUMERIC(5,2),
    coefficient             NUMERIC(4,2),
    points                  NUMERIC(7,2),        -- moyenne × coefficient (pour moy. générale)

    -- Détail du calcul (transparence sur le bulletin)
    somme_notes_devoirs     NUMERIC(6,2),
    nb_devoirs_comptes      SMALLINT,
    note_composition        NUMERIC(5,2),
    denominateur            NUMERIC(5,2),        -- Ex : 4 pour (D1+D2+2C)/4

    -- Appréciation de l'enseignant pour la période
    appreciation_enseignant TEXT,
    rang_dans_classe        SMALLINT,
    rang_sur                SMALLINT,

    -- Indicateurs
    nb_notes_saisies        SMALLINT     NOT NULL DEFAULT 0,
    est_complete            BOOLEAN      NOT NULL DEFAULT FALSE,  -- Toutes les notes attendues saisies
    a_note_eliminatoire     BOOLEAN      NOT NULL DEFAULT FALSE,

    calculee_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (inscription_id, matiere_id, periode_id)
);

CREATE INDEX idx_moy_mat_inscription ON moyennes_matieres(inscription_id, periode_id);
CREATE INDEX idx_moy_mat_matiere     ON moyennes_matieres(matiere_id, periode_id);

COMMENT ON TABLE moyennes_matieres IS 'Cache des moyennes. Calculé par le moteur, pas recalculé à chaque consultation.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 25 — notes_conduite
-- Note de conduite (spécifique au système francophone)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE notes_conduite (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id      UUID         NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    periode_id          UUID         NOT NULL REFERENCES periodes(id) ON DELETE RESTRICT,

    valeur              NUMERIC(4,2)
                            CHECK (valeur IS NULL OR (valeur >= 0 AND valeur <= 20)),
    appreciation        VARCHAR(50),
                        -- 'Très bien', 'Bien', 'Assez bien', 'Passable',
                        -- 'Mauvaise conduite', 'Très mauvaise conduite'
    commentaire         TEXT,
    saisie_par          UUID         REFERENCES utilisateurs(id) ON DELETE SET NULL,
    saisie_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (inscription_id, periode_id)
);

COMMENT ON TABLE notes_conduite IS 'Note de conduite — spécifique au système francophone. Délibérée en conseil de classe.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 26 — moyennes_generales
-- Résultat final du moteur de calcul — contient tout le bulletin
-- ──────────────────────────────────────────────────────────────
CREATE TABLE moyennes_generales (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id              UUID         NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    periode_id                  UUID         NOT NULL REFERENCES periodes(id) ON DELETE RESTRICT,

    -- Calcul
    total_points                NUMERIC(8,2),    -- Somme des (moy_matière × coef)
    total_coefficients          NUMERIC(6,2),    -- Somme des coefficients
    moyenne_generale            NUMERIC(5,2),    -- total_points / total_coefficients
    note_conduite               NUMERIC(4,2),

    -- Classement
    rang                        SMALLINT,
    rang_sur                    SMALLINT,        -- Nb d'élèves classés dans la classe

    -- Mentions et décisions du conseil de classe
    mention                     VARCHAR(50),
                                -- 'Très bien', 'Bien', 'Assez bien', 'Passable', 'Insuffisant'
    decision_conseil            VARCHAR(50),
                                -- 'felicitations', 'encouragements', 'tableau_honneur',
                                -- 'avert_travail', 'avert_conduite', 'aucune'
    decision_passage            VARCHAR(30),
                                -- 'admis', 'ajourne', 'redoublant', 'exclu', 'en_attente'

    -- Absences du trimestre (pour le bulletin)
    nb_absences_justifiees      SMALLINT     NOT NULL DEFAULT 0,
    nb_absences_injustifiees    SMALLINT     NOT NULL DEFAULT 0,
    nb_heures_absence_just      NUMERIC(5,1) NOT NULL DEFAULT 0,
    nb_heures_absence_injust    NUMERIC(5,1) NOT NULL DEFAULT 0,
    nb_retards                  SMALLINT     NOT NULL DEFAULT 0,

    -- Appréciation du conseil de classe
    appreciation_conseil        TEXT,

    -- Validation et bulletin
    delibere_at                 TIMESTAMPTZ,
    valide_par                  UUID         REFERENCES utilisateurs(id) ON DELETE SET NULL,
    valide_at                   TIMESTAMPTZ,
    bulletin_genere             BOOLEAN      NOT NULL DEFAULT FALSE,
    bulletin_url                TEXT,            -- URL du PDF (MinIO/S3)
    bulletin_genere_at          TIMESTAMPTZ,

    calculee_at                 TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (inscription_id, periode_id)
);

CREATE INDEX idx_moy_gen_inscription ON moyennes_generales(inscription_id);
CREATE INDEX idx_moy_gen_periode     ON moyennes_generales(periode_id);
CREATE INDEX idx_moy_gen_bulletin    ON moyennes_generales(periode_id, bulletin_genere)
    WHERE bulletin_genere = FALSE;

CREATE TRIGGER trg_moy_gen_updated_at
    BEFORE UPDATE ON moyennes_generales
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE moyennes_generales IS 'Résultat final du moteur. Contient tout ce qui apparaît sur le bulletin scolaire.';


-- ──────────────────────────────────────────────────────────────
-- MOTEUR DE CALCUL — Fonction principale
-- Calcule la moyenne d'un élève dans une matière pour une période
-- Applique la formule francophone : (D1 + D2 + 2×C) / 4
-- ──────────────────────────────────────────────────────────────
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

    -- Vérifier si la config locale surcharge les valeurs globales
    SELECT
        COALESCE(cmn.nb_devoirs_periode, v_config.nb_devoirs_par_periode),
        COALESCE(cmn.nb_compos_periode,  v_config.nb_compos_par_periode),
        v_config.coef_composition
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


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Recalcul automatique des statistiques classe
-- Déclenché après chaque INSERT/UPDATE sur notes
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION maj_stats_evaluation()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE evaluations
    SET
        moyenne_classe  = (
            SELECT ROUND(AVG(valeur)::NUMERIC, 2)
            FROM notes
            WHERE evaluation_id = COALESCE(NEW.evaluation_id, OLD.evaluation_id)
              AND valeur IS NOT NULL
        ),
        note_min_classe = (
            SELECT MIN(valeur) FROM notes
            WHERE evaluation_id = COALESCE(NEW.evaluation_id, OLD.evaluation_id)
              AND valeur IS NOT NULL
        ),
        note_max_classe = (
            SELECT MAX(valeur) FROM notes
            WHERE evaluation_id = COALESCE(NEW.evaluation_id, OLD.evaluation_id)
              AND valeur IS NOT NULL
        ),
        nb_copies       = (
            SELECT COUNT(*) FROM notes
            WHERE evaluation_id = COALESCE(NEW.evaluation_id, OLD.evaluation_id)
              AND NOT est_absent AND NOT est_dispense
        ),
        nb_absents      = (
            SELECT COUNT(*) FROM notes
            WHERE evaluation_id = COALESCE(NEW.evaluation_id, OLD.evaluation_id)
              AND est_absent = TRUE
        ),
        updated_at = now()
    WHERE id = COALESCE(NEW.evaluation_id, OLD.evaluation_id);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maj_stats_evaluation
    AFTER INSERT OR UPDATE OR DELETE ON notes
    FOR EACH ROW EXECUTE FUNCTION maj_stats_evaluation();


DO $$
BEGIN
  RAISE NOTICE 'Migration 003 terminée — 12 tables créées : configs_systeme_notes, grilles_appreciations, series, disciplines_matieres, matieres, configs_matieres_niveau, affectations_enseignants, evaluations, notes, moyennes_matieres, notes_conduite, moyennes_generales';
  RAISE NOTICE 'Fonctions créées : calculer_moyenne_matiere(), initialiser_grille_appreciations(), get_appreciation(), get_periode_courante()';
END;
$$;
