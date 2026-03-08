-- ============================================================
-- MIGRATION 006 — DONNÉES DE RÉFÉRENCE FRANCOPHONES
-- Coefficients officiels par pays et par série
-- Matières communes à l'espace francophone
--
-- NOTE : Ces données sont insérées dans un établissement
--        "REFERENTIEL_SYSTEME" qui sert de modèle.
--        Les établissements réels copient ces données à
--        la création via la procédure copier_referentiel().
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Établissement référentiel (template invisible des utilisateurs)
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_ref_id    UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    INSERT INTO etablissements (id, nom, code_officiel, type, pays, actif)
    VALUES (
        v_ref_id,
        'RÉFÉRENTIEL SYSTÈME FRANCOPHONE',
        'SYS_REF_FR',
        'lycee',
        'REFERENTIEL',
        FALSE   -- Invisible dans l'application
    )
    ON CONFLICT (id) DO NOTHING;

    -- Config par défaut
    INSERT INTO configs_systeme_notes (etablissement_id) VALUES (v_ref_id)
    ON CONFLICT (etablissement_id) DO NOTHING;

    -- Grille d'appréciations standard
    PERFORM initialiser_grille_appreciations(v_ref_id);

    -- Politique de sécurité
    INSERT INTO politique_securite (etablissement_id) VALUES (v_ref_id)
    ON CONFLICT (etablissement_id) DO NOTHING;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 2. Disciplines (commun à tous les pays francophones)
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE v_ref UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    INSERT INTO disciplines_matieres (etablissement_id, nom, code, couleur_affichage, ordre)
    VALUES
        (v_ref, 'Mathématiques',              'MATH',  '#2196F3', 1),
        (v_ref, 'Sciences Physiques',         'PHYS',  '#9C27B0', 2),
        (v_ref, 'Sciences de la Vie et de la Terre', 'SVT', '#4CAF50', 3),
        (v_ref, 'Lettres et Langues',         'LETT',  '#FF9800', 4),
        (v_ref, 'Sciences Humaines',          'SH',    '#607D8B', 5),
        (v_ref, 'Sciences Économiques',       'ECO',   '#00BCD4', 6),
        (v_ref, 'Techniques',                 'TECH',  '#795548', 7),
        (v_ref, 'Arts et Culture',            'ARTS',  '#E91E63', 8),
        (v_ref, 'Éducation Physique',         'EPS',   '#8BC34A', 9),
        (v_ref, 'Éducation Islamique',        'ISLM',  '#FF5722', 10),
        (v_ref, 'Informatique',               'INFO',  '#3F51B5', 11);
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 3. Matières communes à l'espace francophone
-- ──────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_ref   UUID := '00000000-0000-0000-0000-000000000001';
    v_math  UUID;
    v_phys  UUID;
    v_svt   UUID;
    v_lett  UUID;
    v_sh    UUID;
    v_eco   UUID;
    v_tech  UUID;
    v_arts  UUID;
    v_eps   UUID;
    v_islm  UUID;
    v_info  UUID;
BEGIN
    SELECT id INTO v_math FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'MATH';
    SELECT id INTO v_phys FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'PHYS';
    SELECT id INTO v_svt  FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'SVT';
    SELECT id INTO v_lett FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'LETT';
    SELECT id INTO v_sh   FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'SH';
    SELECT id INTO v_eco  FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'ECO';
    SELECT id INTO v_tech FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'TECH';
    SELECT id INTO v_arts FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'ARTS';
    SELECT id INTO v_eps  FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'EPS';
    SELECT id INTO v_islm FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'ISLM';
    SELECT id INTO v_info FROM disciplines_matieres WHERE etablissement_id = v_ref AND code = 'INFO';

    INSERT INTO matieres (etablissement_id, discipline_id, nom, nom_court, code, compte_dans_moyenne, est_eliminatoire) VALUES
        -- Mathématiques
        (v_ref, v_math, 'Mathématiques',                  'Maths',     'MATH',   TRUE,  FALSE),

        -- Sciences Physiques
        (v_ref, v_phys, 'Physique-Chimie',                'PC',        'PC',     TRUE,  FALSE),
        (v_ref, v_phys, 'Physique',                       'Phys',      'PHYS',   TRUE,  FALSE),
        (v_ref, v_phys, 'Chimie',                         'Chim',      'CHIM',   TRUE,  FALSE),

        -- SVT
        (v_ref, v_svt,  'Sciences de la Vie et de la Terre', 'SVT',    'SVT',    TRUE,  FALSE),
        (v_ref, v_svt,  'Biologie',                       'Bio',       'BIO',    TRUE,  FALSE),
        (v_ref, v_svt,  'Géologie',                       'Géo.Sci',   'GEOL',   TRUE,  FALSE),

        -- Lettres et Langues
        (v_ref, v_lett, 'Français',                       'Fr',        'FR',     TRUE,  FALSE),
        (v_ref, v_lett, 'Littérature',                    'Litt',      'LITT',   TRUE,  FALSE),
        (v_ref, v_lett, 'Anglais',                        'Angl',      'ANG',    TRUE,  FALSE),
        (v_ref, v_lett, 'Espagnol',                       'Esp',       'ESP',    TRUE,  FALSE),
        (v_ref, v_lett, 'Arabe',                          'Arab',      'ARAB',   TRUE,  FALSE),
        (v_ref, v_lett, 'Langue Nationale',               'L.Nat',     'LNAT',   TRUE,  FALSE),
        (v_ref, v_lett, 'Philosophie',                    'Philo',     'PHILO',  TRUE,  FALSE),

        -- Sciences Humaines
        (v_ref, v_sh,   'Histoire-Géographie',            'Hist-Géo',  'HG',     TRUE,  FALSE),
        (v_ref, v_sh,   'Histoire',                       'Hist',      'HIST',   TRUE,  FALSE),
        (v_ref, v_sh,   'Géographie',                     'Géo',       'GEO',    TRUE,  FALSE),
        (v_ref, v_sh,   'Éducation Civique',              'Ed.Civ',    'EC',     TRUE,  FALSE),
        (v_ref, v_sh,   'Droit',                          'Droit',     'DROIT',  TRUE,  FALSE),

        -- Sciences Économiques et Gestion
        (v_ref, v_eco,  'Économie',                       'Éco',       'ECO',    TRUE,  FALSE),
        (v_ref, v_eco,  'Comptabilité',                   'Compta',    'COMPTA', TRUE,  FALSE),
        (v_ref, v_eco,  'Gestion',                        'Gest',      'GEST',   TRUE,  FALSE),
        (v_ref, v_eco,  'Mathématiques Financières',      'Math.Fin',  'MATHF',  TRUE,  FALSE),

        -- Techniques
        (v_ref, v_tech, 'Technologie',                    'Tech',      'TECH',   TRUE,  FALSE),
        (v_ref, v_tech, 'Sciences et Technologies',       'S&T',       'ST',     TRUE,  FALSE),
        (v_ref, v_tech, 'Travaux Manuels',                'T.Man',     'TM',     TRUE,  FALSE),

        -- Arts et Culture
        (v_ref, v_arts, 'Arts Plastiques',                'Arts',      'ARTP',   TRUE,  FALSE),
        (v_ref, v_arts, 'Musique',                        'Mus',       'MUS',    FALSE, FALSE),
        (v_ref, v_arts, 'Éducation Artistique',           'Ed.Art',    'EA',     TRUE,  FALSE),

        -- EPS (souvent présente mais parfois non comptabilisée)
        (v_ref, v_eps,  'Éducation Physique et Sportive', 'EPS',       'EPS',    TRUE,  FALSE),

        -- Éducation islamique (établissements franco-arabes)
        (v_ref, v_islm, 'Éducation Islamique',            'Ed.Isl',    'EI',     TRUE,  FALSE),
        (v_ref, v_islm, 'Sciences Islamiques',            'Sci.Isl',   'SI',     TRUE,  FALSE),

        -- Informatique
        (v_ref, v_info, 'Informatique',                   'Info',      'INFO',   TRUE,  FALSE);
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 4. Séries par pays
-- ──────────────────────────────────────────────────────────────

-- Créer un niveau fictif pour associer les coefficients du référentiel
-- (sera remplacé par les niveaux réels de chaque établissement)
DO $$
DECLARE
    v_ref   UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    -- SÉNÉGAL
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Sénégal', 'LS',  'Littérature et Sciences Humaines',         'litteraire'),
        (v_ref, 'Sénégal', 'L2',  'Littérature — Langues étrangères',         'litteraire'),
        (v_ref, 'Sénégal', 'S1',  'Sciences Mathématiques',                   'scientifique'),
        (v_ref, 'Sénégal', 'S2',  'Sciences Expérimentales',                  'scientifique'),
        (v_ref, 'Sénégal', 'S3',  'Sciences Agronomiques',                    'scientifique'),
        (v_ref, 'Sénégal', 'G1',  'Sciences et Techniques Économiques',       'gestion'),
        (v_ref, 'Sénégal', 'G2',  'Sciences et Techniques Commerciales',      'gestion'),
        (v_ref, 'Sénégal', 'T1',  'Sciences et Techniques Industrielles',     'technique'),
        (v_ref, 'Sénégal', 'T2',  'Sciences et Techniques Biologiques',       'technique');

    -- MALI
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Mali', 'A',  'Lettres, Arts et Sciences Humaines',           'litteraire'),
        (v_ref, 'Mali', 'B',  'Sciences Économiques et Sociales',             'litteraire'),
        (v_ref, 'Mali', 'C',  'Mathématiques, Physique et Chimie',            'scientifique'),
        (v_ref, 'Mali', 'D',  'Sciences Naturelles',                         'scientifique'),
        (v_ref, 'Mali', 'G',  'Sciences et Techniques de Gestion',           'gestion');

    -- CÔTE D'IVOIRE
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Côte d''Ivoire', 'A',  'Lettres et Sciences Humaines',       'litteraire'),
        (v_ref, 'Côte d''Ivoire', 'B',  'Économie et Sciences Sociales',      'litteraire'),
        (v_ref, 'Côte d''Ivoire', 'C',  'Mathématiques et Sciences Physiques','scientifique'),
        (v_ref, 'Côte d''Ivoire', 'D',  'Sciences Biologiques et Agronomiques','scientifique'),
        (v_ref, 'Côte d''Ivoire', 'E',  'Mathématiques et Sciences Techniques','technique'),
        (v_ref, 'Côte d''Ivoire', 'G1', 'Sciences et Technologies de Gestion','gestion'),
        (v_ref, 'Côte d''Ivoire', 'G2', 'Sciences et Technologies Tertiaires','gestion');

    -- BURKINA FASO
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Burkina Faso', 'A',  'Lettres et Sciences Humaines',         'litteraire'),
        (v_ref, 'Burkina Faso', 'B',  'Sciences Économiques',                 'litteraire'),
        (v_ref, 'Burkina Faso', 'C',  'Mathématiques et Sciences Physiques',  'scientifique'),
        (v_ref, 'Burkina Faso', 'D',  'Sciences Naturelles',                  'scientifique'),
        (v_ref, 'Burkina Faso', 'G',  'Sciences et Technologies Tertiaires',  'gestion');

    -- BÉNIN
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Bénin', 'A',  'Lettres, Sciences Humaines',                  'litteraire'),
        (v_ref, 'Bénin', 'B',  'Économie et Sciences Sociales',               'litteraire'),
        (v_ref, 'Bénin', 'C',  'Mathématiques, Sciences Physiques',           'scientifique'),
        (v_ref, 'Bénin', 'D',  'Sciences Naturelles et Biologiques',          'scientifique'),
        (v_ref, 'Bénin', 'G',  'Gestion et Informatique',                     'gestion');

    -- GUINÉE CONAKRY
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Guinée', 'A',  'Lettres et Humanités',                       'litteraire'),
        (v_ref, 'Guinée', 'B',  'Sciences Économiques et Sociales',           'litteraire'),
        (v_ref, 'Guinée', 'C',  'Mathématiques et Sciences Physiques',        'scientifique'),
        (v_ref, 'Guinée', 'D',  'Sciences Biologiques',                       'scientifique');

    -- NIGER
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Niger', 'A1', 'Lettres Classiques',                          'litteraire'),
        (v_ref, 'Niger', 'A2', 'Lettres Modernes',                            'litteraire'),
        (v_ref, 'Niger', 'B',  'Sciences Économiques',                        'litteraire'),
        (v_ref, 'Niger', 'C',  'Mathématiques et Sciences Physiques',         'scientifique'),
        (v_ref, 'Niger', 'D',  'Sciences Naturelles',                         'scientifique');

    -- TOGO
    INSERT INTO series (etablissement_id, pays, code, libelle, type) VALUES
        (v_ref, 'Togo', 'A',  'Lettres et Sciences Humaines',                 'litteraire'),
        (v_ref, 'Togo', 'B',  'Économie-Gestion',                            'litteraire'),
        (v_ref, 'Togo', 'C',  'Mathématiques et Sciences Physiques',         'scientifique'),
        (v_ref, 'Togo', 'D',  'Sciences Biologiques et Chimie',              'scientifique'),
        (v_ref, 'Togo', 'F',  'Sciences et Technologies Industrielles',      'technique');
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- 5. Table des coefficients officiels par pays/série/matière
-- Table de données pure (pour consultation et copie lors de la
-- création d'un établissement)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE ref_coefficients (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pays        VARCHAR(50) NOT NULL,
    serie_code  VARCHAR(10) NOT NULL,
    matiere_code VARCHAR(20) NOT NULL,
    coefficient NUMERIC(4,2) NOT NULL,
    source      VARCHAR(100),   -- Ministère + année du texte officiel
    UNIQUE (pays, serie_code, matiere_code)
);

-- ── SÉNÉGAL — Terminale ──────────────────────────────────────
INSERT INTO ref_coefficients (pays, serie_code, matiere_code, coefficient, source) VALUES
    -- Série S1 (Sciences Mathématiques)
    ('Sénégal', 'S1', 'MATH',  7, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'PC',    6, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'SVT',   5, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'PHILO', 3, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'FR',    3, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'HG',    2, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'ANG',   2, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S1', 'EPS',   1, 'DPFC - BAC sénégalais'),
    -- Série S2 (Sciences Expérimentales)
    ('Sénégal', 'S2', 'SVT',   7, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'PC',    6, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'MATH',  5, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'PHILO', 3, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'FR',    3, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'HG',    2, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'ANG',   2, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'S2', 'EPS',   1, 'DPFC - BAC sénégalais'),
    -- Série LS (Lettres)
    ('Sénégal', 'LS', 'FR',    5, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'PHILO', 5, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'HG',    4, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'ANG',   3, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'MATH',  2, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'PC',    1, 'DPFC - BAC sénégalais'),
    ('Sénégal', 'LS', 'EPS',   1, 'DPFC - BAC sénégalais');

-- ── MALI — Terminale ─────────────────────────────────────────
INSERT INTO ref_coefficients (pays, serie_code, matiere_code, coefficient, source) VALUES
    -- Série C (Mathématiques, Physique)
    ('Mali', 'C', 'MATH',  7, 'DNE - BAC malien'),
    ('Mali', 'C', 'PC',    5, 'DNE - BAC malien'),
    ('Mali', 'C', 'SVT',   4, 'DNE - BAC malien'),
    ('Mali', 'C', 'FR',    3, 'DNE - BAC malien'),
    ('Mali', 'C', 'PHILO', 3, 'DNE - BAC malien'),
    ('Mali', 'C', 'HG',    2, 'DNE - BAC malien'),
    ('Mali', 'C', 'ANG',   2, 'DNE - BAC malien'),
    ('Mali', 'C', 'EPS',   1, 'DNE - BAC malien'),
    -- Série D (Sciences Naturelles)
    ('Mali', 'D', 'SVT',   7, 'DNE - BAC malien'),
    ('Mali', 'D', 'PC',    5, 'DNE - BAC malien'),
    ('Mali', 'D', 'MATH',  4, 'DNE - BAC malien'),
    ('Mali', 'D', 'FR',    3, 'DNE - BAC malien'),
    ('Mali', 'D', 'PHILO', 3, 'DNE - BAC malien'),
    ('Mali', 'D', 'HG',    2, 'DNE - BAC malien'),
    ('Mali', 'D', 'ANG',   2, 'DNE - BAC malien'),
    ('Mali', 'D', 'EPS',   1, 'DNE - BAC malien'),
    -- Série A (Lettres)
    ('Mali', 'A', 'FR',    5, 'DNE - BAC malien'),
    ('Mali', 'A', 'PHILO', 5, 'DNE - BAC malien'),
    ('Mali', 'A', 'HG',    4, 'DNE - BAC malien'),
    ('Mali', 'A', 'ANG',   3, 'DNE - BAC malien'),
    ('Mali', 'A', 'MATH',  2, 'DNE - BAC malien'),
    ('Mali', 'A', 'EPS',   1, 'DNE - BAC malien');

-- ── CÔTE D'IVOIRE — Terminale ─────────────────────────────────
INSERT INTO ref_coefficients (pays, serie_code, matiere_code, coefficient, source) VALUES
    -- Série C
    ('Côte d''Ivoire', 'C', 'MATH',  6, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'PC',    5, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'SVT',   4, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'FR',    3, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'PHILO', 3, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'HG',    2, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'ANG',   2, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'C', 'EPS',   1, 'DECO - BAC ivoirien'),
    -- Série D
    ('Côte d''Ivoire', 'D', 'SVT',   6, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'PC',    4, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'MATH',  4, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'FR',    3, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'PHILO', 3, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'HG',    2, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'ANG',   2, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'D', 'EPS',   1, 'DECO - BAC ivoirien'),
    -- Série A
    ('Côte d''Ivoire', 'A', 'FR',    5, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'A', 'PHILO', 5, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'A', 'HG',    4, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'A', 'ANG',   3, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'A', 'MATH',  2, 'DECO - BAC ivoirien'),
    ('Côte d''Ivoire', 'A', 'EPS',   1, 'DECO - BAC ivoirien');

-- ── BURKINA FASO — Terminale ──────────────────────────────────
INSERT INTO ref_coefficients (pays, serie_code, matiere_code, coefficient, source) VALUES
    ('Burkina Faso', 'C', 'MATH',  6, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'PC',    5, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'SVT',   4, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'FR',    3, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'PHILO', 3, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'HG',    2, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'ANG',   2, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'C', 'EPS',   1, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'SVT',   6, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'PC',    4, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'MATH',  4, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'FR',    3, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'PHILO', 3, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'HG',    2, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'ANG',   2, 'DGEC - BAC burkinabè'),
    ('Burkina Faso', 'D', 'EPS',   1, 'DGEC - BAC burkinabè');

-- ── COEFFICIENTS COMMUNS COLLÈGE (identiques dans tous les pays) ──
-- Les coefficients du collège varient peu — on fournit une base commune
CREATE TABLE ref_coefficients_college (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle           VARCHAR(20) NOT NULL DEFAULT 'college',
    classe_code     VARCHAR(20),   -- NULL = s'applique à tout le cycle
    matiere_code    VARCHAR(20) NOT NULL,
    coefficient     NUMERIC(4,2) NOT NULL,
    UNIQUE (cycle, classe_code, matiere_code)
);

INSERT INTO ref_coefficients_college (cycle, classe_code, matiere_code, coefficient) VALUES
    ('college', NULL, 'MATH',  4),
    ('college', NULL, 'PC',    3),
    ('college', NULL, 'SVT',   3),
    ('college', NULL, 'FR',    4),
    ('college', NULL, 'HG',    2),
    ('college', NULL, 'ANG',   3),
    ('college', NULL, 'EPS',   2),
    ('college', NULL, 'ARTP',  1),
    ('college', NULL, 'INFO',  2),
    ('primaire', NULL, 'MATH', 4),
    ('primaire', NULL, 'FR',   4),
    ('primaire', NULL, 'HG',   2),
    ('primaire', NULL, 'SVT',  2),
    ('primaire', NULL, 'EPS',  1),
    ('primaire', NULL, 'ARTP', 1);

COMMENT ON TABLE ref_coefficients IS 'Coefficients officiels par pays/série/matière. Source de vérité pour l''initialisation des établissements.';
COMMENT ON TABLE ref_coefficients_college IS 'Coefficients du collège et primaire — communs à l''espace francophone.';


DO $$
BEGIN
  RAISE NOTICE 'Migration 006 terminée — Données de référence chargées :';
  RAISE NOTICE '  - 11 disciplines, 33 matières communes';
  RAISE NOTICE '  - Séries pour 8 pays : Sénégal, Mali, Côte d''Ivoire, Burkina Faso, Bénin, Guinée, Niger, Togo';
  RAISE NOTICE '  - Coefficients BAC pour Sénégal, Mali, Côte d''Ivoire, Burkina Faso';
  RAISE NOTICE '  - Coefficients collège/primaire communs';
END;
$$;
