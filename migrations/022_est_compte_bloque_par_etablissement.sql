-- ============================================================
-- MIGRATION 022 — Blocage de connexion : politique de l'établissement
--
-- Constat : est_compte_bloque(identifiant, ip) lisait
--   MAX(blocage_nb_tentatives), MAX(blocage_duree_minutes)
-- sur TOUTES les lignes de politique_securite, tous établissements
-- confondus. Un établissement qui assouplirait sa politique (ex. 50
-- tentatives) aurait assoupli le blocage de tous les autres.
--
-- Correctif : nouvelle surcharge est_compte_bloque(identifiant, ip,
-- etablissement_id) qui lit la politique de CET établissement. Sans
-- établissement connu, ou sans ligne de politique : valeurs par défaut
-- strictes (5 tentatives / 15 minutes) — jamais le plus laxiste des autres.
--
-- L'ancienne signature à 2 arguments est conservée (un déploiement en cours
-- de bascule peut encore l'appeler) et délègue avec NULL : elle devient
-- elle aussi stricte au lieu de dépendre de la politique d'un autre
-- établissement.
--
-- Le comptage des échecs reste par identifiant OU par IP (inchangé).
-- ============================================================

CREATE OR REPLACE FUNCTION est_compte_bloque(
    p_identifiant       VARCHAR,
    p_ip                INET,
    p_etablissement_id  UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_nb_max        INTEGER := 5;
    v_duree_min     INTEGER := 15;
    v_nb_echecs     INTEGER;
BEGIN
    IF p_etablissement_id IS NOT NULL THEN
        SELECT ps.blocage_nb_tentatives, ps.blocage_duree_minutes
          INTO v_nb_max, v_duree_min
          FROM politique_securite ps
         WHERE ps.etablissement_id = p_etablissement_id;

        -- Pas de ligne pour cet établissement : SELECT INTO a mis NULL
        v_nb_max    := COALESCE(v_nb_max, 5);
        v_duree_min := COALESCE(v_duree_min, 15);
    END IF;

    SELECT COUNT(*) INTO v_nb_echecs
      FROM tentatives_connexion
     WHERE (identifiant = p_identifiant OR ip_address = p_ip)
       AND succes = FALSE
       AND tentee_at > now() - (v_duree_min || ' minutes')::INTERVAL;

    RETURN v_nb_echecs >= v_nb_max;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION est_compte_bloque(
    p_identifiant   VARCHAR,
    p_ip            INET
) RETURNS BOOLEAN AS $$
    SELECT est_compte_bloque(p_identifiant, p_ip, NULL::UUID);
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION est_compte_bloque(VARCHAR, INET, UUID) IS
    'Blocage force brute selon la politique_securite de l''établissement ; défauts 5 tentatives / 15 min sinon.';
