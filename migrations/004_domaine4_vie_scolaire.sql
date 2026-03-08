-- ============================================================
-- MIGRATION 004 — DOMAINE 4 : Vie Scolaire
-- Tables : plages_horaires, emplois_du_temps, modifications_edt,
--          appels, presences, recapitulatifs_absences,
--          incidents_discipline, sanctions,
--          evenements, autorisations_sorties,
--          taches_notifications
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE 27 — plages_horaires
-- Référentiel des créneaux horaires de la journée
-- ──────────────────────────────────────────────────────────────
CREATE TABLE plages_horaires (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    numero              SMALLINT    NOT NULL CHECK (numero > 0),
    libelle             VARCHAR(30),                 -- '1ère heure', 'Récréation'
    heure_debut         TIME        NOT NULL,
    heure_fin           TIME        NOT NULL,
    est_pause           BOOLEAN     NOT NULL DEFAULT FALSE,  -- Récréation ou déjeuner

    CONSTRAINT chk_plage_horaire CHECK (heure_fin > heure_debut),
    UNIQUE (etablissement_id, numero)
);

CREATE INDEX idx_plages_etablissement ON plages_horaires(etablissement_id, numero);

COMMENT ON TABLE plages_horaires IS 'Référentiel des créneaux. Définit la structure de la journée scolaire.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 28 — emplois_du_temps
-- Cours planifiés — grille hebdomadaire de référence
-- ──────────────────────────────────────────────────────────────
CREATE TABLE emplois_du_temps (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    classe_id           UUID        NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    affectation_id      UUID        NOT NULL REFERENCES affectations_enseignants(id) ON DELETE RESTRICT,
    plage_id            UUID        NOT NULL REFERENCES plages_horaires(id) ON DELETE RESTRICT,
    jour_semaine        SMALLINT    NOT NULL CHECK (jour_semaine BETWEEN 1 AND 6),
                        -- 1=Lundi, 2=Mardi, 3=Mercredi, 4=Jeudi, 5=Vendredi, 6=Samedi
    salle               VARCHAR(50),
    date_debut_validite DATE,                   -- Début de validité du créneau
    date_fin_validite   DATE,                   -- NULL = toute l'année
    actif               BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (classe_id, plage_id, jour_semaine, date_debut_validite)
);

CREATE INDEX idx_edt_classe       ON emplois_du_temps(classe_id, actif);
CREATE INDEX idx_edt_affectation  ON emplois_du_temps(affectation_id);
CREATE INDEX idx_edt_jour         ON emplois_du_temps(jour_semaine, plage_id);

CREATE TRIGGER trg_edt_updated_at
    BEFORE UPDATE ON emplois_du_temps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE emplois_du_temps IS 'Grille hebdomadaire de référence. Chaque ligne = un créneau récurrent.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 29 — modifications_edt
-- Modifications ponctuelles (annulation, déplacement, remplacement)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE modifications_edt (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    emploi_du_temps_id  UUID        NOT NULL REFERENCES emplois_du_temps(id) ON DELETE CASCADE,
    date_cours          DATE        NOT NULL,    -- La date précise du cours concerné
    type_modification   VARCHAR(20) NOT NULL
                            CHECK (type_modification IN (
                                'annulation',       -- Cours supprimé
                                'deplacement',      -- Changé d'horaire
                                'remplacement',     -- Autre enseignant
                                'salle_changee'     -- Même cours, salle différente
                            )),
    nouvelle_plage_id   UUID        REFERENCES plages_horaires(id),
    nouvelle_salle      VARCHAR(50),
    remplacant_id       UUID        REFERENCES enseignants(id),
    motif               TEXT,
    notif_envoyee       BOOLEAN     NOT NULL DEFAULT FALSE,
    notif_envoyee_at    TIMESTAMPTZ,
    created_par         UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (emploi_du_temps_id, date_cours)
);

CREATE INDEX idx_modif_edt_date ON modifications_edt(date_cours);

COMMENT ON TABLE modifications_edt IS 'Modifications ponctuelles. Déclenche une notification catégorie C aux parents (48h avant).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 30 — appels
-- Chaque appel ouvert pour une séance de cours
-- ──────────────────────────────────────────────────────────────
CREATE TABLE appels (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    emploi_du_temps_id  UUID        NOT NULL REFERENCES emplois_du_temps(id) ON DELETE RESTRICT,
    date_cours          DATE        NOT NULL,
    heure_debut_reelle  TIME,           -- Peut différer du planning
    heure_fin_reelle    TIME,
    effectue_par        UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
    effectue_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    statut              VARCHAR(20) NOT NULL DEFAULT 'effectue'
                            CHECK (statut IN ('effectue', 'cours_annule', 'non_effectue')),
    observation         TEXT,

    UNIQUE (emploi_du_temps_id, date_cours)
);

CREATE INDEX idx_appels_date          ON appels(date_cours);
CREATE INDEX idx_appels_effectue_par  ON appels(effectue_par);

COMMENT ON TABLE appels IS 'Chaque appel ouvert pour une séance. UNIQUE (emploi_du_temps_id, date_cours).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 31 — presences
-- Présence de chaque élève à chaque séance
-- Table la plus volumineuse du domaine 4
-- ──────────────────────────────────────────────────────────────
CREATE TABLE presences (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    appel_id            UUID        NOT NULL REFERENCES appels(id) ON DELETE CASCADE,
    inscription_id      UUID        NOT NULL REFERENCES inscriptions(id) ON DELETE RESTRICT,

    statut              VARCHAR(20) NOT NULL DEFAULT 'present'
                            CHECK (statut IN (
                                'present',
                                'absent',           -- Absent toute la séance
                                'retard',           -- Arrivé en retard
                                'sorti_avant',      -- Parti avant la fin
                                'dispense'          -- Dispensé (médical, etc.)
                            )),

    -- Détails si absent ou retard
    heure_arrivee       TIME,                   -- Si retard : heure d'arrivée réelle
    heure_depart        TIME,                   -- Si sorti avant : heure de départ
    minutes_retard      SMALLINT,               -- Calculé automatiquement

    -- Justification
    est_justifie        BOOLEAN     NOT NULL DEFAULT FALSE,
    motif_justification VARCHAR(100),           -- 'maladie', 'deuil', 'convocation_officielle'
    commentaire_justif  TEXT,
    piece_justificative_url TEXT,               -- URL du document si uploadé
    justifie_par        UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    justifie_at         TIMESTAMPTZ,

    -- Notification parent
    notif_envoyee       BOOLEAN     NOT NULL DEFAULT FALSE,
    notif_envoyee_at    TIMESTAMPTZ,

    saisie_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    modifie_at          TIMESTAMPTZ,

    UNIQUE (appel_id, inscription_id)
);

CREATE INDEX idx_presences_inscription  ON presences(inscription_id, saisie_at DESC);
CREATE INDEX idx_presences_appel        ON presences(appel_id);
CREATE INDEX idx_presences_statut       ON presences(statut, saisie_at DESC)
    WHERE statut != 'present';
CREATE INDEX idx_presences_notif        ON presences(notif_envoyee, saisie_at)
    WHERE notif_envoyee = FALSE AND statut = 'absent';

COMMENT ON TABLE presences IS 'Table la plus volumineuse du domaine 4. Le TRIGGER sur cette table déclenche les notifications.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 32 — recapitulatifs_absences
-- Cache des totaux d'absences par élève et par période
-- ──────────────────────────────────────────────────────────────
CREATE TABLE recapitulatifs_absences (
    id                              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id                  UUID         NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    periode_id                      UUID         NOT NULL REFERENCES periodes(id) ON DELETE RESTRICT,

    -- En séances (nombre de cours manqués)
    nb_seances_absences_just        SMALLINT     NOT NULL DEFAULT 0,
    nb_seances_absences_injust      SMALLINT     NOT NULL DEFAULT 0,
    nb_seances_retards              SMALLINT     NOT NULL DEFAULT 0,

    -- En heures (pour les bulletins qui affichent les heures)
    nb_heures_absences_just         NUMERIC(5,1) NOT NULL DEFAULT 0,
    nb_heures_absences_injust       NUMERIC(5,1) NOT NULL DEFAULT 0,
    nb_heures_retards               NUMERIC(5,1) NOT NULL DEFAULT 0,

    -- En demi-journées
    nb_demij_absences_just          SMALLINT     NOT NULL DEFAULT 0,
    nb_demij_absences_injust        SMALLINT     NOT NULL DEFAULT 0,

    -- Seuils d'alerte
    seuil_alerte_atteint            BOOLEAN      NOT NULL DEFAULT FALSE,
    seuil_exclusion_atteint         BOOLEAN      NOT NULL DEFAULT FALSE,

    mis_a_jour_at                   TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (inscription_id, periode_id)
);

COMMENT ON TABLE recapitulatifs_absences IS 'Cache des totaux d''absences. Alimenté par le trigger de mise à jour. Affiché sur le bulletin.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 33 — incidents_discipline
-- Incidents disciplinaires signalés
-- ──────────────────────────────────────────────────────────────
CREATE TABLE incidents_discipline (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id      UUID        NOT NULL REFERENCES inscriptions(id) ON DELETE RESTRICT,
    date_incident       DATE        NOT NULL DEFAULT CURRENT_DATE,
    heure_incident      TIME,

    -- Nature de l'incident
    type                VARCHAR(50) NOT NULL
                            CHECK (type IN (
                                'perturbation_cours',
                                'violence_verbale',
                                'violence_physique',
                                'fraude_examen',
                                'insolence',
                                'absenteisme',
                                'refus_travail',
                                'degradation_materiel',
                                'autre'
                            )),
    gravite             VARCHAR(20) NOT NULL DEFAULT 'mineur'
                            CHECK (gravite IN ('mineur', 'moyen', 'grave', 'tres_grave')),
    description         TEXT        NOT NULL,

    -- Contexte
    lieu                VARCHAR(100),       -- 'Salle de classe', 'Cour', 'Couloir'
    appel_id            UUID        REFERENCES appels(id) ON DELETE SET NULL,  -- Si pendant un cours
    rapporte_par        UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,

    -- Traitement
    statut              VARCHAR(20) NOT NULL DEFAULT 'ouvert'
                            CHECK (statut IN ('ouvert', 'en_traitement', 'clos')),
    traite_par          UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    traite_at           TIMESTAMPTZ,
    resolution          TEXT,

    -- Notification parent
    notif_envoyee       BOOLEAN     NOT NULL DEFAULT FALSE,
    notif_envoyee_at    TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_incidents_inscription  ON incidents_discipline(inscription_id, created_at DESC);
CREATE INDEX idx_incidents_date         ON incidents_discipline(date_incident);
CREATE INDEX idx_incidents_statut       ON incidents_discipline(statut) WHERE statut != 'clos';

CREATE TRIGGER trg_incidents_updated_at
    BEFORE UPDATE ON incidents_discipline
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE incidents_discipline IS 'Incidents disciplinaires. Point d''entrée du processus de sanction.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 34 — sanctions
-- Sanctions prononcées suite à un incident ou directement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE sanctions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    inscription_id          UUID        NOT NULL REFERENCES inscriptions(id) ON DELETE RESTRICT,
    incident_id             UUID        REFERENCES incidents_discipline(id) ON DELETE SET NULL,

    type                    VARCHAR(30) NOT NULL
                                CHECK (type IN (
                                    'avertissement_oral',
                                    'avertissement_ecrit',
                                    'retenue',
                                    'renvoi_temporaire',     -- Exclusion < 8 jours
                                    'conseil_discipline',
                                    'exclusion_definitive'
                                )),

    -- Dates
    date_prononcee          DATE        NOT NULL DEFAULT CURRENT_DATE,
    date_debut              DATE,       -- Pour les renvois et exclusions
    date_fin                DATE,
    nb_jours                SMALLINT,   -- Durée si renvoi temporaire

    -- Détails
    motif                   TEXT,
    prononcee_par           UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
    approuvee_par           UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,

    -- Retenue (si type = 'retenue')
    date_retenue            DATE,
    heure_debut_retenue     TIME,
    heure_fin_retenue       TIME,
    salle_retenue           VARCHAR(50),
    surveillant_id          UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,

    -- Notification et accusé de réception
    notif_parent_envoyee    BOOLEAN     NOT NULL DEFAULT FALSE,
    notif_envoyee_at        TIMESTAMPTZ,
    accuse_reception_parent BOOLEAN     NOT NULL DEFAULT FALSE,
    accuse_at               TIMESTAMPTZ,
    canal_accuse            VARCHAR(20),    -- 'whatsapp', 'sms', 'app', 'papier', 'signature'

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sanctions_inscription ON sanctions(inscription_id, created_at DESC);
CREATE INDEX idx_sanctions_type        ON sanctions(type);

COMMENT ON TABLE sanctions IS 'Sanctions prononcées. La notification parent est catégorie A (obligatoire, immédiate).';


-- ──────────────────────────────────────────────────────────────
-- TABLE 35 — evenements
-- Événements de l'établissement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE evenements (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id                UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,

    titre                           VARCHAR(200) NOT NULL,
    type                            VARCHAR(30) NOT NULL
                                        CHECK (type IN (
                                            'sortie_scolaire',
                                            'reunion_parents',
                                            'examen_officiel',      -- BFEM, BAC, etc.
                                            'conseil_classe',
                                            'conseil_discipline',
                                            'journee_sportive',
                                            'journee_portes_ouvertes',
                                            'conge',
                                            'formation_enseignants',
                                            'autre'
                                        )),
    description                     TEXT,

    -- Dates et horaires
    date_debut                      DATE        NOT NULL,
    date_fin                        DATE        NOT NULL,
    heure_debut                     TIME,
    heure_fin                       TIME,
    lieu                            TEXT,

    -- Ciblage
    concerne_tout_etablissement     BOOLEAN     NOT NULL DEFAULT TRUE,
    classes_concernees              UUID[],     -- IDs de classes si ciblé
    niveaux_concernes               UUID[],

    -- Autorisations (pour les sorties scolaires)
    necessite_autorisation          BOOLEAN     NOT NULL DEFAULT FALSE,
    date_limite_autorisation        DATE,
    cout_participation              NUMERIC(10,2),
    devise_cout                     VARCHAR(5)  DEFAULT 'XOF',

    -- Notification programmée
    notif_programmee                BOOLEAN     NOT NULL DEFAULT FALSE,
    notif_envoyee_at                TIMESTAMPTZ,
    notif_delai_jours               SMALLINT    NOT NULL DEFAULT 2,  -- Envoyer X jours avant

    created_par                     UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_evenement_dates CHECK (date_fin >= date_debut)
);

CREATE INDEX idx_evenements_etablissement ON evenements(etablissement_id, date_debut);
CREATE INDEX idx_evenements_type          ON evenements(type, date_debut);
CREATE INDEX idx_evenements_a_venir       ON evenements(date_debut)
    WHERE date_debut >= CURRENT_DATE;

CREATE TRIGGER trg_evenements_updated_at
    BEFORE UPDATE ON evenements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE evenements IS 'Événements de l''établissement. Les sorties scolaires déclenchent le recueil des autorisations.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 36 — autorisations_sorties
-- Réponses des parents aux demandes d'autorisation de sortie
-- ──────────────────────────────────────────────────────────────
CREATE TABLE autorisations_sorties (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    evenement_id        UUID        NOT NULL REFERENCES evenements(id) ON DELETE CASCADE,
    inscription_id      UUID        NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,
    parent_id           UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,

    statut              VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                            CHECK (statut IN ('en_attente', 'autorise', 'refuse')),
    repondu_at          TIMESTAMPTZ,
    canal_reponse       VARCHAR(20),    -- 'whatsapp', 'sms', 'app', 'papier'
    commentaire         TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (evenement_id, inscription_id)
);

CREATE INDEX idx_autorisation_evenement    ON autorisations_sorties(evenement_id, statut);
CREATE INDEX idx_autorisation_inscription  ON autorisations_sorties(inscription_id);

COMMENT ON TABLE autorisations_sorties IS 'Réponses des parents aux sorties scolaires. Généré automatiquement lors de la création de l''événement.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 37 — taches_notifications
-- File d'attente des notifications à envoyer
-- Pont entre PostgreSQL et le worker Node.js
-- ──────────────────────────────────────────────────────────────
CREATE TABLE taches_notifications (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Ce qu'il faut envoyer
    type_notif          VARCHAR(50) NOT NULL,
                        -- 'absence_non_justifiee', 'retard', 'nouvelle_note',
                        -- 'bulletin_disponible', 'convocation', 'sanction',
                        -- 'modification_edt', 'evenement', 'autorisation_sortie',
                        -- 'resume_hebdo'

    -- À qui et pour quel élève
    inscription_id      UUID        NOT NULL REFERENCES inscriptions(id) ON DELETE CASCADE,

    -- Contexte (une seule de ces colonnes est remplie selon le type)
    presence_id         UUID        REFERENCES presences(id) ON DELETE SET NULL,
    evaluation_id       UUID        REFERENCES evaluations(id) ON DELETE SET NULL,
    moyenne_id          UUID        REFERENCES moyennes_generales(id) ON DELETE SET NULL,
    sanction_id         UUID        REFERENCES sanctions(id) ON DELETE SET NULL,
    evenement_id        UUID        REFERENCES evenements(id) ON DELETE SET NULL,
    modif_edt_id        UUID        REFERENCES modifications_edt(id) ON DELETE SET NULL,

    -- File de traitement
    priorite            SMALLINT    NOT NULL DEFAULT 2
                            CHECK (priorite BETWEEN 1 AND 3),
                        -- 1 = urgent (absences, sanctions), 2 = normal, 3 = faible (résumé hebdo)
    statut              VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                            CHECK (statut IN ('en_attente', 'en_cours', 'envoye', 'echec', 'annule')),
    a_traiter_apres     TIMESTAMPTZ NOT NULL DEFAULT now(),
    nb_tentatives       SMALLINT    NOT NULL DEFAULT 0,
    prochaine_tentative TIMESTAMPTZ,
    erreur              TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    traite_at           TIMESTAMPTZ
);

-- Index partiel ultra-performant — utilisé par le worker en polling
CREATE INDEX idx_taches_file_traitement
    ON taches_notifications (priorite ASC, a_traiter_apres ASC)
    WHERE statut = 'en_attente';

CREATE INDEX idx_taches_inscription ON taches_notifications(inscription_id, created_at DESC);

COMMENT ON TABLE taches_notifications IS 'File des notifications. L''index partiel sur statut=''en_attente'' rend le polling du worker ultra-rapide.';


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Déclenchement automatique des notifications d'absence
-- Dès qu'une absence est insérée dans presences, une tâche
-- est créée dans taches_notifications
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_notif_absence()
RETURNS TRIGGER AS $$
BEGIN
    -- Absence (non justifiée à la saisie)
    IF NEW.statut = 'absent' AND NOT NEW.est_justifie THEN
        INSERT INTO taches_notifications (
            type_notif,
            inscription_id,
            presence_id,
            priorite,
            a_traiter_apres
        ) VALUES (
            'absence_non_justifiee',
            NEW.inscription_id,
            NEW.id,
            1,          -- Priorité maximale — traitement immédiat
            now()
        );

    -- Retard
    ELSIF NEW.statut = 'retard' THEN
        INSERT INTO taches_notifications (
            type_notif,
            inscription_id,
            presence_id,
            priorite,
            a_traiter_apres
        ) VALUES (
            'retard',
            NEW.inscription_id,
            NEW.id,
            2,          -- Priorité normale
            now() + INTERVAL '5 minutes'  -- Petit délai pour regroupement éventuel
        );
    END IF;

    -- Si une absence est justifiée après coup, on annule la notification si pas encore envoyée
    IF TG_OP = 'UPDATE'
       AND NEW.est_justifie = TRUE
       AND OLD.est_justifie = FALSE
    THEN
        UPDATE taches_notifications
        SET statut = 'annule'
        WHERE presence_id = NEW.id
          AND statut = 'en_attente';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notif_absence
    AFTER INSERT OR UPDATE OF statut, est_justifie ON presences
    FOR EACH ROW EXECUTE FUNCTION trigger_notif_absence();


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Notification quand les notes sont publiées
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_notif_notes_publiees()
RETURNS TRIGGER AS $$
BEGIN
    -- Déclenché uniquement quand notes_publiees passe de FALSE à TRUE
    IF NEW.notes_publiees = TRUE AND OLD.notes_publiees = FALSE THEN

        -- Créer une tâche pour chaque élève ayant une note à cette évaluation
        INSERT INTO taches_notifications (
            type_notif,
            inscription_id,
            evaluation_id,
            priorite,
            a_traiter_apres
        )
        SELECT
            'nouvelle_note',
            n.inscription_id,
            NEW.id,
            2,
            now() + INTERVAL '2 minutes'  -- Petit délai pour regroupement
        FROM notes n
        WHERE n.evaluation_id = NEW.id
          AND n.valeur IS NOT NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notif_notes_publiees
    AFTER UPDATE OF notes_publiees ON evaluations
    FOR EACH ROW EXECUTE FUNCTION trigger_notif_notes_publiees();


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Notification quand un bulletin est généré
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_notif_bulletin()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.bulletin_genere = TRUE AND OLD.bulletin_genere = FALSE THEN
        INSERT INTO taches_notifications (
            type_notif,
            inscription_id,
            moyenne_id,
            priorite,
            a_traiter_apres
        ) VALUES (
            'bulletin_disponible',
            NEW.inscription_id,
            NEW.id,
            2,
            now()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notif_bulletin
    AFTER UPDATE OF bulletin_genere ON moyennes_generales
    FOR EACH ROW EXECUTE FUNCTION trigger_notif_bulletin();


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Mise à jour du récapitulatif absences
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION maj_recapitulatif_absences()
RETURNS TRIGGER AS $$
DECLARE
    v_inscription_id    UUID;
    v_periode_id        UUID;
    v_duree_heures      NUMERIC(5,1);
BEGIN
    v_inscription_id := COALESCE(NEW.inscription_id, OLD.inscription_id);

    -- Trouver la période correspondant à la date du cours
    SELECT p.id INTO v_periode_id
    FROM appels a
    JOIN emplois_du_temps edt ON edt.id = a.emploi_du_temps_id
    JOIN plages_horaires ph ON ph.id = edt.plage_id
    JOIN periodes p ON p.id = (
        SELECT per.id FROM periodes per
        JOIN annees_scolaires ann ON ann.id = per.annee_scolaire_id
        JOIN inscriptions i ON i.annee_scolaire_id = ann.id
        WHERE i.id = v_inscription_id
          AND a.date_cours BETWEEN per.date_debut AND per.date_fin
        LIMIT 1
    )
    WHERE a.id = COALESCE(NEW.appel_id, OLD.appel_id)
    LIMIT 1;

    IF v_periode_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

    -- Recalculer le récapitulatif
    INSERT INTO recapitulatifs_absences (
        inscription_id,
        periode_id,
        nb_seances_absences_just,
        nb_seances_absences_injust,
        nb_seances_retards,
        mis_a_jour_at
    )
    SELECT
        v_inscription_id,
        v_periode_id,
        COUNT(*) FILTER (WHERE p2.statut = 'absent' AND p2.est_justifie = TRUE),
        COUNT(*) FILTER (WHERE p2.statut = 'absent' AND p2.est_justifie = FALSE),
        COUNT(*) FILTER (WHERE p2.statut = 'retard'),
        now()
    FROM presences p2
    JOIN appels a2 ON a2.id = p2.appel_id
    JOIN emplois_du_temps edt2 ON edt2.id = a2.emploi_du_temps_id
    JOIN periodes per2 ON per2.id = v_periode_id
    WHERE p2.inscription_id = v_inscription_id
      AND a2.date_cours BETWEEN per2.date_debut AND per2.date_fin
    ON CONFLICT (inscription_id, periode_id) DO UPDATE SET
        nb_seances_absences_just   = EXCLUDED.nb_seances_absences_just,
        nb_seances_absences_injust = EXCLUDED.nb_seances_absences_injust,
        nb_seances_retards         = EXCLUDED.nb_seances_retards,
        mis_a_jour_at              = now();

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maj_recapitulatif
    AFTER INSERT OR UPDATE OR DELETE ON presences
    FOR EACH ROW EXECUTE FUNCTION maj_recapitulatif_absences();


DO $$
BEGIN
  RAISE NOTICE 'Migration 004 terminée — 11 tables créées : plages_horaires, emplois_du_temps, modifications_edt, appels, presences, recapitulatifs_absences, incidents_discipline, sanctions, evenements, autorisations_sorties, taches_notifications';
  RAISE NOTICE 'Triggers créés : trigger_notif_absence, trigger_notif_notes_publiees, trigger_notif_bulletin, maj_recapitulatif_absences';
END;
$$;
