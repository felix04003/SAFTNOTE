-- ============================================================
-- MIGRATION 005 — DOMAINE 5 : Sécurité & Audit
-- Tables : permissions, roles_permissions,
--          permissions_surcharges, sessions,
--          tentatives_connexion, otp_verifications,
--          journal_audit, politique_securite
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- TABLE 38 — permissions
-- Référentiel de toutes les actions possibles dans le système
-- Format : 'domaine.action'
-- ──────────────────────────────────────────────────────────────
CREATE TABLE permissions (
    id          SMALLSERIAL  PRIMARY KEY,
    code        VARCHAR(80)  NOT NULL UNIQUE,
    description VARCHAR(200) NOT NULL,
    domaine     VARCHAR(30)  NOT NULL
                    CHECK (domaine IN (
                        'notes',
                        'absences',
                        'discipline',
                        'bulletins',
                        'edt',
                        'eleves',
                        'parents',
                        'enseignants',
                        'config',
                        'rapports',
                        'admin'
                    )),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Toutes les permissions du système (44 permissions) ────────
INSERT INTO permissions (code, description, domaine) VALUES
    -- Notes
    ('notes.voir_classe',       'Voir les notes de tous les élèves d''une classe',  'notes'),
    ('notes.voir_eleve',        'Voir les notes d''un élève (pour les parents)',    'notes'),
    ('notes.saisir',            'Saisir les notes pour ses propres affectations',   'notes'),
    ('notes.modifier_toutes',   'Modifier des notes déjà publiées',                 'notes'),
    ('notes.publier',           'Rendre les notes visibles aux parents',            'notes'),
    ('notes.supprimer',         'Supprimer une note',                               'notes'),

    -- Évaluations
    ('evaluations.creer',       'Créer un devoir ou une composition',               'notes'),
    ('evaluations.modifier',    'Modifier une évaluation',                          'notes'),
    ('evaluations.supprimer',   'Supprimer une évaluation',                         'notes'),

    -- Moyennes et bulletins
    ('moyennes.calculer',       'Lancer le calcul des moyennes',                    'bulletins'),
    ('bulletins.voir',          'Voir les bulletins',                               'bulletins'),
    ('bulletins.generer',       'Générer les PDFs de bulletins',                    'bulletins'),
    ('bulletins.valider',       'Signer et valider un bulletin (direction)',         'bulletins'),
    ('bulletins.envoyer',       'Envoyer les bulletins aux parents',                'bulletins'),
    ('bulletins.conseil',       'Saisir les décisions du conseil de classe',        'bulletins'),

    -- Absences
    ('absences.faire_appel',    'Créer un appel et saisir les présences',           'absences'),
    ('absences.voir_classe',    'Voir les absences de tous les élèves d''une classe','absences'),
    ('absences.voir_eleve',     'Voir les absences d''un élève',                    'absences'),
    ('absences.justifier',      'Justifier une absence',                            'absences'),
    ('absences.stats',          'Voir les statistiques d''absences',                'absences'),

    -- Discipline
    ('discipline.saisir_incident','Signaler un incident disciplinaire',             'discipline'),
    ('discipline.voir',         'Voir les incidents et sanctions',                  'discipline'),
    ('discipline.prononcer',    'Prononcer une sanction',                           'discipline'),
    ('discipline.conseil',      'Convoquer un conseil de discipline',               'discipline'),

    -- EDT
    ('edt.voir',                'Voir les emplois du temps',                        'edt'),
    ('edt.creer',               'Créer et modifier l''emploi du temps',             'edt'),
    ('edt.modifier_ponctuel',   'Signaler une modification ponctuelle',             'edt'),

    -- Élèves
    ('eleves.voir',             'Voir les fiches des élèves',                       'eleves'),
    ('eleves.creer',            'Inscrire un nouvel élève',                         'eleves'),
    ('eleves.modifier',         'Modifier les informations d''un élève',            'eleves'),
    ('eleves.archiver',         'Archiver ou transférer un élève',                  'eleves'),
    ('eleves.medicale',         'Accéder aux données médicales',                    'eleves'),

    -- Parents
    ('parents.voir_contact',    'Voir les contacts parents',                        'parents'),
    ('parents.modifier',        'Associer/modifier les parents d''un élève',        'parents'),

    -- Enseignants
    ('enseignants.voir',        'Voir la liste des enseignants',                    'enseignants'),
    ('enseignants.creer',       'Créer un dossier enseignant',                      'enseignants'),
    ('enseignants.affecter',    'Affecter un enseignant à une classe',              'enseignants'),

    -- Configuration
    ('config.voir',             'Voir la configuration de l''établissement',        'config'),
    ('config.modifier',         'Modifier la configuration générale',               'config'),
    ('config.annee_scolaire',   'Créer et gérer les années scolaires',              'config'),
    ('config.coefficients',     'Modifier les coefficients par matière',            'config'),

    -- Rapports
    ('rapports.voir',           'Voir les rapports et statistiques',                'rapports'),
    ('rapports.exporter',       'Exporter des données en Excel/CSV',                'rapports'),

    -- Administration
    ('admin.utilisateurs',      'Gérer les comptes utilisateurs',                   'admin'),
    ('admin.audit',             'Consulter les journaux d''audit',                  'admin');

COMMENT ON TABLE permissions IS 'Référentiel de 44 permissions. Format : domaine.action. Données stables insérées à la migration.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 39 — roles_permissions
-- Matrice rôle × permission
-- ──────────────────────────────────────────────────────────────
CREATE TABLE roles_permissions (
    role_id         SMALLINT    NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   SMALLINT    NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ── Affectation des permissions par rôle ──────────────────────

-- Fonction d'affectation par code (plus lisible qu'avec des IDs)
CREATE OR REPLACE FUNCTION affecter_permissions(
    p_role_code     VARCHAR,
    p_perm_codes    VARCHAR[]
) RETURNS VOID AS $$
BEGIN
    INSERT INTO roles_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r, permissions p
    WHERE r.code = p_role_code
      AND p.code = ANY(p_perm_codes)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Super Administrateur : toutes les permissions
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'super_admin';

-- Directeur : tout l'établissement
SELECT affecter_permissions('directeur', ARRAY[
    'notes.voir_classe','notes.saisir','notes.modifier_toutes','notes.publier','notes.supprimer',
    'evaluations.creer','evaluations.modifier','evaluations.supprimer',
    'moyennes.calculer','bulletins.voir','bulletins.generer','bulletins.valider',
    'bulletins.envoyer','bulletins.conseil',
    'absences.faire_appel','absences.voir_classe','absences.voir_eleve',
    'absences.justifier','absences.stats',
    'discipline.saisir_incident','discipline.voir','discipline.prononcer','discipline.conseil',
    'edt.voir','edt.creer','edt.modifier_ponctuel',
    'eleves.voir','eleves.creer','eleves.modifier','eleves.archiver','eleves.medicale',
    'parents.voir_contact','parents.modifier',
    'enseignants.voir','enseignants.creer','enseignants.affecter',
    'config.voir','config.modifier','config.annee_scolaire','config.coefficients',
    'rapports.voir','rapports.exporter',
    'admin.utilisateurs','admin.audit'
]);

-- Censeur / Surveillant général : absences, discipline, EDT, pas de notes
SELECT affecter_permissions('censeur', ARRAY[
    'absences.faire_appel','absences.voir_classe','absences.voir_eleve',
    'absences.justifier','absences.stats',
    'discipline.saisir_incident','discipline.voir','discipline.prononcer',
    'edt.voir','edt.modifier_ponctuel',
    'eleves.voir',
    'parents.voir_contact',
    'rapports.voir',
    'bulletins.conseil'
]);

-- Admin / Secrétariat : gestion administrative, pas de saisie de notes
SELECT affecter_permissions('admin', ARRAY[
    'notes.voir_classe',
    'moyennes.calculer','bulletins.voir','bulletins.generer','bulletins.envoyer',
    'absences.voir_classe','absences.voir_eleve','absences.justifier','absences.stats',
    'discipline.voir',
    'edt.voir',
    'eleves.voir','eleves.creer','eleves.modifier','eleves.archiver',
    'parents.voir_contact','parents.modifier',
    'enseignants.voir',
    'config.voir',
    'rapports.voir','rapports.exporter',
    'admin.utilisateurs'
]);

-- Enseignant : ses notes et ses appels uniquement (filtrage par affectation dans le backend)
SELECT affecter_permissions('enseignant', ARRAY[
    'notes.voir_classe','notes.saisir','notes.publier',
    'evaluations.creer','evaluations.modifier',
    'absences.faire_appel','absences.voir_classe',
    'discipline.saisir_incident',
    'edt.voir','edt.modifier_ponctuel',
    'eleves.voir',
    'rapports.voir'
]);

-- Parent : consultation uniquement, données de ses enfants
SELECT affecter_permissions('parent', ARRAY[
    'notes.voir_eleve',
    'bulletins.voir',
    'absences.voir_eleve',
    'edt.voir'
]);

-- Élève : consultation de ses propres données
SELECT affecter_permissions('eleve', ARRAY[
    'notes.voir_eleve',
    'bulletins.voir',
    'edt.voir'
]);

COMMENT ON TABLE roles_permissions IS 'Matrice rôle×permission. PK composite. Initialisée par affecter_permissions() à la migration.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 40 — permissions_surcharges
-- Exceptions individuelles au modèle de rôle
-- ──────────────────────────────────────────────────────────────
CREATE TABLE permissions_surcharges (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id  UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    permission_id   SMALLINT    NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    type            VARCHAR(10) NOT NULL CHECK (type IN ('grant', 'revoke')),
                    -- grant  = accorder une permission supplémentaire
                    -- revoke = retirer une permission du rôle
    motif           TEXT,
    accordee_par    UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE RESTRICT,
    date_debut      DATE        NOT NULL DEFAULT CURRENT_DATE,
    date_fin        DATE,       -- NULL = permanent. Date = temporaire.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (utilisateur_id, permission_id, type)
);

CREATE INDEX idx_surcharges_utilisateur ON permissions_surcharges(utilisateur_id)
    WHERE date_fin IS NULL OR date_fin >= CURRENT_DATE;

COMMENT ON TABLE permissions_surcharges IS 'Exceptions individuelles. Permet des accès ponctuels sans changer le rôle.';


-- ──────────────────────────────────────────────────────────────
-- FONCTION CENTRALE : verifier_permission
-- Appelée par le middleware avant chaque action sensible
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION verifier_permission(
    p_utilisateur_id    UUID,
    p_permission_code   VARCHAR,
    p_etablissement_id  UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_est_actif         BOOLEAN;
    v_est_revoque       BOOLEAN;
    v_a_permission      BOOLEAN;
    v_est_accorde       BOOLEAN;
    v_permission_id     SMALLINT;
BEGIN
    -- 0. Récupérer l'ID de la permission
    SELECT id INTO v_permission_id
    FROM permissions WHERE code = p_permission_code;

    IF v_permission_id IS NULL THEN RETURN FALSE; END IF;

    -- 1. L'utilisateur est-il actif dans cet établissement ?
    SELECT EXISTS (
        SELECT 1 FROM utilisateurs u
        JOIN utilisateur_roles ur ON ur.utilisateur_id = u.id
        WHERE u.id = p_utilisateur_id
          AND u.actif = TRUE
          AND ur.etablissement_id = p_etablissement_id
          AND ur.actif = TRUE
    ) INTO v_est_actif;

    IF NOT v_est_actif THEN RETURN FALSE; END IF;

    -- 2. La permission est-elle révoquée individuellement ?
    SELECT EXISTS (
        SELECT 1 FROM permissions_surcharges
        WHERE utilisateur_id = p_utilisateur_id
          AND permission_id = v_permission_id
          AND type = 'revoke'
          AND (date_fin IS NULL OR date_fin >= CURRENT_DATE)
    ) INTO v_est_revoque;

    IF v_est_revoque THEN RETURN FALSE; END IF;

    -- 3. La permission est-elle accordée via un rôle ?
    SELECT EXISTS (
        SELECT 1
        FROM utilisateur_roles ur
        JOIN roles_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.utilisateur_id = p_utilisateur_id
          AND ur.etablissement_id = p_etablissement_id
          AND ur.actif = TRUE
          AND rp.permission_id = v_permission_id
    ) INTO v_a_permission;

    IF v_a_permission THEN RETURN TRUE; END IF;

    -- 4. La permission est-elle accordée individuellement ?
    SELECT EXISTS (
        SELECT 1 FROM permissions_surcharges
        WHERE utilisateur_id = p_utilisateur_id
          AND permission_id = v_permission_id
          AND type = 'grant'
          AND (date_fin IS NULL OR date_fin >= CURRENT_DATE)
    ) INTO v_est_accorde;

    RETURN v_est_accorde;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION verifier_permission IS 'Vérifie : actif → non révoqué → permission via rôle → permission individuelle. Appelée par le middleware Node.js.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 41 — sessions
-- Sessions actives des utilisateurs connectés
-- ──────────────────────────────────────────────────────────────
CREATE TABLE sessions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id      UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    etablissement_id    UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,

    -- Tokens (on ne stocke que le hash — jamais le token brut)
    token_hash          VARCHAR(64) NOT NULL UNIQUE,     -- SHA-256 du JWT
    refresh_token_hash  VARCHAR(64) UNIQUE,

    -- Contexte de connexion
    ip_address          INET,
    user_agent          TEXT,
    appareil            VARCHAR(30)
                            CHECK (appareil IN (
                                'mobile_android', 'mobile_ios',
                                'desktop', 'tablet', 'sms_bot', 'api'
                            )),
    canal_connexion     VARCHAR(20) NOT NULL DEFAULT 'web'
                            CHECK (canal_connexion IN ('web', 'mobile_app', 'api')),

    -- Durée de vie
    expire_at           TIMESTAMPTZ NOT NULL,
    derniere_activite   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Révocation
    revoquee            BOOLEAN     NOT NULL DEFAULT FALSE,
    motif_revocation    VARCHAR(100),
    revoquee_at         TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_utilisateur   ON sessions(utilisateur_id, revoquee) WHERE revoquee = FALSE;
CREATE INDEX idx_sessions_expire        ON sessions(expire_at)                WHERE revoquee = FALSE;

-- Nettoyage automatique des sessions expirées (à appeler via pg_cron ou job quotidien)
CREATE OR REPLACE FUNCTION purger_sessions_expirees()
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    DELETE FROM sessions
    WHERE expire_at < now() - INTERVAL '7 days'
       OR revoquee = TRUE;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE sessions IS 'Sessions actives. On stocke le hash SHA-256 du token, jamais le token brut.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 42 — tentatives_connexion
-- Journal des tentatives — détection de force brute
-- ──────────────────────────────────────────────────────────────
CREATE TABLE tentatives_connexion (
    id              BIGSERIAL   PRIMARY KEY,
    identifiant     VARCHAR(150) NOT NULL,  -- Email ou téléphone tenté
    ip_address      INET        NOT NULL,
    succes          BOOLEAN     NOT NULL,
    motif_echec     VARCHAR(50)
                        CHECK (motif_echec IN (
                            'mot_de_passe_incorrect',
                            'compte_inexistant',
                            'compte_bloque',
                            'compte_inactif',
                            'otp_invalide',
                            'otp_expire',
                            'etablissement_inconnu'
                        )),
    tentee_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tentatives_identifiant ON tentatives_connexion(identifiant, tentee_at DESC);
CREATE INDEX idx_tentatives_ip          ON tentatives_connexion(ip_address, tentee_at DESC);

-- Fonction : est-ce que ce compte/IP est bloqué ?
CREATE OR REPLACE FUNCTION est_compte_bloque(
    p_identifiant   VARCHAR,
    p_ip            INET
) RETURNS BOOLEAN AS $$
DECLARE
    v_nb_echecs     INTEGER;
    v_politique     RECORD;
BEGIN
    -- Récupérer la politique de l'établissement (on prend la valeur par défaut si inconnue)
    -- On utilise les valeurs par défaut de politique_securite (créée plus bas)
    SELECT
        COALESCE(MAX(ps.blocage_nb_tentatives), 5)    AS nb_max,
        COALESCE(MAX(ps.blocage_duree_minutes), 15)   AS duree_min
    INTO v_politique
    FROM politique_securite ps;

    SELECT COUNT(*) INTO v_nb_echecs
    FROM tentatives_connexion
    WHERE (identifiant = p_identifiant OR ip_address = p_ip)
      AND succes = FALSE
      AND tentee_at > now() - (v_politique.duree_min || ' minutes')::INTERVAL;

    RETURN v_nb_echecs >= v_politique.nb_max;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE tentatives_connexion IS 'Journal des tentatives. est_compte_bloque() détecte les attaques par force brute.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 43 — otp_verifications
-- Codes OTP envoyés par SMS pour l'authentification des parents
-- ──────────────────────────────────────────────────────────────
CREATE TABLE otp_verifications (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    telephone       VARCHAR(20) NOT NULL,
    code_hash       VARCHAR(64) NOT NULL,   -- SHA-256 du code OTP à 6 chiffres
    objectif        VARCHAR(30) NOT NULL
                        CHECK (objectif IN (
                            'connexion',
                            'validation_compte',
                            'reset_mdp',
                            'changement_telephone'
                        )),
    utilisateur_id  UUID        REFERENCES utilisateurs(id) ON DELETE CASCADE,
    expire_at       TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
    utilise         BOOLEAN     NOT NULL DEFAULT FALSE,
    utilise_at      TIMESTAMPTZ,
    nb_tentatives   SMALLINT    NOT NULL DEFAULT 0 CHECK (nb_tentatives <= 3),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_telephone  ON otp_verifications(telephone, utilise, expire_at);

-- Nettoyage des OTP expirés
CREATE OR REPLACE FUNCTION purger_otp_expires()
RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    DELETE FROM otp_verifications
    WHERE expire_at < now() - INTERVAL '1 hour'
       OR utilise = TRUE;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON TABLE otp_verifications IS 'OTP pour l''auth des parents sans mot de passe. Code 6 chiffres, SHA-256, valide 10 min, max 3 tentatives.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 44 — journal_audit
-- Traçabilité complète de toutes les modifications
-- BIGSERIAL pour volumes élevés (pas UUID)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE journal_audit (
    id                  BIGSERIAL   PRIMARY KEY,
    etablissement_id    UUID        REFERENCES etablissements(id) ON DELETE SET NULL,
    utilisateur_id      UUID        REFERENCES utilisateurs(id) ON DELETE SET NULL,
    session_id          UUID        REFERENCES sessions(id) ON DELETE SET NULL,
    ip_address          INET,

    -- L'action effectuée
    action              VARCHAR(80) NOT NULL,   -- 'notes.saisir', 'bulletins.valider'
    resultat            VARCHAR(10) NOT NULL
                            CHECK (resultat IN ('succes', 'echec', 'refuse')),

    -- L'objet modifié
    table_cible         VARCHAR(60),
    enregistrement_id   UUID,

    -- Contenu de la modification
    valeur_avant        JSONB,                  -- État avant
    valeur_apres        JSONB,                  -- État après
    details             JSONB,                  -- Informations contextuelles supplémentaires

    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Partitionnement par année pour les performances
CREATE TABLE journal_audit_2025 PARTITION OF journal_audit
    FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE journal_audit_2026 PARTITION OF journal_audit
    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE journal_audit_2027 PARTITION OF journal_audit
    FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX idx_audit_utilisateur     ON journal_audit(utilisateur_id, created_at DESC);
CREATE INDEX idx_audit_etablissement   ON journal_audit(etablissement_id, created_at DESC);
CREATE INDEX idx_audit_table_cible     ON journal_audit(table_cible, enregistrement_id);
CREATE INDEX idx_audit_action          ON journal_audit(action, created_at DESC);

COMMENT ON TABLE journal_audit IS 'Traçabilité complète. BIGSERIAL + partitionnement annuel pour volumes élevés.';


-- ──────────────────────────────────────────────────────────────
-- TABLE 45 — politique_securite
-- Configuration des règles de sécurité par établissement
-- ──────────────────────────────────────────────────────────────
CREATE TABLE politique_securite (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    etablissement_id            UUID        NOT NULL UNIQUE
                                    REFERENCES etablissements(id) ON DELETE CASCADE,

    -- Mots de passe
    mdp_longueur_min            SMALLINT    NOT NULL DEFAULT 8,
    mdp_necessite_majuscule     BOOLEAN     NOT NULL DEFAULT FALSE,
    mdp_necessite_chiffre       BOOLEAN     NOT NULL DEFAULT TRUE,
    mdp_expiration_jours        SMALLINT    NOT NULL DEFAULT 0,     -- 0 = jamais

    -- Sessions
    session_duree_minutes       SMALLINT    NOT NULL DEFAULT 480,   -- 8 heures
    session_inactivite_min      SMALLINT    NOT NULL DEFAULT 60,    -- Déconnexion après 1h sans activité
    session_max_simultanees     SMALLINT    NOT NULL DEFAULT 3,     -- Max 3 sessions actives

    -- OTP
    otp_duree_validite_min      SMALLINT    NOT NULL DEFAULT 10,
    otp_max_tentatives          SMALLINT    NOT NULL DEFAULT 3,

    -- Blocage force brute
    blocage_nb_tentatives       SMALLINT    NOT NULL DEFAULT 5,
    blocage_duree_minutes       SMALLINT    NOT NULL DEFAULT 15,

    -- Conservation des données d'audit
    conservation_audit_jours    INTEGER     NOT NULL DEFAULT 365,

    -- Restriction IP (pour les admins et directeurs)
    restriction_ip_active       BOOLEAN     NOT NULL DEFAULT FALSE,
    plages_ip_autorisees        TEXT[],     -- CIDR notation : ['192.168.1.0/24']

    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE politique_securite IS 'Configuration sécurité par établissement. Valeurs par défaut adaptées au contexte africain.';


-- ──────────────────────────────────────────────────────────────
-- TRIGGER : Audit automatique sur les tables critiques
-- Déclenché sur notes, moyennes_generales, sanctions,
-- configs_systeme_notes, configs_matieres_niveau
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_audit_generique()
RETURNS TRIGGER AS $$
DECLARE
    v_utilisateur_id    UUID;
    v_session_id        UUID;
    v_etablissement_id  UUID;
    v_action            VARCHAR;
    v_avant             JSONB := NULL;
    v_apres             JSONB := NULL;
BEGIN
    -- Récupérer le contexte posé par le backend Node.js
    BEGIN
        v_utilisateur_id := current_setting('app.utilisateur_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_utilisateur_id := NULL;
    END;

    BEGIN
        v_session_id := current_setting('app.session_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_session_id := NULL;
    END;

    BEGIN
        v_etablissement_id := current_setting('app.etablissement_id', TRUE)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_etablissement_id := NULL;
    END;

    -- Construire l'action et les valeurs avant/après
    IF TG_OP = 'INSERT' THEN
        v_action := TG_TABLE_NAME || '.creer';
        v_apres  := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := TG_TABLE_NAME || '.modifier';
        v_avant  := to_jsonb(OLD);
        v_apres  := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_action := TG_TABLE_NAME || '.supprimer';
        v_avant  := to_jsonb(OLD);
    END IF;

    INSERT INTO journal_audit (
        etablissement_id,
        utilisateur_id,
        session_id,
        ip_address,
        action,
        resultat,
        table_cible,
        enregistrement_id,
        valeur_avant,
        valeur_apres
    ) VALUES (
        v_etablissement_id,
        v_utilisateur_id,
        v_session_id,
        NULL,                   -- L'IP est posée dans les details par le middleware
        v_action,
        'succes',
        TG_TABLE_NAME,
        CASE WHEN TG_OP = 'DELETE' THEN (OLD).id ELSE (NEW).id END,
        v_avant,
        v_apres
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- Activation des triggers d'audit sur les tables critiques
CREATE TRIGGER audit_notes
    AFTER INSERT OR UPDATE OR DELETE ON notes
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();

CREATE TRIGGER audit_moyennes_generales
    AFTER INSERT OR UPDATE OR DELETE ON moyennes_generales
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();

CREATE TRIGGER audit_sanctions
    AFTER INSERT OR UPDATE OR DELETE ON sanctions
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();

CREATE TRIGGER audit_configs_notes
    AFTER INSERT OR UPDATE OR DELETE ON configs_systeme_notes
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();

CREATE TRIGGER audit_configs_coefficients
    AFTER INSERT OR UPDATE OR DELETE ON configs_matieres_niveau
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();

CREATE TRIGGER audit_inscriptions
    AFTER INSERT OR UPDATE OR DELETE ON inscriptions
    FOR EACH ROW EXECUTE FUNCTION trigger_audit_generique();


-- ──────────────────────────────────────────────────────────────
-- PROCÉDURE : Initialiser un établissement complet
-- Crée toutes les configurations par défaut pour un nouvel établissement
-- ──────────────────────────────────────────────────────────────
CREATE OR REPLACE PROCEDURE initialiser_etablissement(
    p_nom               VARCHAR,
    p_pays              VARCHAR,
    p_type              VARCHAR,
    p_ville             VARCHAR DEFAULT NULL,
    p_code_officiel     VARCHAR DEFAULT NULL
)
LANGUAGE plpgsql AS $$
DECLARE
    v_etab_id   UUID;
BEGIN
    -- 1. Créer l'établissement
    INSERT INTO etablissements (nom, code_officiel, type, pays, ville)
    VALUES (p_nom, p_code_officiel, p_type, p_pays, p_ville)
    RETURNING id INTO v_etab_id;

    -- 2. Initialiser la configuration du système de notes
    INSERT INTO configs_systeme_notes (etablissement_id)
    VALUES (v_etab_id);

    -- 3. Initialiser la grille des appréciations
    PERFORM initialiser_grille_appreciations(v_etab_id);

    -- 4. Initialiser la politique de sécurité
    INSERT INTO politique_securite (etablissement_id)
    VALUES (v_etab_id);

    RAISE NOTICE 'Établissement % initialisé avec ID : %', p_nom, v_etab_id;
END;
$$;


DO $$
BEGIN
  RAISE NOTICE 'Migration 005 terminée — 8 tables créées : permissions, roles_permissions, permissions_surcharges, sessions, tentatives_connexion, otp_verifications, journal_audit (partitionné), politique_securite';
  RAISE NOTICE 'Fonctions créées : verifier_permission(), est_compte_bloque(), trigger_audit_generique(), initialiser_etablissement()';
  RAISE NOTICE '44 permissions chargées — matrice rôles×permissions initialisée';
END;
$$;
