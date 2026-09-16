-- ============================================================
-- MIGRATION 010 — Sécurité : refresh tokens + purge cron
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

-- ── 3. RLS retiré ────────────────────────────────────────────
-- Un premier essai de Row-Level Security a été écrit ici mais n'a
-- jamais fonctionné : sur les 8 tables ciblées (utilisateurs, eleves,
-- inscriptions, notes, evaluations, bulletins, sessions, journal_audit),
-- seules utilisateurs/sessions/journal_audit possèdent une colonne
-- etablissement_id directe ; les autres (et "bulletins", qui n'existe
-- pas — voir moyennes_generales) auraient fait échouer cette migration
-- dès la première application sur une base neuve. Retiré à la source.
-- Un vrai RLS (rôle applicatif dédié, policies par jointure ou colonne
-- dénormalisée, SET LOCAL par transaction) est à concevoir séparément ;
-- voir docs/architecture/database.md.

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
  RAISE NOTICE 'Migration 010 terminée — refresh_expire_at, cron purge';
END;
$$;
