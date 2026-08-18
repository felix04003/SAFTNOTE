'use strict';

const express = require('express');
const { z }   = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../infrastructure/database/pool');
const { authentifier } = require('../middleware/auth.middleware');
const { isolerEtablissement } = require('../middleware/permission.middleware');
const { valider }    = require('../middleware/validate.middleware');
const { ok }         = require('../utils/reponse');
const logger         = require('../utils/logger');

const router = express.Router();

// ── GET /sync — Télécharger les changements ─────────────────────
// Endpoint central de la synchronisation offline-first
router.get('/sync', authentifier, isolerEtablissement, async (req, res, next) => {
  const { depuis } = req.query; // Format ISO : 2025-09-01T06:00:00Z
  const db = getDB();
  const { utilisateur_id, roles } = req.session;

  try {
    const syncDepuis = depuis ? new Date(depuis) : new Date(0);
    const syncAt = new Date().toISOString();

    const isEnseignant = roles.includes('enseignant');
    const isParent     = roles.includes('parent');

    let payload = {};

    if (isEnseignant) {
      // affectations_enseignants.enseignant_id référence enseignants.id, pas
      // utilisateurs.id (ce sont deux UUID distincts) — on résout une fois.
      const enseignantRow = await db('enseignants').where({ utilisateur_id }).first('id');
      const enseignantId = enseignantRow?.id ?? null;

      // Payload enseignant : ses classes + élèves + évaluations + notes + EDT
      const [classes, eleves, evaluations, notes, edt] = await Promise.all([
        // Classes de l'enseignant
        db('affectations_enseignants as ae')
          .join('classes as c', 'c.id', 'ae.classe_id')
          .join('niveaux as n', 'n.id', 'c.niveau_id')
          .join('annees_scolaires as a', 'a.id', 'ae.annee_scolaire_id')
          .where({ 'ae.enseignant_id': enseignantId, 'a.est_courante': true })
          .select('c.id', db.raw("CONCAT(n.nom, ' ', c.nom) as libelle"), 'c.effectif_max'),

        // Élèves modifiés depuis la dernière sync
        // (inscriptions.eleve_id référence eleves.id, pas utilisateurs.id)
        db('inscriptions as i')
          .join('eleves as e', 'e.id', 'i.eleve_id')
          .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
          .join('classes as c', 'c.id', 'i.classe_id')
          .join('niveaux as n', 'n.id', 'c.niveau_id')
          .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
          .join('affectations_enseignants as ae', 'ae.classe_id', 'i.classe_id')
          .where({ 'ae.enseignant_id': enseignantId, 'a.est_courante': true, 'i.statut': 'actif' })
          .where('u.updated_at', '>', syncDepuis)
          .select('u.id', 'u.nom', 'u.prenom', 'u.photo_url', 'e.matricule', 'i.id as inscription_id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"))
          .distinct(),

        // Évaluations modifiées
        db('evaluations as ev')
          .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
          .join('matieres as m', 'm.id', 'ae.matiere_id')
          .where({ 'ae.enseignant_id': enseignantId })
          .where('ev.updated_at', '>', syncDepuis)
          .select('ev.id', 'ev.type', 'ev.numero', 'ev.titre', 'ev.date_evaluation', 'ev.note_max', 'ev.notes_publiees', 'ev.affectation_id', 'm.nom as matiere'),

        // Notes modifiées
        db('notes as n')
          .join('evaluations as ev', 'ev.id', 'n.evaluation_id')
          .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
          .where({ 'ae.enseignant_id': enseignantId })
          .where('n.saisie_at', '>', syncDepuis)
          .select('n.id', 'n.evaluation_id', 'n.eleve_id', 'n.valeur', 'n.est_absent', 'n.absence_justifiee'),

        // EDT de l'enseignant
        db('emplois_du_temps as edt')
          .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
          .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
          .join('matieres as m', 'm.id', 'ae.matiere_id')
          .join('classes as c', 'c.id', 'ae.classe_id')
          .join('niveaux as n', 'n.id', 'c.niveau_id')
          .where({ 'ae.enseignant_id': enseignantId })
          .where('edt.updated_at', '>', syncDepuis)
          .select('edt.id', 'edt.jour_semaine', 'edt.salle', 'ph.heure_debut', 'ph.heure_fin', 'm.nom as matiere', 'ae.classe_id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe")),
      ]);

      payload = { classes, eleves, evaluations, notes, edt };

    } else if (isParent) {
      // Payload parent : enfants + notes publiées + absences + bulletins + EDT
      const [enfants, notes, absences, bulletins, edt] = await Promise.all([
        // Enfants du parent
        // (parents_eleves.eleve_id référence eleves.id, pas utilisateurs.id)
        db('parents_eleves as pe')
          .join('eleves as el', 'el.id', 'pe.eleve_id')
          .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
          .join('inscriptions as i', 'i.eleve_id', 'pe.eleve_id')
          .join('classes as c', 'c.id', 'i.classe_id')
          .join('niveaux as n', 'n.id', 'c.niveau_id')
          .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
          .where({ 'pe.parent_id': utilisateur_id, 'a.est_courante': true, 'i.statut': 'actif' })
          .select('u.id', 'u.nom', 'u.prenom', 'u.photo_url', 'i.id as inscription_id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe")),

        // Notes publiées depuis la dernière sync
        db('notes as n')
          .join('evaluations as ev', 'ev.id', 'n.evaluation_id')
          .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
          .join('matieres as m', 'm.id', 'ae.matiere_id')
          .join('parents_eleves as pe', 'pe.eleve_id', 'n.eleve_id')
          .where({ 'pe.parent_id': utilisateur_id, 'ev.notes_publiees': true })
          .where('n.saisie_at', '>', syncDepuis)
          .select('n.eleve_id', 'm.nom as matiere', 'ev.type', 'ev.date_evaluation', 'n.valeur'),

        // Absences depuis la dernière sync
        db('presences as pr')
          .join('inscriptions as i', 'i.id', 'pr.inscription_id')
          .join('parents_eleves as pe', 'pe.eleve_id', 'i.eleve_id')
          .join('appels as a', 'a.id', 'pr.appel_id')
          .join('emplois_du_temps as edt', 'edt.id', 'a.emploi_du_temps_id')
          .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
          .join('matieres as m', 'm.id', 'ae.matiere_id')
          .where({ 'pe.parent_id': utilisateur_id })
          .whereNot({ 'pr.statut': 'present' })
          // presences n'a pas de colonne updated_at — saisie_at (création) +
          // modifie_at (nullable, mis à jour seulement si modifié après coup)
          .where(db.raw('COALESCE(pr.modifie_at, pr.saisie_at) > ?', [syncDepuis]))
          .select('i.eleve_id', 'pr.statut', 'pr.est_justifie', 'a.date_cours', 'm.nom as matiere'),

        // Bulletins disponibles
        db('moyennes_generales as mg')
          .join('inscriptions as i', 'i.id', 'mg.inscription_id')
          .join('parents_eleves as pe', 'pe.eleve_id', 'i.eleve_id')
          .join('periodes as p', 'p.id', 'mg.periode_id')
          .where({ 'pe.parent_id': utilisateur_id, 'mg.bulletin_genere': true })
          .where('mg.updated_at', '>', syncDepuis)
          .select('i.eleve_id', 'mg.moyenne_generale', 'mg.rang', 'mg.rang_sur', 'mg.mention', 'mg.bulletin_url', 'p.numero as trimestre'),

        // EDT classes des enfants
        db('emplois_du_temps as edt')
          .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
          .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
          .join('matieres as m', 'm.id', 'ae.matiere_id')
          .join('inscriptions as i', 'i.classe_id', 'ae.classe_id')
          .join('parents_eleves as pe', 'pe.eleve_id', 'i.eleve_id')
          .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
          .where({ 'pe.parent_id': utilisateur_id, 'a.est_courante': true, 'i.statut': 'actif' })
          .where('edt.updated_at', '>', syncDepuis)
          .select('edt.jour_semaine', 'ph.heure_debut', 'ph.heure_fin', 'm.nom as matiere', 'ae.classe_id')
          .distinct(),
      ]);

      payload = { enfants, notes, absences, bulletins, edt };
    }

    return ok(res, { sync_at: syncAt, payload });

  } catch (err) { next(err); }
});

// ── POST /sync/operations — Envoi montant (mobile → serveur) ────
router.post('/sync/operations', authentifier, isolerEtablissement,
  valider(z.object({
    operations: z.array(z.object({
      id:          z.string().uuid(),
      type:        z.string(),
      payload:     z.record(z.unknown()),
      cree_at_local: z.string().datetime(),
    })).min(1).max(100),
  })),
  async (req, res, next) => {
    const db = getDB();
    const resultats = [];

    for (const op of req.body.operations) {
      try {
        switch (op.type) {

          case 'notes.saisir': {
            const { evaluation_id, eleve_id, inscription_id, valeur, est_absent, absence_justifiee } = op.payload;
            await db('notes')
              .insert({ id: uuid(), evaluation_id, eleve_id, inscription_id, valeur, est_absent, absence_justifiee, saisie_par: req.session.utilisateur_id })
              .onConflict(['evaluation_id', 'eleve_id'])
              .merge(['valeur', 'est_absent', 'absence_justifiee', 'saisie_par', 'saisie_at']);
            resultats.push({ op_id: op.id, statut: 'ok' });
            break;
          }

          case 'presences.saisir': {
            const { appel_id, inscription_id, statut, minutes_retard } = op.payload;
            // Vérifier que l'appel n'est pas clôturé
            const appel = await db('appels').where({ id: appel_id, statut: 'ouvert' }).first('id');
            if (!appel) {
              resultats.push({ op_id: op.id, statut: 'erreur', code: 'APPEL_CLOTURE' });
              break;
            }
            await db('presences')
              .where({ appel_id, inscription_id })
              .update({ statut, minutes_retard: minutes_retard || 0, updated_at: db.raw('NOW()') });
            resultats.push({ op_id: op.id, statut: 'ok' });
            break;
          }

          default:
            resultats.push({ op_id: op.id, statut: 'erreur', code: 'TYPE_INCONNU', detail: `Type ${op.type} non géré` });
        }
      } catch (err) {
        logger.warn('Opération sync échouée', { op_id: op.id, type: op.type, error: err.message });
        resultats.push({ op_id: op.id, statut: 'erreur', code: 'ERREUR_SERVEUR', detail: err.message });
      }
    }

    const nbEchecs = resultats.filter(r => r.statut === 'erreur').length;
    if (nbEchecs > 0) {
      logger.error('Sync mobile — opérations en échec', {
        etablissement_id: req.etablissement_id,
        utilisateur_id:   req.session?.utilisateur_id,
        nb_operations:    req.body.operations.length,
        nb_echecs:        nbEchecs,
        timestamp:        new Date().toISOString(),
      });
    }

    return ok(res, { resultats });
  }
);

module.exports = router;
