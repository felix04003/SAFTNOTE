-- ============================================================
-- MIGRATION 014 — discipline.voir / discipline.prononcer
-- manquantes pour le rôle enseignant
--
-- Le dashboard enseignant (dashboard/enseignant.html + js/pages/
-- ens-discipline.js) expose un onglet "Discipline" complet :
-- liste des sanctions de ses classes (GET /discipline/sanctions)
-- et un modal "Signaler une sanction" (POST /discipline/sanctions)
-- limité aux types mineurs — le select HTML exclut délibérément
-- 'exclusion_definitive', réservée au directeur/censeur.
--
-- Backend : GET /discipline/sanctions exige 'discipline.voir',
-- POST /discipline/sanctions exige 'discipline.prononcer'.
-- Ni l'une ni l'autre n'était accordée au rôle 'enseignant' —
-- seulement à admin/censeur/directeur/super_admin. Résultat :
-- l'onglet Discipline enseignant était 100% cassé (403 Forbidden
-- sur chargement ET sur enregistrement).
--
-- Vérifié en exécution réelle :
--   GET  /discipline/sanctions  (enseignant) -> 403 PERMISSION_INSUFFISANTE
--   POST /discipline/sanctions  (enseignant) -> 403 PERMISSION_INSUFFISANTE
--
-- Idempotent : ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'enseignant'
  AND p.code IN ('discipline.voir', 'discipline.prononcer')
ON CONFLICT (role_id, permission_id) DO NOTHING;
