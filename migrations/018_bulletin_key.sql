-- ============================================================
-- MIGRATION 018 — Colonne bulletin_key (finding audit 2026-09, C2)
--
-- Finding : backend/src/infrastructure/storage/storage.service.js
-- ne stockait jamais la CLÉ S3 du bulletin, mais une URL publique
-- reconstruite à la main (`${S3_ENDPOINT}/${bucket}/${key}`), non
-- signée, potentiellement accessible sans authentification selon la
-- politique du bucket. La route GET /bulletins/:id/download
-- renvoyait cette URL telle quelle avec un champ `expire_dans: '1h'`
-- trompeur (aucune signature n'était réellement appliquée).
--
-- Correctif applicatif (lot D) : stocker désormais la CLÉ S3 (pas
-- une URL) dans une nouvelle colonne `bulletin_key`, et générer une
-- URL signée à la demande via getUrlSignee() (déjà implémentée mais
-- jamais appelée avant ce lot).
--
-- Cette migration :
--   1. Ajoute la colonne bulletin_key (nullable — un bulletin peut
--      ne pas encore avoir de PDF généré).
--   2. Tente de convertir les valeurs existantes de bulletin_url en
--      clé, avec une heuristique EXPLICITEMENT IMPARFAITE (voir
--      commentaire ci-dessous) — en conservant bulletin_key = NULL
--      dans tous les cas où la conversion n'est pas fiable à 100 %.
--
-- Elle NE SUPPRIME PAS bulletin_url : les deux colonnes cohabitent
-- pour cette itération, afin de rester réversible et de ne pas
-- casser un déploiement en cours de bascule (workers / API pas
-- encore tous sur la nouvelle version). Le nettoyage de
-- bulletin_url (colonne devenue obsolète) est une dette à traiter
-- dans une migration future, une fois la bascule confirmée stable
-- en production.
-- ============================================================

-- 1. Nouvelle colonne (idempotent)
ALTER TABLE moyennes_generales
  ADD COLUMN IF NOT EXISTS bulletin_key TEXT;

COMMENT ON COLUMN moyennes_generales.bulletin_key IS
  'Clé S3/R2 du PDF (ex: bulletins/<etablissement_id>/<periode_id>/<id>.pdf). '
  'Remplace bulletin_url comme source de vérité — une URL signée est générée '
  'à la demande via storage.service.getUrlSignee(). bulletin_url est conservée '
  'en parallèle pour compatibilité descendante le temps de la bascule.';

-- 2. Conversion best-effort des données existantes
--
-- HEURISTIQUE ET LIMITES (à lire avant tout déploiement en prod) :
--   - Le format produit par le worker était :
--       `${S3_ENDPOINT}/${S3_BUCKET}/bulletins/<etablissement_id>/<periode_id>/<id>.pdf`
--     La clé attendue est la partie après le nom du bucket, c'est-à-dire
--     tout ce qui suit le PREMIER segment '/bulletins/' dans l'URL.
--   - Cette migration SQL n'a PAS accès à la valeur de S3_ENDPOINT ni de
--     S3_BUCKET (variables d'environnement, jamais en base). Elle ne peut
--     donc PAS valider que le préfixe correspond réellement à l'endpoint/
--     bucket configurés au moment de l'upload — il est théoriquement
--     possible qu'un bucket ait changé de nom entre-temps, ou qu'une valeur
--     ait été insérée manuellement avec un format différent.
--   - On extrait la clé uniquement quand le motif est sans ambiguïté :
--       bulletin_url ~ '/bulletins/[^/]+/[^/]+/[0-9a-f-]{36}\.pdf$'
--     (segment 'bulletins/<uuid_etablissement>/<uuid_periode>/<uuid>.pdf'
--     en toute fin de chaîne). La clé extraite est tout ce qui suit le
--     dernier '/bulletins/' littéral ne faisant pas partie d'un nom de
--     fichier, reconstruite explicitement comme
--       'bulletins/' || (sous-chaîne après le motif)
--     via une expression régulière de capture.
--   - Toute valeur qui commence par 'pending:' (échec d'upload historique)
--     ou qui ne correspond pas exactement à ce motif est laissée à
--     bulletin_key = NULL : mieux vaut regénérer le bulletin que stocker
--     une clé potentiellement incorrecte qui échouerait silencieusement
--     lors de la signature (getUrlSignee renverrait une URL signée pointant
--     vers un objet inexistant).
--   - RECOMMANDATION : après déploiement, comparer
--       SELECT count(*) FROM moyennes_generales WHERE bulletin_url IS NOT NULL AND bulletin_key IS NULL;
--     Ces lignes correspondent à des bulletins dont la clé n'a pas pu être
--     déduite avec certitude (ou qui étaient déjà en échec) — ils devront
--     être régénérés (relancer POST /bulletins/generer sur la classe/période
--     concernée) plutôt que d'être considérés comme perdus.

UPDATE moyennes_generales
SET bulletin_key = regexp_replace(
  bulletin_url,
  '^.*/(bulletins/[^/]+/[^/]+/[0-9a-fA-F-]{36}\.pdf)$',
  '\1'
)
WHERE bulletin_key IS NULL
  AND bulletin_url IS NOT NULL
  AND bulletin_url !~ '^pending:'
  AND bulletin_url ~ '/bulletins/[^/]+/[^/]+/[0-9a-fA-F-]{36}\.pdf$';

-- Toute autre valeur (pending:*, format inattendu, NULL) reste NULL par
-- défaut — pas d'action nécessaire, la colonne est déjà nullable.
