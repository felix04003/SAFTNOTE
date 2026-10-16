-- ============================================================
-- MIGRATION 026 — Plages horaires par défaut pour chaque établissement
--
-- Constat (parcours mobile) : plages_horaires n'était alimentée que par les
-- seeds de test. Un établissement créé par POST /inscription n'avait AUCUNE
-- plage et aucune route ne permettait d'en créer : impossible de construire
-- un emploi du temps, donc de faire l'appel.
--
-- Même principe que la migration 021 : un trigger crée les plages à
-- l'insertion de tout établissement (modifiables ensuite par les routes
-- POST/PUT/DELETE /plages-horaires) + rattrapage des établissements sans plage.
-- Idempotent : ON CONFLICT DO NOTHING.
-- ============================================================

CREATE OR REPLACE FUNCTION creer_plages_horaires_defaut(p_etablissement_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO plages_horaires (etablissement_id, numero, libelle, heure_debut, heure_fin, est_pause)
    VALUES
        (p_etablissement_id, 1, '1ère heure',     '07:30', '08:30', FALSE),
        (p_etablissement_id, 2, '2ème heure',     '08:30', '09:30', FALSE),
        (p_etablissement_id, 3, 'Récréation',     '09:30', '09:45', TRUE),
        (p_etablissement_id, 4, '3ème heure',     '09:45', '10:45', FALSE),
        (p_etablissement_id, 5, '4ème heure',     '10:45', '11:45', FALSE),
        (p_etablissement_id, 6, 'Pause déjeuner', '11:45', '15:00', TRUE),
        (p_etablissement_id, 7, '5ème heure',     '15:00', '16:00', FALSE),
        (p_etablissement_id, 8, '6ème heure',     '16:00', '17:00', FALSE)
    ON CONFLICT (etablissement_id, numero) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_creer_plages_horaires_defaut()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM creer_plages_horaires_defaut(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_etablissement_plages_horaires ON etablissements;
CREATE TRIGGER trg_etablissement_plages_horaires
    AFTER INSERT ON etablissements
    FOR EACH ROW
    EXECUTE FUNCTION trg_creer_plages_horaires_defaut();

-- Rattrapage : seulement les établissements qui n'ont aucune plage
SELECT creer_plages_horaires_defaut(e.id)
  FROM etablissements e
 WHERE NOT EXISTS (SELECT 1 FROM plages_horaires p WHERE p.etablissement_id = e.id);
