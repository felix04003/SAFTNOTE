-- ============================================================
-- MIGRATION 008 — INDEX DE PERFORMANCE
-- Indexes additionnels pour optimiser les requêtes courantes
-- identifiées lors de l'audit de performance.
-- Tous les CREATE INDEX sont non-bloquants (CONCURRENTLY).
-- ============================================================

-- ── Priorité 1 : Requêtes critiques ─────────────────────────────

-- 1. Appels : empêcher les doublons et accélérer la vérification
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_appels_emploi_date
  ON appels(emploi_du_temps_id, date_cours);

-- 2. Tableau de bord élève : recherche inscription rapide
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inscriptions_eleve_annee_statut
  ON inscriptions(eleve_id, annee_scolaire_id, statut);

-- 3. Moyennes générales : agrégation par inscription et période
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_moyennes_gen_inscription_periode_moy
  ON moyennes_generales(inscription_id, periode_id, moyenne_generale);

-- 4. EDT : lookup planning par classe et jour
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_edt_classe_jour_actif
  ON emplois_du_temps(classe_id, jour_semaine, plage_id)
  WHERE actif = TRUE;

-- ── Priorité 2 : Optimisations fréquentes ───────────────────────

-- 5. Parents-élèves : résolution lien parent → enfants
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_parents_eleves_parent_permissions
  ON parents_eleves(parent_id, peut_voir_notes, peut_voir_absences);

-- 6. Présences : filtre non-présents pour notifications
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_presences_appel_statut
  ON presences(appel_id, statut)
  WHERE statut != 'present';

-- 7. Récapitulatifs absences : dashboard et calculs période
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recapitulatifs_inscription_periode
  ON recapitulatifs_absences(inscription_id, periode_id);

-- 8. Évaluations : filtre par période et publication
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_evaluations_periode_publiees
  ON evaluations(periode_id, affectation_id, notes_publiees);

-- 9. Sessions : lookup par token_hash (authentification)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_token_hash
  ON sessions(token_hash)
  WHERE revoquee = FALSE;

-- ── Priorité 3 : Nettoyage général ──────────────────────────────

-- 10. Moyennes matières : calcul bulletin et récap matière
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_moyennes_mat_inscription_matiere_periode
  ON moyennes_matieres(inscription_id, matiere_id, periode_id);

-- 11. Affectations : filtre enseignant par année
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_affectations_enseignant_annee
  ON affectations_enseignants(annee_scolaire_id, enseignant_id);

-- 12. Modifications EDT non notifiées
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_modif_edt_non_notifie
  ON modifications_edt(notif_envoyee, date_cours)
  WHERE notif_envoyee = FALSE;

-- ============================================================
-- RÉSUMÉ : 12 indexes créés pour les requêtes les plus fréquentes.
-- Impact estimé : -60% latence sur tableau-de-bord, -70% sur appels.
-- ============================================================
