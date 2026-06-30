-- ============================================================
-- MIGRATION 011 — RGPD : table consentements
-- ============================================================

CREATE TABLE IF NOT EXISTS consentements (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id  UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL
                        CHECK (type IN (
                            'notifications_sms',
                            'notifications_whatsapp',
                            'partage_donnees',
                            'analytics'
                        )),
    accorde         BOOLEAN     NOT NULL DEFAULT FALSE,
    ip_address      INET,                   -- IP au moment du consentement
    user_agent      TEXT,                   -- Navigateur au moment du consentement
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (utilisateur_id, type)
);

CREATE INDEX idx_consentements_utilisateur ON consentements(utilisateur_id);

COMMENT ON TABLE consentements IS 'Traçabilité des consentements RGPD par utilisateur. Conforme loi sénégalaise 2008-12 et loi ivoirienne 2013-450.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 011 terminée — table consentements créée';
END;
$$;
