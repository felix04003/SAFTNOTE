-- ============================================================
-- MIGRATION 011 — presences.statut : ajouter 'non_saisi'
--
-- POST /appels pré-remplit une ligne 'presences' par élève inscrit
-- avec statut='non_saisi' (appels.routes.js:70) pour que l'appel
-- démarre avec tous les élèves visibles avant saisie. Idem côté
-- lecture (GET /appels/cours:138) et côté mobile (Badge.tsx,
-- LABEL_PRESENCE/VARIANT_PRESENCE — 'non_saisi' est un statut de
-- premier ordre, affiché "—").
--
-- Mais la contrainte CHECK d'origine n'autorisait que les statuts
-- qu'un enseignant peut choisir explicitement (present/absent/
-- retard/sorti_avant/dispense) — 'non_saisi' en était absent.
-- Conséquence : CHAQUE appel `POST /appels` violait la contrainte
-- et échouait avec "CONTRAINTE_BD", pour tout établissement.
-- ============================================================

ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;

ALTER TABLE presences ADD CONSTRAINT presences_statut_check
  CHECK (statut::text = ANY (ARRAY[
    'non_saisi', 'present', 'absent', 'retard', 'sorti_avant', 'dispense'
  ]::text[]));

-- Même bug, même cause, table voisine : appels.routes.js:60 crée l'appel
-- avec statut='ouvert' (état intermédiaire "en cours de saisie", vérifié
-- explicitement ligne 176 pour autoriser la clôture, et repris en fallback
-- offline côté mobile appel.tsx:67) — mais appels_statut_check n'autorisait
-- que les états terminaux (effectue/cours_annule/non_effectue). Conséquence
-- directe : POST /appels échouait à la toute première ligne insérée, avant
-- même d'atteindre le pré-remplissage des présences.
ALTER TABLE appels DROP CONSTRAINT IF EXISTS appels_statut_check;

ALTER TABLE appels ADD CONSTRAINT appels_statut_check
  CHECK (statut::text = ANY (ARRAY[
    'ouvert', 'effectue', 'cours_annule', 'non_effectue'
  ]::text[]));
