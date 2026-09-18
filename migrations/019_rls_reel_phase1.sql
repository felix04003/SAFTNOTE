-- ============================================================
-- MIGRATION 019 — RLS réel, phase 1 pilote (rôle dédié + 2 tables)
--
-- Contexte : la migration 010 avait retiré à la source un premier
-- essai de Row-Level Security qui n'avait jamais fonctionné (8 tables
-- ciblées, dont seules utilisateurs/sessions/journal_audit possèdent
-- une colonne etablissement_id directe ; "bulletins" n'existe même
-- pas en tant que table). Depuis, la protection multi-établissement
-- repose entièrement sur le filtrage applicatif (isolerEtablissement,
-- autoriserAccesEleve, gardes de sync.routes.js) — efficace mais avec
-- aucune défense en profondeur au niveau base de données : un bug
-- applicatif (WHERE etablissement_id oublié) fuiterait silencieusement
-- des données inter-établissements.
--
-- Cette migration met en place un VRAI RLS, mais volontairement
-- restreint à 2 tables et déployé EN PARALLÈLE de l'existant (aucune
-- route actuelle n'est cassée : le rôle admin actuel reste propriétaire
-- des tables et continue de tout voir, comme avant). Une seule route
-- (GET /configs/matieres) est convertie pour consommer ce nouveau
-- chemin, dans un commit séparé du code applicatif.
--
-- ── Choix des tables pilotes ─────────────────────────────────────
-- Les tables au cœur des corrections IDOR de la campagne d'audit
-- 2026-09 (lots B à E : eleves, notes, absences, moyennes, bulletins)
-- n'ont AUCUNE colonne etablissement_id directe :
--   - eleves        → etablissement_id seulement via utilisateurs
--   - notes          → via eleves → utilisateurs (2 sauts)
--   - inscriptions   → via classes → annees_scolaires
--   - moyennes_generales / moyennes_matieres → via inscriptions
-- Vérifié par :
--   grep -n "CREATE TABLE eleves\|CREATE TABLE notes" migrations/*.sql
-- Une policy RLS par simple égalité de colonne (le pattern le plus sûr
-- et le plus lisible pour un pilote) est donc impossible sur ces
-- tables sans réécrire les policies en sous-requêtes de jointure —
-- exactement le type de complexité qui avait fait échouer l'essai de
-- la migration 010.
--
-- On choisit à la place deux tables du domaine pédagogique (003) qui
-- ONT une colonne etablissement_id directe ET sont au cœur du calcul
-- des moyennes/bulletins (donc adjacentes aux findings IDOR C/D sur
-- /moyennes/eleve et /bulletins, sans toucher aux tables déjà
-- fragiles listées ci-dessus) :
--   - matieres             (migrations/003_domaine3_pedagogie.sql:158)
--   - disciplines_matieres (migrations/003_domaine3_pedagogie.sql:140)
-- Toutes deux : etablissement_id UUID NOT NULL REFERENCES etablissements(id),
-- clé primaire en gen_random_uuid() (aucune séquence à GRANMER).
-- Route pilote convertie : GET /configs/matieres
-- (backend/src/domains/03-pedagogie/configs/configs.routes.js), route
-- de lecture simple, déjà couverte par
-- backend/tests/domains/configs.routes.test.js.
--
-- ── Rôle applicatif dédié ────────────────────────────────────────
-- ecole_app_rls : rôle LOGIN, NON PROPRIÉTAIRE des tables (PostgreSQL
-- ignore totalement le RLS pour le propriétaire d'une table — c'est
-- pourquoi le rôle admin actuel, propriétaire, doit rester intact et
-- ne reçoit aucune policy). Droits accordés explicitement par GRANT,
-- aucun droit DDL, aucun droit sur les autres tables du schéma.
--
-- Mot de passe : JAMAIS en dur dans ce fichier committé — même pas un
-- placeholder (revue lot I, MEDIUM : un mot de passe "temporaire"
-- fonctionnel connu de quiconque a accès au dépôt reste un mot de passe
-- exploitable si l'étape manuelle ci-dessous est oubliée). Le rôle est
-- créé SANS clause PASSWORD : rolpassword reste NULL, l'authentification
-- par mot de passe échoue pour ce rôle tant qu'aucun secret réel n'a été
-- positionné, séparément, jamais via un fichier versionné :
--
--   ALTER ROLE ecole_app_rls WITH PASSWORD '<secret réel généré>';
--
-- (générer par ex. avec :
--   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
-- puis stocker le résultat dans les variables d'environnement
-- POSTGRES_RLS_PASSWORD / DATABASE_URL_RLS — voir backend/.env.example
-- et backend/src/infrastructure/database/pool.js — jamais commit.)
--
-- ── Comportement en absence de contexte (app.etablissement_id) ───
-- Décision retenue : ERREUR EXPLICITE, pas 0 ligne silencieuse.
--
-- Policy écrite comme :
--   USING (etablissement_id = current_setting('app.etablissement_id')::UUID)
-- SANS le deuxième argument `missing_ok` de current_setting (donc
-- missing_ok = FALSE, comportement par défaut). Raisonnement :
--   - Si le paramètre custom "app.etablissement_id" n'a JAMAIS été
--     défini sur la connexion (cas d'un bug applicatif qui utiliserait
--     getDBRls() sans passer par avecContexteEtablissement()),
--     current_setting() sans missing_ok lève une erreur PostgreSQL
--     explicite : "unrecognized configuration parameter
--     app.etablissement_id". La requête échoue bruyamment (500 côté
--     API, log d'erreur) au lieu de renvoyer silencieusement 0 ligne.
--   - Si le paramètre a déjà été défini une fois sur cette connexion
--     réutilisée par le pool (SET LOCAL d'une transaction précédente,
--     revenu à sa valeur par défaut après COMMIT/ROLLBACK), Postgres
--     ne lève plus "unrecognized" mais renvoie une chaîne vide ''.
--     Dans ce cas, ''::UUID lève une erreur explicite différente :
--     "invalid input syntax for type uuid". Toujours une erreur, jamais
--     un NULL silencieux.
--   - L'alternative NULLIF(current_setting('app.etablissement_id', TRUE), '')::UUID
--     a été examinée et écartée pour ce pilote : elle transforme le
--     cas manquant en NULL, donc etablissement_id = NULL est UNKNOWN
--     (traité comme FALSE) → 0 ligne renvoyée SANS AUCUNE ERREUR.
--     C'est exactement le piège central documenté pour cette phase :
--     une route qui oublierait de poser le contexte ne planterait pas,
--     elle verrait juste 0 ligne, sans log. Pour un pilote en
--     développement/tests dont le but est justement de vérifier que
--     l'infrastructure RLS est correctement câblée, une erreur bruyante
--     et immédiate est préférable à un silence qui masquerait un bug.
--   - Le comportement réel (message d'erreur exact observé) est
--     vérifié empiriquement par un script ad-hoc lors de cette
--     campagne (non committé) et documenté dans le rapport de
--     vérification associé à cette migration.
--
-- WITH CHECK (même expression) empêche également ecole_app_rls
-- d'INSERT/UPDATE une ligne pour un autre établissement que celui du
-- contexte courant.
--
-- ENABLE ROW LEVEL SECURITY (pas FORCE) : ecole_app_rls n'étant pas
-- propriétaire, FORCE n'est pas nécessaire (FORCE ne sert qu'à
-- appliquer le RLS AU PROPRIÉTAIRE lui-même, ce qui n'est pas notre
-- cas ici et casserait potentiellement des opérations de maintenance
-- futures faites par l'admin).
--
-- Idempotente : DO $$ ... $$ pour la création du rôle, GRANT/ALTER
-- rejouables sans erreur, DROP POLICY IF EXISTS avant chaque
-- CREATE POLICY.
-- ============================================================

-- ── 1. Rôle applicatif dédié, non propriétaire, LOGIN ─────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecole_app_rls') THEN
        -- Aucun mot de passe, même placeholder (voir commentaire d'en-tête,
        -- revue lot I MEDIUM) : rolpassword reste NULL tant que la commande
        -- séparée ci-dessous n'a pas été exécutée avec un vrai secret :
        --   ALTER ROLE ecole_app_rls WITH PASSWORD '<secret réel>';
        CREATE ROLE ecole_app_rls LOGIN;
    END IF;
END $$;

-- ── 2. Droits explicites, aucun DDL, uniquement les 2 tables pilotes ──
GRANT SELECT, INSERT, UPDATE, DELETE ON matieres             TO ecole_app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON disciplines_matieres TO ecole_app_rls;
-- Pas de GRANT USAGE sur séquence : les deux tables utilisent
-- gen_random_uuid() comme DEFAULT de clé primaire, aucune colonne
-- serial/bigserial.

-- ── 3. Activation du RLS (ecole_app_rls seulement, pas le propriétaire) ──
ALTER TABLE matieres             ENABLE ROW LEVEL SECURITY;
ALTER TABLE disciplines_matieres ENABLE ROW LEVEL SECURITY;

-- ── 4. Policies sans échappatoire ─────────────────────────────────
DROP POLICY IF EXISTS isolement_reel_matieres ON matieres;
CREATE POLICY isolement_reel_matieres ON matieres
    USING      (etablissement_id = current_setting('app.etablissement_id')::UUID)
    WITH CHECK (etablissement_id = current_setting('app.etablissement_id')::UUID);

DROP POLICY IF EXISTS isolement_reel_disciplines_matieres ON disciplines_matieres;
CREATE POLICY isolement_reel_disciplines_matieres ON disciplines_matieres
    USING      (etablissement_id = current_setting('app.etablissement_id')::UUID)
    WITH CHECK (etablissement_id = current_setting('app.etablissement_id')::UUID);

COMMENT ON POLICY isolement_reel_matieres ON matieres IS
    'Phase 1 pilote RLS (migration 019). Isolation stricte par etablissement_id, '
    'sans NULLIF/missing_ok : app.etablissement_id absent ou vide => erreur '
    'explicite Postgres, jamais 0 ligne silencieuse. Ne s''applique qu''au rôle '
    'ecole_app_rls (non propriétaire) — le rôle admin existant continue de tout voir.';

COMMENT ON POLICY isolement_reel_disciplines_matieres ON disciplines_matieres IS
    'Phase 1 pilote RLS (migration 019). Voir COMMENT ON POLICY isolement_reel_matieres.';
