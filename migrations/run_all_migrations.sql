-- ============================================================
-- RUN_ALL_MIGRATIONS.sql
-- Projet : Gestion Scolaire Afrique de l'Ouest (Francophone)
-- Version : 1.0
-- Usage   :
--   psql -U ecole_user -d ecole_manager -f run_all_migrations.sql
--   (depuis le dossier qui contient le dossier migrations/)
-- ============================================================

\set ON_ERROR_STOP on
\set VERBOSITY verbose

BEGIN;

-- ── Vérification PostgreSQL 14+ ───────────────────────────────
DO $$
BEGIN
  IF current_setting('server_version_num')::INTEGER < 140000 THEN
    RAISE EXCEPTION 'PostgreSQL 14+ requis. Version : %', current_setting('server_version');
  END IF;
  RAISE NOTICE '✓ PostgreSQL %', current_setting('server_version');
END;
$$;

-- ── Table de suivi ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      VARCHAR(10)  NOT NULL PRIMARY KEY,
    nom          VARCHAR(200) NOT NULL,
    appliquee_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ── Migrations ───────────────────────────────────────────────
\echo '== 000 Extensions'
\i migrations/000_extensions.sql
INSERT INTO schema_migrations VALUES ('000', 'Extensions PostgreSQL') ON CONFLICT DO NOTHING;

\echo '== 001 Identités'
\i migrations/001_domaine1_identites.sql
INSERT INTO schema_migrations VALUES ('001', 'Domaine 1 : Identités') ON CONFLICT DO NOTHING;

\echo '== 002 Acteurs'
\i migrations/002_domaine2_acteurs.sql
INSERT INTO schema_migrations VALUES ('002', 'Domaine 2 : Acteurs') ON CONFLICT DO NOTHING;

\echo '== 003 Pédagogie'
\i migrations/003_domaine3_pedagogie.sql
INSERT INTO schema_migrations VALUES ('003', 'Domaine 3 : Pédagogie') ON CONFLICT DO NOTHING;

\echo '== 004 Vie scolaire'
\i migrations/004_domaine4_vie_scolaire.sql
INSERT INTO schema_migrations VALUES ('004', 'Domaine 4 : Vie Scolaire') ON CONFLICT DO NOTHING;

\echo '== 005 Sécurité'
\i migrations/005_domaine5_securite.sql
INSERT INTO schema_migrations VALUES ('005', 'Domaine 5 : Sécurité') ON CONFLICT DO NOTHING;

\echo '== 006 Données de référence'
\i migrations/006_donnees_reference.sql
INSERT INTO schema_migrations VALUES ('006', 'Données de référence') ON CONFLICT DO NOTHING;

\echo '== 007 Vues & Fonctions'
\i migrations/007_vues_et_fonctions.sql
INSERT INTO schema_migrations VALUES ('007', 'Vues & Fonctions') ON CONFLICT DO NOTHING;

\echo '== 008 Index performance'
\i migrations/008_index_performance.sql
INSERT INTO schema_migrations VALUES ('008', 'Index de performance') ON CONFLICT DO NOTHING;

\echo '== 009 Fix statut checks'
\i migrations/009_fix_statut_checks.sql
INSERT INTO schema_migrations VALUES ('009', 'Fix statut checks') ON CONFLICT DO NOTHING;

\echo '== 010 Messagerie interne'
\i migrations/010_messagerie.sql
INSERT INTO schema_migrations VALUES ('010', 'Messagerie interne') ON CONFLICT DO NOTHING;

-- ── Rapport ──────────────────────────────────────────────────
DO $$
DECLARE nb_tables INT; nb_fonctions INT; nb_triggers INT; nb_vues INT;
BEGIN
  SELECT COUNT(*) INTO nb_tables    FROM information_schema.tables    WHERE table_schema='public' AND table_type='BASE TABLE';
  SELECT COUNT(*) INTO nb_fonctions FROM information_schema.routines  WHERE routine_schema='public';
  SELECT COUNT(*) INTO nb_triggers  FROM information_schema.triggers  WHERE trigger_schema='public';
  SELECT COUNT(*) INTO nb_vues      FROM information_schema.views     WHERE table_schema='public';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '  Tables      : %', nb_tables;
  RAISE NOTICE '  Vues        : %', nb_vues;
  RAISE NOTICE '  Fonctions   : %', nb_fonctions;
  RAISE NOTICE '  Triggers    : %', nb_triggers;
  RAISE NOTICE '  ✓ Schéma complet opérationnel';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END;
$$;

COMMIT;

SELECT version, nom, appliquee_at::date FROM schema_migrations ORDER BY version;
