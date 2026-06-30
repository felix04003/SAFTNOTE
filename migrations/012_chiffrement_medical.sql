-- ============================================================
-- MIGRATION 012 — Chiffrement des données médicales sensibles
-- Utilise pgcrypto (déjà activé dans 000_extensions.sql)
--
-- Les colonnes médicales (allergies, conditions_medicales,
-- groupe_sanguin, medecin_urgence) sont chiffrées avec
-- pgcrypto symmetric encryption (AES-256 via pgp_sym_encrypt).
--
-- La clé de chiffrement est fournie par la variable d'env
-- MEDICAL_ENCRYPTION_KEY — à configurer obligatoirement en prod.
-- ============================================================

-- NOTE IMPORTANTE : Ce script ajoute des colonnes chiffrées _enc
-- en parallèle des colonnes existantes. La migration des données
-- existantes doit être faite via le script applicatif
-- (voir backend/src/scripts/migrate-medical-data.js).
-- Les anciennes colonnes seront supprimées après migration complète.

-- Vérifier que pgcrypto est bien disponible
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION 'pgcrypto non installé — exécuter 000_extensions.sql d''abord';
  END IF;
END;
$$;

-- Ajouter les nouvelles colonnes chiffrées (BYTEA pour pgp_sym_encrypt)
ALTER TABLE eleves
  ADD COLUMN IF NOT EXISTS allergies_enc         BYTEA,
  ADD COLUMN IF NOT EXISTS conditions_medicales_enc BYTEA,
  ADD COLUMN IF NOT EXISTS groupe_sanguin_enc    BYTEA,
  ADD COLUMN IF NOT EXISTS medecin_urgence_enc   BYTEA,
  ADD COLUMN IF NOT EXISTS donnees_medicales_migrees BOOLEAN NOT NULL DEFAULT FALSE;

-- Fonction helper pour chiffrer une valeur texte
-- Appelée côté applicatif — pas directement en SQL pour éviter d'exposer la clé
-- dans les logs de requête.
CREATE OR REPLACE FUNCTION chiffrer_medical(p_valeur TEXT, p_cle TEXT)
RETURNS BYTEA AS $$
BEGIN
  IF p_valeur IS NULL OR p_valeur = '' THEN RETURN NULL; END IF;
  RETURN pgp_sym_encrypt(p_valeur, p_cle);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fonction helper pour déchiffrer
CREATE OR REPLACE FUNCTION dechiffrer_medical(p_chiffre BYTEA, p_cle TEXT)
RETURNS TEXT AS $$
BEGIN
  IF p_chiffre IS NULL THEN RETURN NULL; END IF;
  BEGIN
    RETURN pgp_sym_decrypt(p_chiffre, p_cle);
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL; -- Clé incorrecte ou données corrompues
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Index pour filtrer les élèves non migrés
CREATE INDEX IF NOT EXISTS idx_eleves_migration_medicale
  ON eleves(donnees_medicales_migrees)
  WHERE donnees_medicales_migrees = FALSE;

DO $$
BEGIN
  RAISE NOTICE 'Migration 012 terminée — colonnes chiffrées ajoutées à la table eleves';
  RAISE NOTICE 'IMPORTANT : Exécuter le script de migration des données existantes';
  RAISE NOTICE 'Configurer MEDICAL_ENCRYPTION_KEY dans .env avant de lancer la migration';
END;
$$;
