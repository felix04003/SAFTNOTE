-- ============================================================
-- MIGRATION 001 — DOMAINE 1 : Identités & Structure
-- Tables : etablissements, annees_scolaires, periodes,
--          niveaux, classes
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE 01 — etablissements
-- Racine de tout le système. Chaque donnée est rattachée ici.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE etablissements (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    nom                 VARCHAR(200) NOT NULL,
    code_officiel       VARCHAR(50)  UNIQUE,          -- Code attribué par le ministère
    type                VARCHAR(50)  NOT NULL
                            CHECK (type IN (
                                'primaire',
                                'college',
                                'lycee',
                                'primaire_college',   -- établissement multi-cycles
                                'college_lycee',
                                'complet',            -- primaire + collège + lycée
                                'franco_arabe',
                                'professionnel'
                            )),
    pays                VARCHAR(100) NOT NULL,
    region              VARCHAR(100),
    ville               VARCHAR(100),
    quartier            VARCHAR(100),
    adresse             TEXT,
    telephone           VARCHAR(20),
    email               VARCHAR(150),
    site_web            VARCHAR(200),
    logo_url            TEXT,

    -- Paramètres régionaux
    systeme_notation    VARCHAR(20)  NOT NULL DEFAULT 'sur_20'
                            CHECK (systeme_notation IN ('sur_20', 'sur_100', 'lettre')),
    langue_interface    VARCHAR(5)   NOT NULL DEFAULT 'fr'
                            CHECK (langue_interface IN ('fr', 'en', 'ar')),
    fuseau_horaire      VARCHAR(50)  NOT NULL DEFAULT 'Africa/Dakar',
    devise              VARCHAR(10)  NOT NULL DEFAULT 'XOF',

    -- Statut
    actif               BOOLEAN      NOT NULL DEFAULT TRUE,
    date_creation       DATE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_etablissements_pays  ON etablissements(pays);
CREATE INDEX idx_etablissements_actif ON etablissements(actif) WHERE actif = TRUE;

COMMENT ON TABLE etablissements IS 'Table racine. Toute donnée du système est rattachée à un établissement.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 02 — annees_scolaires
-- ──────────────────────────────────────────────────────────────
CREATE TABLE annees_scolaires (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE RESTRICT,
    libelle             VARCHAR(20) NOT NULL,    -- '2024-2025'
    date_debut          DATE        NOT NULL,
    date_fin            DATE        NOT NULL,
    nb_periodes         SMALLINT    NOT NULL DEFAULT 3
                            CHECK (nb_periodes IN (2, 3)),   -- 2 semestres ou 3 trimestres
    type_periode        VARCHAR(20) NOT NULL DEFAULT 'trimestre'
                            CHECK (type_periode IN ('trimestre', 'semestre')),
    est_courante        BOOLEAN     NOT NULL DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_annee_dates CHECK (date_fin > date_debut),
    UNIQUE (etablissement_id, libelle)
);

-- Index partiel : garantit une seule année courante par établissement
CREATE UNIQUE INDEX idx_annee_courante_unique
    ON annees_scolaires (etablissement_id)
    WHERE est_courante = TRUE;

CREATE INDEX idx_annees_etablissement ON annees_scolaires(etablissement_id);

COMMENT ON TABLE annees_scolaires IS 'Années scolaires. L''index partiel garantit une seule année active par établissement.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 03 — periodes
-- Trimestres ou semestres d'une année scolaire
-- ──────────────────────────────────────────────────────────────
CREATE TABLE periodes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id   UUID        NOT NULL REFERENCES annees_scolaires(id) ON DELETE CASCADE,
    numero              SMALLINT    NOT NULL CHECK (numero BETWEEN 1 AND 3),
    libelle             VARCHAR(50) NOT NULL,    -- 'Trimestre 1', 'Semestre 2'
    date_debut          DATE        NOT NULL,
    date_fin            DATE        NOT NULL,
    bulletins_generes   BOOLEAN     NOT NULL DEFAULT FALSE,
    delibere_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_periode_dates CHECK (date_fin > date_debut),
    UNIQUE (annee_scolaire_id, numero)
);

CREATE INDEX idx_periodes_annee ON periodes(annee_scolaire_id);

-- Fonction utilitaire : retourne la période courante d'un établissement
CREATE OR REPLACE FUNCTION get_periode_courante(p_etablissement_id UUID)
RETURNS UUID AS $$
    SELECT p.id
    FROM periodes p
    JOIN annees_scolaires a ON a.id = p.annee_scolaire_id
    WHERE a.etablissement_id = p_etablissement_id
      AND a.est_courante = TRUE
      AND CURRENT_DATE BETWEEN p.date_debut AND p.date_fin
    LIMIT 1;
$$ LANGUAGE sql STABLE;

COMMENT ON TABLE periodes IS 'Trimestres ou semestres. Toujours 3 trimestres dans le contexte francophone.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 04 — niveaux
-- Référentiel des niveaux scolaires de l'établissement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE niveaux (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    nom                 VARCHAR(50) NOT NULL,    -- '6ème', '3ème', 'Terminale', 'CM2'
    nom_court           VARCHAR(20),             -- 'T', 'CM2'
    ordre               SMALLINT    NOT NULL,    -- Tri croissant (1 = plus jeune niveau)
    cycle               VARCHAR(30) NOT NULL
                            CHECK (cycle IN ('primaire', 'college', 'lycee', 'professionnel')),
    actif               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (etablissement_id, nom)
);

CREATE INDEX idx_niveaux_etablissement ON niveaux(etablissement_id, ordre);

COMMENT ON TABLE niveaux IS 'Référentiel des niveaux. L''ordre permet le tri sans recourir à l''ordre alphabétique.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 05 — classes
-- Instance concrète d'un niveau pour une année scolaire
-- ──────────────────────────────────────────────────────────────
CREATE TABLE classes (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id   UUID        NOT NULL REFERENCES annees_scolaires(id) ON DELETE RESTRICT,
    niveau_id           UUID        NOT NULL REFERENCES niveaux(id) ON DELETE RESTRICT,
    nom                 VARCHAR(10) NOT NULL,    -- 'A', 'B', 'C' — libellé complet reconstruit par jointure
    effectif_max        SMALLINT,               -- Capacité maximale
    salle_principale    VARCHAR(50),
    actif               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (annee_scolaire_id, niveau_id, nom)
);

CREATE INDEX idx_classes_annee  ON classes(annee_scolaire_id);
CREATE INDEX idx_classes_niveau ON classes(niveau_id);

-- Vue pratique : libellé complet de la classe
CREATE OR REPLACE VIEW v_classes_completes AS
SELECT
    c.id,
    c.annee_scolaire_id,
    c.niveau_id,
    c.nom                                           AS nom_classe,
    n.nom || ' ' || c.nom                           AS libelle_complet,  -- '3ème B'
    n.nom                                           AS nom_niveau,
    n.cycle,
    n.ordre,
    c.effectif_max,
    c.salle_principale,
    a.libelle                                       AS annee_libelle,
    a.est_courante,
    e.id                                            AS etablissement_id,
    e.nom                                           AS etablissement_nom
FROM classes c
JOIN niveaux n          ON n.id = c.niveau_id
JOIN annees_scolaires a ON a.id = c.annee_scolaire_id
JOIN etablissements e   ON e.id = a.etablissement_id
WHERE c.actif = TRUE;

COMMENT ON TABLE classes IS 'Instance concrète. ''3ème B'' = niveau ''3ème'' + nom ''B'' + année 2024-2025.';

-- ──────────────────────────────────────────────────────────────
-- TRIGGER : updated_at automatique
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_etablissements_updated_at
    BEFORE UPDATE ON etablissements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_annees_updated_at
    BEFORE UPDATE ON annees_scolaires
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_classes_updated_at
    BEFORE UPDATE ON classes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DO $$
BEGIN
  RAISE NOTICE 'Migration 001 terminée — 5 tables créées : etablissements, annees_scolaires, periodes, niveaux, classes';
END;
$$;
