-- ============================================================
-- MIGRATION 013 — notes.voir_eleve manquante pour le staff
--
-- GET /eleves/:eleve_id/notes (consultation des notes d'UN
-- élève — utilisé par le parent depuis mobile, et par le
-- personnel type directeur/censeur/admin pour consulter le
-- dossier d'un élève) exigeait la permission 'notes.voir_classe'
-- qui n'a jamais eu de sens ici : voir_classe sert aux
-- enseignants pour la liste des évaluations d'UNE classe entière
-- (GET /evaluations), pas à la consultation du dossier d'un
-- élève précis. Résultat : PERSONNE ne pouvait jamais consulter
-- les notes d'un élève via cette route (l'enseignant a
-- notes.voir_classe mais pas la permission attendue par cette
-- route via son propre join cassé ; le parent n'a que
-- notes.voir_eleve).
--
-- La permission notes.voir_eleve existe déjà (donnée à eleve et
-- parent) mais n'a jamais été donnée au staff d'établissement.
-- On aligne sur le modèle déjà en place pour absences.voir_eleve
-- (admin, censeur, directeur, super_admin, parent).
--
-- Idempotent : ON CONFLICT DO NOTHING.
-- ============================================================

INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('admin', 'censeur', 'directeur')
  AND p.code = 'notes.voir_eleve'
ON CONFLICT (role_id, permission_id) DO NOTHING;
