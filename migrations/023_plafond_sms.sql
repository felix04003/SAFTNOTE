-- ============================================================
-- MIGRATION 023 — Plafond mensuel de SMS par établissement
--
-- Chaque SMS est facturé (jusqu'à 3 segments). Sans garde-fou, un bug ou un
-- usage massif (publication des notes de 600 élèves) peut faire exploser la
-- facture d'un établissement.
--
--   politique_securite.sms_plafond_mensuel : segments SMS de notification par
--       mois civil (UTC = Africa/Dakar, Africa/Abidjan). 0 = illimité.
--   politique_securite.sms_alerte_mois / sms_alerte_palier : dernier palier
--       (80 ou 100 %) pour lequel le directeur a été prévenu, pour ne
--       l'avertir qu'UNE fois par palier et par mois.
--   journal_notifications.segments : segments réellement facturés pour ce message.
--
-- Règles appliquées par le worker de notifications :
--   * < plafond           : tout part
--   * >= plafond          : les notifications non urgentes (notes, bulletins)
--                           ne partent plus ; les urgentes (absence, retard,
--                           sanction, convocation) continuent
--   * >= 150 % du plafond : plus aucune notification SMS (butoir)
--   Les codes de connexion (OTP) et mots de passe provisoires ne sont jamais
--   bloqués : ils ne passent pas par ce contrôle.
--
-- Valeur par défaut 3000 : hypothèse (≈ 500 élèves, 1 segment par message) à
-- ajuster après un mois de pilote.
-- ============================================================

ALTER TABLE politique_securite
    ADD COLUMN IF NOT EXISTS sms_plafond_mensuel INTEGER  NOT NULL DEFAULT 3000
        CHECK (sms_plafond_mensuel >= 0),
    ADD COLUMN IF NOT EXISTS sms_alerte_mois     CHAR(7),
    ADD COLUMN IF NOT EXISTS sms_alerte_palier   SMALLINT NOT NULL DEFAULT 0
        CHECK (sms_alerte_palier IN (0, 80, 100));

COMMENT ON COLUMN politique_securite.sms_plafond_mensuel IS
    'Segments SMS de notification par mois civil et par établissement. 0 = illimité.';

ALTER TABLE journal_notifications
    ADD COLUMN IF NOT EXISTS segments SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN journal_notifications.segments IS
    'Segments SMS facturés pour ce message (1 pour un message GSM-7 de 160 caractères au plus).';

-- Somme mensuelle par établissement (SMS effectivement envoyés)
CREATE INDEX IF NOT EXISTS idx_notif_sms_mois
    ON journal_notifications (etablissement_id, envoye_at)
    WHERE canal = 'sms' AND statut IN ('envoye', 'livre');
