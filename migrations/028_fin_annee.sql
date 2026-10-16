-- 028 — Fin d'année et réinscription
--
-- annees_scolaires.cloturee_at : date de clôture (passage à l'année suivante). Une année clôturée n'est plus
--   jamais modifiée par le passage d'année ; elle reste consultable (notes, bulletins, historique).
-- inscriptions.decision_fin_annee : ce qui a été décidé pour l'élève à la fin de CETTE année
--   (admis = passe au niveau suivant, redouble, ou sortie : diplome / transfere / abandonne / exclu).
--   Les inscriptions d'une année ne sont jamais supprimées ni déplacées : une NOUVELLE inscription est créée
--   dans l'année suivante (UNIQUE (eleve_id, annee_scolaire_id)).

ALTER TABLE annees_scolaires
    ADD COLUMN IF NOT EXISTS cloturee_at TIMESTAMPTZ;

ALTER TABLE inscriptions
    ADD COLUMN IF NOT EXISTS decision_fin_annee VARCHAR(20);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'inscriptions_decision_fin_annee_check'
    ) THEN
        ALTER TABLE inscriptions
            ADD CONSTRAINT inscriptions_decision_fin_annee_check
            CHECK (decision_fin_annee IS NULL
                   OR decision_fin_annee IN ('admis', 'redouble', 'diplome', 'transfere', 'abandonne', 'exclu'));
    END IF;
END $$;

COMMENT ON COLUMN annees_scolaires.cloturee_at IS 'Date de clôture par le passage d''année (NULL = année non clôturée).';
COMMENT ON COLUMN inscriptions.decision_fin_annee IS 'Décision de fin d''année : admis, redouble, diplome, transfere, abandonne, exclu.';
