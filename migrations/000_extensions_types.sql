-- ============================================================
-- MIGRATION 000 — Extensions & Types ENUM
-- Projet : Gestion Scolaire Afrique de l'Ouest (Francophone)
-- Auteur  : Architecture Technique v1.0
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Recherche texte floue

-- ── DOMAINE 1 — IDENTITÉS ───────────────────────────────────
CREATE TYPE type_etablissement AS ENUM (
    'primaire', 'college', 'lycee', 'franco_arabe', 'prive_catholique', 'prive_laique'
);

CREATE TYPE type_periode AS ENUM ('trimestre', 'semestre');

CREATE TYPE cycle_niveau AS ENUM ('primaire', 'college', 'lycee', 'superieur');

-- ── DOMAINE 2 — ACTEURS ─────────────────────────────────────
CREATE TYPE code_role AS ENUM (
    'super_admin', 'directeur', 'censeur', 'enseignant',
    'admin', 'surveillant', 'parent', 'eleve'
);

CREATE TYPE canal_notif AS ENUM ('sms', 'whatsapp', 'app', 'email');

CREATE TYPE categorie_notif AS ENUM ('urgence', 'quotidien', 'programme', 'document');

CREATE TYPE statut_notif AS ENUM (
    'en_attente', 'en_cours', 'envoye', 'livre', 'lu', 'echec', 'annule'
);

-- ── DOMAINE 3 — PÉDAGOGIE ───────────────────────────────────
CREATE TYPE type_evaluation AS ENUM (
    'devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet'
);

CREATE TYPE methode_arrondi AS ENUM (
    'demi_superieur', 'superieur', 'inferieur', 'bancaire'
);

CREATE TYPE type_serie AS ENUM (
    'scientifique', 'litteraire', 'technique', 'gestion', 'artistique'
);

CREATE TYPE mention_bulletin AS ENUM (
    'tres_bien', 'bien', 'assez_bien', 'passable', 'insuffisant', 'tres_insuffisant'
);

CREATE TYPE decision_conseil AS ENUM (
    'felicitations', 'encouragements', 'tableau_honneur',
    'avert_travail', 'avert_conduite', 'blâme', 'aucune'
);

CREATE TYPE decision_passage AS ENUM (
    'admis', 'ajourne', 'redoublant', 'exclu_definitif', 'transfere'
);

-- ── DOMAINE 4 — VIE SCOLAIRE ────────────────────────────────
CREATE TYPE statut_presence AS ENUM (
    'present', 'absent', 'retard', 'sorti_avant', 'dispense', 'non_saisi'
);

CREATE TYPE statut_appel AS ENUM (
    'ouvert', 'effectue', 'cours_annule', 'non_effectue'
);

CREATE TYPE type_modification_edt AS ENUM (
    'annulation', 'deplacement', 'remplacement', 'salle_changee', 'cours_supplementaire'
);

CREATE TYPE type_incident AS ENUM (
    'perturbation_cours', 'insolence', 'violence_verbale', 'violence_physique',
    'fraude', 'vol', 'harcelement', 'consommation_substance', 'autre'
);

CREATE TYPE gravite_incident AS ENUM ('mineur', 'moyen', 'grave', 'tres_grave');

CREATE TYPE statut_incident AS ENUM ('ouvert', 'en_traitement', 'clos');

CREATE TYPE type_sanction AS ENUM (
    'avertissement_oral', 'avertissement_ecrit', 'retenue',
    'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive'
);

CREATE TYPE type_evenement AS ENUM (
    'sortie_scolaire', 'reunion_parents', 'examen_officiel',
    'conseil_classe', 'journee_sportive', 'journee_culturelle',
    'visite_etablissement', 'vacances', 'pont', 'autre'
);

CREATE TYPE statut_autorisation AS ENUM ('en_attente', 'autorise', 'refuse');

CREATE TYPE statut_tache_notif AS ENUM (
    'en_attente', 'en_cours', 'envoye', 'echec', 'annule', 'expire'
);

-- ── DOMAINE 5 — SÉCURITÉ ────────────────────────────────────
CREATE TYPE type_surcharge_perm AS ENUM ('grant', 'revoke');

CREATE TYPE type_appareil AS ENUM (
    'mobile_android', 'mobile_ios', 'tablet_android', 'tablet_ios', 'desktop', 'web'
);

CREATE TYPE canal_connexion AS ENUM ('web', 'mobile_app', 'api', 'sms_bot');

CREATE TYPE objectif_otp AS ENUM (
    'connexion', 'validation_compte', 'reset_mdp', 'confirmation_action'
);

CREATE TYPE resultat_audit AS ENUM ('succes', 'echec', 'refuse', 'erreur_serveur');

-- ── Fonction utilitaire UUID v4 ──────────────────────────────
CREATE OR REPLACE FUNCTION gen_uuid()
RETURNS UUID AS $$
    SELECT uuid_generate_v4();
$$ LANGUAGE SQL;
