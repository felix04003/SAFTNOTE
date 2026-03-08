-- ============================================================
-- MIGRATION 002 — DOMAINE 2 : Acteurs & Notifications
-- Tables : roles, utilisateurs, utilisateur_roles,
--          eleves, inscriptions, parents_eleves,
--          enseignants, notifications_preferences,
--          journal_notifications
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE 06 — roles
-- Référentiel des rôles disponibles dans le système
-- ──────────────────────────────────────────────────────────────
CREATE TABLE roles (
    id          SMALLSERIAL  PRIMARY KEY,
    code        VARCHAR(30)  NOT NULL UNIQUE,
    libelle     VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Données de référence (stables, rarement modifiées)
INSERT INTO roles (code, libelle, description) VALUES
    ('super_admin',  'Super Administrateur', 'Accès à tous les établissements — équipe technique'),
    ('directeur',    'Directeur',            'Accès complet à son établissement'),
    ('censeur',      'Censeur / Surveillant général', 'Absences, discipline, EDT'),
    ('admin',        'Administrateur / Secrétariat',  'Gestion administrative'),
    ('enseignant',   'Enseignant',           'Saisie des notes et appels pour ses classes'),
    ('parent',       'Parent / Tuteur',      'Consultation des données de ses enfants'),
    ('eleve',        'Élève',                'Consultation de ses propres données');

COMMENT ON TABLE roles IS 'Référentiel des rôles. Données stables insérées à la migration.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 07 — utilisateurs
-- Toutes les identités : élèves, parents, enseignants, admins
-- ──────────────────────────────────────────────────────────────
CREATE TABLE utilisateurs (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID         NOT NULL REFERENCES etablissements(id) ON DELETE RESTRICT,

    -- Identité civile
    nom                 VARCHAR(100) NOT NULL,
    prenom              VARCHAR(100) NOT NULL,
    date_naissance      DATE,
    genre               VARCHAR(10)  CHECK (genre IN ('M', 'F', 'autre')),
    photo_url           TEXT,

    -- Contact
    telephone           VARCHAR(20),             -- Format international : +221771234567
    telephone_2         VARCHAR(20),
    email               VARCHAR(150),
    adresse             TEXT,
    quartier            VARCHAR(100),
    ville               VARCHAR(100),

    -- Authentification
    mot_de_passe_hash   TEXT,                    -- NULL si auth OTP SMS uniquement (parents)
    derniere_connexion  TIMESTAMPTZ,
    actif               BOOLEAN      NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    -- Un email peut exister dans plusieurs établissements, mais pas deux fois dans le même
    UNIQUE (etablissement_id, email),
    -- Un téléphone est unique globalement (clé pour l'OTP SMS)
    UNIQUE (telephone)
);

CREATE INDEX idx_utilisateurs_etablissement ON utilisateurs(etablissement_id);
CREATE INDEX idx_utilisateurs_telephone     ON utilisateurs(telephone) WHERE telephone IS NOT NULL;
CREATE INDEX idx_utilisateurs_email         ON utilisateurs(etablissement_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_utilisateurs_nom           ON utilisateurs USING gin(to_tsvector('french', nom || ' ' || prenom));

CREATE TRIGGER trg_utilisateurs_updated_at
    BEFORE UPDATE ON utilisateurs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE utilisateurs IS 'Table centrale de toutes les identités. Élèves, parents, enseignants ont tous une ligne ici.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 08 — utilisateur_roles
-- Association personne ↔ rôle (plusieurs rôles possibles)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE utilisateur_roles (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    role_id             SMALLINT    NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    actif               BOOLEAN     NOT NULL DEFAULT TRUE,
    date_debut          DATE        NOT NULL DEFAULT CURRENT_DATE,
    date_fin            DATE,       -- NULL = rôle permanent
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (utilisateur_id, role_id, etablissement_id)
);

CREATE INDEX idx_uroles_utilisateur     ON utilisateur_roles(utilisateur_id, actif);
CREATE INDEX idx_uroles_etablissement   ON utilisateur_roles(etablissement_id, role_id);

COMMENT ON TABLE utilisateur_roles IS 'Pivot rôles. Une personne peut avoir plusieurs rôles simultanément.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 09 — eleves
-- Informations spécifiques au rôle élève
-- ──────────────────────────────────────────────────────────────
CREATE TABLE eleves (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID        NOT NULL UNIQUE REFERENCES utilisateurs(id) ON DELETE CASCADE,

    -- Identifiant scolaire
    matricule           VARCHAR(30) UNIQUE,      -- Matricule officiel
    numero_inscription  VARCHAR(30),

    -- Historique scolaire
    date_inscription    DATE        NOT NULL DEFAULT CURRENT_DATE,
    etablissement_origine VARCHAR(200),          -- Établissement précédent
    redoublant          BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Données médicales (accès restreint — voir permissions)
    groupe_sanguin      VARCHAR(5),
    allergies           TEXT,
    conditions_medicales TEXT,
    medecin_urgence     VARCHAR(200),
    tel_urgence         VARCHAR(20),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_eleves_matricule ON eleves(matricule) WHERE matricule IS NOT NULL;

CREATE TRIGGER trg_eleves_updated_at
    BEFORE UPDATE ON eleves
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE eleves IS 'Données spécifiques aux élèves. Complète utilisateurs pour ce rôle.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 10 — inscriptions
-- Pivot central : élève dans une classe pour une année
-- ──────────────────────────────────────────────────────────────
CREATE TABLE inscriptions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    eleve_id            UUID        NOT NULL REFERENCES eleves(id) ON DELETE RESTRICT,
    classe_id           UUID        NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
    annee_scolaire_id   UUID        NOT NULL REFERENCES annees_scolaires(id) ON DELETE RESTRICT,

    statut              VARCHAR(20) NOT NULL DEFAULT 'actif'
                            CHECK (statut IN ('actif', 'transfere', 'abandonne', 'exclu', 'diplome')),
    date_inscription    DATE        NOT NULL DEFAULT CURRENT_DATE,
    date_fin            DATE,       -- Si transfert ou abandon en cours d'année

    -- Classement (mis à jour lors des bulletins)
    rang_classe         SMALLINT,

    -- Série du lycée (NULL pour le primaire et le collège)
    serie_id            UUID,       -- FK vers series, ajoutée en migration 003

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Un élève ne peut être inscrit qu'une seule fois par année scolaire
    UNIQUE (eleve_id, annee_scolaire_id)
);

CREATE INDEX idx_inscriptions_eleve     ON inscriptions(eleve_id);
CREATE INDEX idx_inscriptions_classe    ON inscriptions(classe_id, statut);
CREATE INDEX idx_inscriptions_annee     ON inscriptions(annee_scolaire_id);

CREATE TRIGGER trg_inscriptions_updated_at
    BEFORE UPDATE ON inscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE inscriptions IS 'Pivot central. UNIQUE (eleve_id, annee_scolaire_id) — une inscription par an.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 11 — parents_eleves
-- Lien parent(s) ↔ enfant(s)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE parents_eleves (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id               UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    eleve_id                UUID        NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
    lien                    VARCHAR(30) NOT NULL
                                CHECK (lien IN ('pere', 'mere', 'tuteur', 'grand_parent', 'oncle_tante', 'autre')),
    est_contact_principal   BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Droits de consultation (granularité fine)
    peut_voir_notes         BOOLEAN     NOT NULL DEFAULT TRUE,
    peut_voir_absences      BOOLEAN     NOT NULL DEFAULT TRUE,
    peut_voir_bulletins     BOOLEAN     NOT NULL DEFAULT TRUE,
    peut_voir_discipline    BOOLEAN     NOT NULL DEFAULT TRUE,
    autorise_sortie         BOOLEAN     NOT NULL DEFAULT TRUE,  -- Autorisation de sortie scolaire

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (parent_id, eleve_id)
);

-- Index partiel : un seul contact principal par élève
CREATE UNIQUE INDEX idx_contact_principal_unique
    ON parents_eleves (eleve_id)
    WHERE est_contact_principal = TRUE;

CREATE INDEX idx_parents_eleves_parent ON parents_eleves(parent_id);
CREATE INDEX idx_parents_eleves_eleve  ON parents_eleves(eleve_id);

COMMENT ON TABLE parents_eleves IS 'Lien parent-enfant. L''index partiel garantit un seul contact principal par élève.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 12 — enseignants
-- Informations spécifiques aux enseignants
-- ──────────────────────────────────────────────────────────────
CREATE TABLE enseignants (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID        NOT NULL UNIQUE REFERENCES utilisateurs(id) ON DELETE CASCADE,

    matricule_fonct     VARCHAR(30) UNIQUE,  -- Matricule de la fonction publique
    specialite          VARCHAR(100),        -- Domaine d'enseignement principal
    type_contrat        VARCHAR(30) NOT NULL DEFAULT 'titulaire'
                            CHECK (type_contrat IN ('titulaire', 'vacataire', 'contractuel', 'benevole')),
    date_prise_service  DATE,
    date_fin_contrat    DATE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_enseignants_updated_at
    BEFORE UPDATE ON enseignants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE enseignants IS 'Données spécifiques aux enseignants. Complète utilisateurs pour ce rôle.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 13 — notifications_preferences
-- Préférences de chaque utilisateur pour les notifications
-- ──────────────────────────────────────────────────────────────
CREATE TABLE notifications_preferences (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id          UUID        NOT NULL UNIQUE REFERENCES utilisateurs(id) ON DELETE CASCADE,

    -- Canal
    a_whatsapp              BOOLEAN     NOT NULL DEFAULT FALSE,  -- WhatsApp disponible sur ce numéro ?
    canal_prefere           VARCHAR(10) NOT NULL DEFAULT 'sms'
                                CHECK (canal_prefere IN ('sms', 'whatsapp', 'app', 'email')),

    -- Opt-in par catégorie
    -- Catégorie A (urgences) : toujours envoyée, non désactivable
    notif_absences          BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_retards           BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_notes             BOOLEAN     NOT NULL DEFAULT TRUE,   -- Nouvelles notes publiées
    notif_bulletins         BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_devoirs           BOOLEAN     NOT NULL DEFAULT FALSE,  -- Rappel devoirs à venir
    notif_evenements        BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_discipline        BOOLEAN     NOT NULL DEFAULT TRUE,
    notif_resume_hebdo      BOOLEAN     NOT NULL DEFAULT FALSE,  -- Résumé du dimanche soir (opt-in)

    -- Plage horaire (aucune notification hors de cette plage, sauf urgences)
    heure_debut_notif       TIME        NOT NULL DEFAULT '07:00',
    heure_fin_notif         TIME        NOT NULL DEFAULT '21:00',

    -- Langue des messages
    langue                  VARCHAR(5)  NOT NULL DEFAULT 'fr'
                                CHECK (langue IN ('fr', 'en', 'ar')),

    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE notifications_preferences IS 'Préférences de notification par utilisateur. La catégorie A ignore ces préférences.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 14 — journal_notifications
-- Traçabilité complète de tous les messages envoyés
-- ──────────────────────────────────────────────────────────────
CREATE TABLE journal_notifications (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id),
    destinataire_id     UUID        NOT NULL REFERENCES utilisateurs(id),
    eleve_id            UUID        REFERENCES eleves(id),  -- L'élève concerné (si applicable)

    -- Message
    canal               VARCHAR(20) NOT NULL CHECK (canal IN ('sms', 'whatsapp', 'email', 'push')),
    categorie           VARCHAR(20) NOT NULL
                            CHECK (categorie IN ('urgence', 'quotidien', 'programme', 'document')),
    type_notif          VARCHAR(50) NOT NULL,
                        -- 'absence_injustifiee', 'retard', 'nouvelle_note', 'bulletin_disponible',
                        -- 'convocation', 'sanction', 'modification_edt', 'evenement', 'otp'
    telephone           VARCHAR(20),
    contenu_sms         TEXT,               -- Contenu du SMS (150 car max)
    template_wa_name    VARCHAR(100),       -- Nom du template WhatsApp approuvé par Meta
    template_wa_params  JSONB,             -- Paramètres du template

    -- Suivi de livraison
    statut              VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                            CHECK (statut IN ('en_attente', 'envoye', 'livre', 'lu', 'echec', 'annule')),
    provider_message_id TEXT,               -- ID retourné par Africa's Talking ou Meta
    code_erreur         VARCHAR(50),
    detail_erreur       TEXT,
    nb_tentatives       SMALLINT    NOT NULL DEFAULT 0,

    -- Timestamps de livraison
    envoye_at           TIMESTAMPTZ,
    livre_at            TIMESTAMPTZ,        -- Confirmation de livraison réseau
    lu_at               TIMESTAMPTZ,        -- WhatsApp : double coche bleue

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_destinataire ON journal_notifications(destinataire_id, created_at DESC);
CREATE INDEX idx_notif_eleve        ON journal_notifications(eleve_id, created_at DESC) WHERE eleve_id IS NOT NULL;
CREATE INDEX idx_notif_statut       ON journal_notifications(statut, created_at DESC) WHERE statut IN ('en_attente', 'echec');
CREATE INDEX idx_notif_etablissement ON journal_notifications(etablissement_id, created_at DESC);

COMMENT ON TABLE journal_notifications IS 'Audit complet de tous les messages. Permet le débogage et la mesure d''engagement.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 002 terminée — 9 tables créées : roles, utilisateurs, utilisateur_roles, eleves, inscriptions, parents_eleves, enseignants, notifications_preferences, journal_notifications';
END;
$$;
