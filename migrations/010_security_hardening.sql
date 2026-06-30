-- ============================================================
-- MIGRATION 010 — Sécurité : refresh tokens + RLS policies
-- ============================================================

-- ── 1. Colonne refresh_expire_at sur sessions ───────────────
-- La colonne refresh_token_hash existait déjà (005).
-- On ajoute l'expiration du refresh token.
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS refresh_expire_at TIMESTAMPTZ;

-- Mettre à jour les sessions existantes pour qu'elles aient une expiration cohérente
UPDATE sessions
SET refresh_expire_at = created_at + INTERVAL '7 days'
WHERE refresh_expire_at IS NULL
  AND refresh_token_hash IS NOT NULL;

-- ── 2. Index pour les recherches de refresh token ───────────
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token
    ON sessions(refresh_token_hash)
    WHERE refresh_token_hash IS NOT NULL AND revoquee = FALSE;

-- ── 3. RLS — Row-Level Security sur les tables critiques ────
-- Filet de sécurité supplémentaire : même si le middleware applicatif
-- oublie de filtrer par etablissement_id, PostgreSQL bloque l'accès.

-- Activer RLS sur les tables à données multi-tenant
ALTER TABLE utilisateurs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE eleves                ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bulletins             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_audit         ENABLE ROW LEVEL SECURITY;

-- Politique : le backend pose app.etablissement_id via SET LOCAL
-- Les requêtes sans ce paramètre voient TOUTES les données (bypass pour migrations/superuser)
-- Les requêtes avec ce paramètre ne voient que leur établissement

CREATE POLICY isolement_etablissement_utilisateurs ON utilisateurs
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_eleves ON eleves
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_inscriptions ON inscriptions
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_notes ON notes
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_evaluations ON evaluations
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_bulletins ON bulletins
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_sessions ON sessions
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

CREATE POLICY isolement_etablissement_audit ON journal_audit
    USING (
        etablissement_id = NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
        OR current_setting('app.etablissement_id', TRUE) IS NULL
        OR current_setting('app.etablissement_id', TRUE) = ''
    );

-- ── 4. Purge cron automatique ────────────────────────────────
-- Extension pg_cron (si disponible) pour purge quotidienne.
-- Si pg_cron n'est pas installé, ignorer silencieusement.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'purge-sessions-expirees',
            '0 3 * * *',  -- Chaque nuit à 3h
            'SELECT purger_sessions_expirees()'
        );
        PERFORM cron.schedule(
            'purge-otp-expires',
            '15 3 * * *',  -- Chaque nuit à 3h15
            'SELECT purger_otp_expires()'
        );
        RAISE NOTICE 'Cron jobs de purge configurés';
    ELSE
        RAISE NOTICE 'pg_cron non installé — purge manuelle via job applicatif';
    END IF;
END;
$$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 010 terminée — refresh_expire_at, RLS policies, cron purge';
END;
$$;
