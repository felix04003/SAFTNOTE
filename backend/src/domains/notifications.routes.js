'use strict';

const express = require('express');
const { getDB }    = require('../infrastructure/database/pool');
const { authentifier }                        = require('../middleware/auth.middleware');
const { isolerEtablissement }                 = require('../middleware/permission.middleware');
const { ok }       = require('../utils/reponse');

const router = express.Router();
const auth   = authentifier;
const isoler = isolerEtablissement;

// ── Helpers ────────────────────────────────────────────────────

var FENETRE_JOURS = 7;
var MAX_ITEMS     = 10;

async function notifsAdmin(db, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  // 1. Appels manqués : créneaux passés sans appel (7 derniers jours)
  var appelsManques = await db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .leftJoin('appels as ap', function() {
      this.on('ap.emploi_du_temps_id', '=', 'edt.id')
          .andOnVal('ap.statut', '!=', 'annule');
    })
    .where('ae.etablissement_id', etablissementId)
    .where('edt.date_debut', '>=', depuisISO)
    .where('edt.date_debut', '<', db.raw('CURRENT_DATE'))
    .whereNull('ap.id')
    .limit(MAX_ITEMS)
    .select(
      'cl.nom as classe',
      'm.nom as matiere',
      'edt.date_debut as date',
      'edt.heure_debut as heure'
    );

  // 2. Absences injustifiées (7 derniers jours)
  var absences = await db('presences as p')
    .join('appels as ap', 'ap.id', 'p.appel_id')
    .join('inscriptions as i', 'i.id', 'p.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .where('ap.etablissement_id', etablissementId)
    .where('p.statut', 'absent')
    .where('p.est_justifie', false)
    .where('ap.date', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'ap.date as date'
    );

  // 3. Notes publiées (7 derniers jours)
  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .where('ae.etablissement_id', etablissementId)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'cl.nom as classe', 'ev.date_evaluation as date');

  // 4. Bulletins disponibles (7 derniers jours)
  var bulletins = await db('moyennes_generales as mg')
    .join('inscriptions as i', 'i.id', 'mg.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .join('periodes as per', 'per.id', 'mg.periode_id')
    .join('annees_scolaires as an', 'an.id', 'per.annee_scolaire_id')
    .where('an.etablissement_id', etablissementId)
    .where('mg.bulletin_genere', true)
    .where('mg.updated_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'per.nom as periode'
    );

  // 5. Incidents discipline (7 derniers jours)
  var incidents = await db('incidents_discipline as inc')
    .join('inscriptions as i', 'i.id', 'inc.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .join('annees_scolaires as an', function() {
      this.on('an.id', db.raw('(SELECT annee_scolaire_id FROM classes WHERE id = i.classe_id)'));
    })
    .where('an.etablissement_id', etablissementId)
    .where('inc.statut', '!=', 'clos')
    .where('inc.created_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'inc.type',
      'inc.gravite',
      db.raw("inc.created_at::date as date")
    );

  return { appelsManques, absences, notes, bulletins, incidents };
}

async function notifsEnseignant(db, utilisateurId, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  var enseignant = await db('enseignants')
    .where({ utilisateur_id: utilisateurId, etablissement_id: etablissementId })
    .first('id');
  if (!enseignant) return { appelsManques: [], notes: [] };

  var appelsManques = await db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .leftJoin('appels as ap', function() {
      this.on('ap.emploi_du_temps_id', '=', 'edt.id')
          .andOnVal('ap.statut', '!=', 'annule');
    })
    .where('ae.enseignant_id', enseignant.id)
    .where('edt.date_debut', '>=', depuisISO)
    .where('edt.date_debut', '<', db.raw('CURRENT_DATE'))
    .whereNull('ap.id')
    .limit(MAX_ITEMS)
    .select('cl.nom as classe', 'm.nom as matiere', 'edt.date_debut as date', 'edt.heure_debut as heure');

  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .where('ae.enseignant_id', enseignant.id)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'cl.nom as classe', 'ev.date_evaluation as date');

  return { appelsManques, notes };
}

async function notifsParent(db, utilisateurId, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  var enfants = await db('parents_eleves as pe')
    .join('eleves as el', 'el.id', 'pe.eleve_id')
    .join('inscriptions as i', 'i.eleve_id', 'el.id')
    .join('annees_scolaires as an', 'an.id', 'i.annee_scolaire_id')
    .where('pe.parent_id', utilisateurId)
    .where('an.etablissement_id', etablissementId)
    .where('an.est_courante', true)
    .where('i.statut', 'actif')
    .select('i.id as inscription_id');

  if (!enfants.length) return { absences: [], notes: [], bulletins: [], incidents: [] };

  var inscriptionIds = enfants.map(function(r) { return r.inscription_id; });

  var absences = await db('presences as p')
    .join('appels as ap', 'ap.id', 'p.appel_id')
    .join('inscriptions as i', 'i.id', 'p.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .whereIn('p.inscription_id', inscriptionIds)
    .where('p.statut', 'absent')
    .where('p.est_justifie', false)
    .where('ap.date', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"), 'cl.nom as classe', 'ap.date as date');

  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('inscriptions as i', 'i.classe_id', 'ae.classe_id')
    .whereIn('i.id', inscriptionIds)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'ev.date_evaluation as date');

  var bulletins = await db('moyennes_generales as mg')
    .join('periodes as per', 'per.id', 'mg.periode_id')
    .whereIn('mg.inscription_id', inscriptionIds)
    .where('mg.bulletin_genere', true)
    .where('mg.updated_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('per.nom as periode', 'mg.updated_at as date');

  var incidents = await db('incidents_discipline as inc')
    .join('inscriptions as i', 'i.id', 'inc.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .whereIn('inc.inscription_id', inscriptionIds)
    .where('inc.statut', '!=', 'clos')
    .where('inc.created_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'inc.type',
      'inc.gravite',
      db.raw("inc.created_at::date as date")
    );

  return { absences, notes, bulletins, incidents };
}

// ── Route ──────────────────────────────────────────────────────

router.get('/notifications', auth, isoler, async function(req, res, next) {
  var db     = getDB();
  var userId = req.session.utilisateur_id;
  var etabId = req.etablissement_id;
  var role   = req.session.role;

  try {
    var raw;
    if (role === 'parent') {
      raw = await notifsParent(db, userId, etabId);
    } else if (role === 'enseignant') {
      raw = await notifsEnseignant(db, userId, etabId);
    } else {
      raw = await notifsAdmin(db, etabId);
    }

    var categories = [];

    function ajouterCategorie(type, label, items) {
      categories.push({ type: type, label: label, count: items.length, items: items });
    }

    if (raw.appelsManques)  ajouterCategorie('appels_manques',        'Appels non effectués',     raw.appelsManques);
    if (raw.absences)       ajouterCategorie('absences_injustifiees', 'Absences injustifiées',    raw.absences);
    if (raw.notes)          ajouterCategorie('notes_publiees',        'Notes publiées',           raw.notes);
    if (raw.bulletins)      ajouterCategorie('bulletins_disponibles', 'Bulletins disponibles',    raw.bulletins);
    if (raw.incidents)      ajouterCategorie('incidents_discipline',  'Incidents disciplinaires', raw.incidents);

    var total = categories.reduce(function(sum, c) { return sum + c.count; }, 0);

    return ok(res, { total: total, categories: categories });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
