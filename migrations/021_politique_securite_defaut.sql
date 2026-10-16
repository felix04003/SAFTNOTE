-- ============================================================
-- MIGRATION 021 — Politique de sécurité par défaut pour chaque établissement
--
-- Constat : politique_securite n'était alimentée que par les seeds
-- (006, tests/seeds). Un établissement créé par POST /inscription ou
-- POST /setup n'en avait AUCUNE ligne : le réglage par établissement
-- (longueur minimale du mot de passe, sessions simultanées…) ne pouvait
-- donc rien changer pour lui, et les lectures « WHERE etablissement_id »
-- ne trouvaient rien (le code retombait sur les valeurs par défaut).
--
-- Correctif à la source plutôt que dans chaque route de création : un
-- trigger crée la ligne (valeurs par défaut de la table) à l'insertion de
-- tout établissement — inscription, setup, seeds, futurs parcours.
--
-- Idempotent : ON CONFLICT DO NOTHING, rejouable sans effet.
-- ============================================================

CREATE OR REPLACE FUNCTION creer_politique_securite_defaut()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO politique_securite (etablissement_id)
    VALUES (NEW.id)
    ON CONFLICT (etablissement_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_etablissement_politique_securite ON etablissements;
CREATE TRIGGER trg_etablissement_politique_securite
    AFTER INSERT ON etablissements
    FOR EACH ROW
    EXECUTE FUNCTION creer_politique_securite_defaut();

-- Rattrapage des établissements existants qui n'ont pas de politique
INSERT INTO politique_securite (etablissement_id)
SELECT e.id
  FROM etablissements e
 WHERE NOT EXISTS (
        SELECT 1 FROM politique_securite p WHERE p.etablissement_id = e.id
 )
ON CONFLICT (etablissement_id) DO NOTHING;
