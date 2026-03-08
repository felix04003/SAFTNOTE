-- ============================================================
-- MIGRATION 000 — Extensions PostgreSQL
-- Ordre d'exécution : 1er (avant toutes les autres migrations)
-- ============================================================

-- UUID natifs PostgreSQL (gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Recherche plein texte non-ASCII (accents, langues africaines)
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- Statistiques avancées pour le query planner
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Vérification
DO $$
BEGIN
  RAISE NOTICE 'Extensions installées : pgcrypto, unaccent, pg_stat_statements';
END;
$$;
