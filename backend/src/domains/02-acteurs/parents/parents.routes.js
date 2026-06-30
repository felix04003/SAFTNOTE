'use strict';

const express  = require('express');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { isolerEtablissement } = require('../../../middleware/permission.middleware');
const { ok, liste }  = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');

const router = express.Router();
const auth   = authentifier;
const isoler = isolerEtablissement;

// ── Helpers ──────────────────────────────────────────────────────

async function verifierLienParentEnfant(db, parentId, eleveUtilisateurId, etablissementId) {
  const lien = await db('parents_eleves as pe')
    .join('eleves as el',       'el.id', 'pe.eleve_id')
    .join('utilisateurs as ue', 'ue.id', 'el.utilisateur_id')
    .where({
      'pe.parent_id':        parentId,
      'el.utilisateur_id':   eleveUtilisateurId,
      'ue.etablissement_id': etablissementId,
    })
    .first('pe.*', 'el.id as eleve_id_pk', 'el.utilisateur_id as eleve_utilisateur_id');

  if (!lien) throw ApiError.interdit('Cet enfant n\'est pas lié à votre compte');
  return lien;
}

async function getInscriptionCourante(db, eleveIdPk, etablissementId) {
  const inscription = await db('inscriptions as i')
    .join('classes as c',          'c.id', 'i.classe_id')
    .join('niveaux as n',          'n.id', 'c.niveau_id')
    .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
    .where({
      'i.eleve_id':         eleveIdPk,
      'a.est_courante':     true,
      'a.etablissement_id': etablissementId,
      'i.statut':           'actif',
    })
    .first(
      'i.id as inscription_id', 'i.classe_id',
      db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
      'n.nom as niveau', 'a.id as annee_id', 'a.libelle as annee_libelle'
    );

  if (!inscription) throw ApiError.nonTrouve('Inscription courante introuvable pour cet enfant');
  return inscription;
}

// ═════════════════════════════════════════════════════════════════
// GET /parents/moi/enfants
// Liste des enfants du parent connecté avec leurs inscriptions
// ═════════════════════════════════════════════════════════════════
router.get('/parents/moi/enfants', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();

    const enfants = await db('parents_eleves as pe')
      .join('eleves as el',              'el.id',  'pe.eleve_id')
      .join('utilisateurs as ue',        'ue.id',  'el.utilisateur_id')
      .leftJoin('inscriptions as i', function() {
        this.on('i.eleve_id', '=', 'el.id').andOn('i.statut', '=', db.raw("'actif'"));
      })
      .leftJoin('classes as c',          'c.id', 'i.classe_id')
      .leftJoin('niveaux as n',          'n.id', 'c.niveau_id')
      .leftJoin('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
      .where({ 'pe.parent_id': req.session.utilisateur_id, 'ue.etablissement_id': req.etablissement_id })
      .andWhere(function() {
        this.where('a.est_courante', true).orWhereNull('a.est_courante');
      })
      .orderBy('ue.prenom')
      .select(
        'ue.id as eleve_utilisateur_id', 'ue.nom', 'ue.prenom',
        'ue.date_naissance', 'ue.genre', 'ue.photo_url',
        'el.matricule', 'pe.lien', 'pe.est_contact_principal',
        'pe.peut_voir_notes', 'pe.peut_voir_absences',
        'pe.peut_voir_bulletins', 'pe.peut_voir_discipline',
        'i.id as inscription_id',
        db.raw("CASE WHEN c.id IS NOT NULL THEN CONCAT(n.nom, ' ', c.nom) ELSE NULL END as classe"),
        'n.nom as niveau', 'a.libelle as annee_scolaire'
      );

    return liste(res, enfants);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /parents/moi/tableau-de-bord
// Données agrégées de tous les enfants du parent
// ═════════════════════════════════════════════════════════════════
router.get('/parents/moi/tableau-de-bord', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();

    // Récupérer tous les liens parent-enfant
    const liens = await db('parents_eleves as pe')
      .join('eleves as el',       'el.id', 'pe.eleve_id')
      .join('utilisateurs as ue', 'ue.id', 'el.utilisateur_id')
      .where({ 'pe.parent_id': req.session.utilisateur_id, 'ue.etablissement_id': req.etablissement_id })
      .select('pe.*', 'el.id as eleve_id_pk', 'el.utilisateur_id as eleve_utilisateur_id');

    if (liens.length === 0) throw ApiError.nonTrouve('Aucun enfant lié à ce compte parent');

    const tableauDeBord = await Promise.all(
      liens.map(async (lien) => {
        let inscription;
        try {
          inscription = await getInscriptionCourante(db, lien.eleve_id_pk, req.etablissement_id);
        } catch {
          return null;
        }

        const eleve = await db('utilisateurs')
          .where({ id: lien.eleve_utilisateur_id })
          .first('nom', 'prenom', 'photo_url');

        const [moyenneGenerale, absences, dernieresNotes] = await Promise.all([
          db('moyennes_generales as mg')
            .join('periodes as p', 'p.id', 'mg.periode_id')
            .where({ 'mg.inscription_id': inscription.inscription_id })
            .orderBy('p.numero', 'desc')
            .first('mg.moyenne_generale', 'mg.rang', 'mg.rang_sur', 'mg.mention', 'p.numero as trimestre'),

          lien.peut_voir_absences
            ? db('recapitulatifs_absences as ra')
                .join('periodes as p', 'p.id', 'ra.periode_id')
                .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
                .where({ 'ra.inscription_id': inscription.inscription_id, 'a.est_courante': true })
                .select(
                  db.raw('COALESCE(SUM(ra.nb_seances_absences_just), 0) as justifiees'),
                  db.raw('COALESCE(SUM(ra.nb_seances_absences_injust), 0) as injustifiees'),
                  db.raw('COALESCE(SUM(ra.nb_seances_retards), 0) as retards')
                )
                .first()
            : { justifiees: 0, injustifiees: 0, retards: 0 },

          lien.peut_voir_notes
            ? db('notes as n')
                .join('evaluations as ev',              'ev.id', 'n.evaluation_id')
                .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
                .join('matieres as m',                  'm.id',  'ae.matiere_id')
                .where({ 'n.eleve_id': lien.eleve_id_pk, 'ev.notes_publiees': true })
                .orderBy('ev.date_evaluation', 'desc')
                .limit(3)
                .select('m.nom as matiere', 'ev.type', 'n.valeur', 'ev.date_evaluation')
            : [],
        ]);

        return {
          enfant: {
            id: lien.eleve_utilisateur_id,
            nom: eleve.nom, prenom: eleve.prenom, photo_url: eleve.photo_url,
            classe: inscription.classe, niveau: inscription.niveau, lien: lien.lien,
          },
          moyenne_generale: moyenneGenerale || null,
          absences: absences || { justifiees: 0, injustifiees: 0, retards: 0 },
          dernieres_notes: dernieresNotes,
        };
      })
    );

    return ok(res, tableauDeBord.filter(Boolean));
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /parents/moi/enfants/:id/notes
// Notes d'un enfant (vérification lien parent-enfant)
// ═════════════════════════════════════════════════════════════════
router.get('/parents/moi/enfants/:id/notes', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const lien = await verifierLienParentEnfant(db, req.session.utilisateur_id, req.params.id, req.etablissement_id);

    if (!lien.peut_voir_notes) {
      throw ApiError.interdit('Vous n\'avez pas l\'autorisation de voir les notes de cet enfant');
    }

    const { periode_id, matiere_id, depuis } = req.query;

    let query = db('notes as n')
      .join('evaluations as ev',              'ev.id', 'n.evaluation_id')
      .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
      .join('matieres as m',                  'm.id',  'ae.matiere_id')
      .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
      .join('periodes as p',                  'p.id',  'ev.periode_id')
      .join('annees_scolaires as a',          'a.id',  'p.annee_scolaire_id')
      .where({
        'n.eleve_id':         lien.eleve_id_pk,
        'a.etablissement_id': req.etablissement_id,
        'a.est_courante':     true,
        'ev.notes_publiees':  true,
      })
      .orderBy(['p.numero', 'm.nom', 'ev.date_evaluation']);

    if (periode_id) query = query.where('ev.periode_id', periode_id);
    if (matiere_id) query = query.where('ae.matiere_id', matiere_id);
    if (depuis)     query = query.where('n.saisie_at', '>', depuis);

    const notes = await query.select(
      'n.id', 'n.valeur', 'n.est_absent', 'n.appreciation',
      'ev.type', 'ev.numero', 'ev.date_evaluation', 'ev.note_max',
      'ev.moyenne_classe', 'ev.note_min_classe', 'ev.note_max_classe',
      'm.nom as matiere', 'dm.couleur_affichage',
      'p.numero as trimestre', 'p.libelle as periode'
    );

    const parMatiere = {};
    for (const note of notes) {
      if (!parMatiere[note.matiere]) {
        parMatiere[note.matiere] = { matiere: note.matiere, couleur: note.couleur_affichage, notes: [] };
      }
      parMatiere[note.matiere].notes.push(note);
    }

    return ok(res, { nb_notes: notes.length, par_matiere: Object.values(parMatiere) });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /parents/moi/enfants/:id/absences
// Absences d'un enfant
// ═════════════════════════════════════════════════════════════════
router.get('/parents/moi/enfants/:id/absences', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const lien = await verifierLienParentEnfant(db, req.session.utilisateur_id, req.params.id, req.etablissement_id);

    if (!lien.peut_voir_absences) {
      throw ApiError.interdit('Vous n\'avez pas l\'autorisation de voir les absences de cet enfant');
    }

    const inscription = await getInscriptionCourante(db, lien.eleve_id_pk, req.etablissement_id);
    const { depuis } = req.query;

    const recap = await db('recapitulatifs_absences as ra')
      .join('periodes as p', 'p.id', 'ra.periode_id')
      .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
      .where({ 'ra.inscription_id': inscription.inscription_id, 'a.est_courante': true })
      .orderBy('p.numero')
      .select(
        'p.numero as trimestre', 'p.libelle as periode',
        'ra.nb_seances_absences_just as justifiees',
        'ra.nb_seances_absences_injust as injustifiees',
        'ra.nb_seances_retards as retards'
      );

    let queryDetail = db('presences as pr')
      .join('appels as ap',                  'ap.id',  'pr.appel_id')
      .join('emplois_du_temps as edt',       'edt.id', 'ap.emploi_du_temps_id')
      .join('affectations_enseignants as ae','ae.id',  'edt.affectation_id')
      .join('matieres as m',                 'm.id',   'ae.matiere_id')
      .join('plages_horaires as ph',         'ph.id',  'edt.plage_id')
      .where({ 'pr.inscription_id': inscription.inscription_id })
      .whereIn('pr.statut', ['absent', 'retard', 'sorti_avant'])
      .orderBy('ap.date_cours', 'desc');

    if (depuis) queryDetail = queryDetail.where('pr.saisie_at', '>', depuis);

    const absences = await queryDetail.limit(50).select(
      'ap.date_cours', 'edt.jour_semaine',
      'ph.heure_debut', 'ph.heure_fin',
      'm.nom as matiere', 'pr.statut', 'pr.minutes_retard',
      'pr.est_justifie', 'pr.motif_justification', 'pr.commentaire_justif'
    );

    return ok(res, { recapitulatif: recap, detail: absences });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /parents/moi/enfants/:id/bulletins
// Bulletins disponibles d'un enfant
// ═════════════════════════════════════════════════════════════════
router.get('/parents/moi/enfants/:id/bulletins', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const lien = await verifierLienParentEnfant(db, req.session.utilisateur_id, req.params.id, req.etablissement_id);

    if (!lien.peut_voir_bulletins) {
      throw ApiError.interdit('Vous n\'avez pas l\'autorisation de voir les bulletins de cet enfant');
    }

    const inscription = await getInscriptionCourante(db, lien.eleve_id_pk, req.etablissement_id);

    const bulletins = await db('moyennes_generales as mg')
      .join('periodes as p', 'p.id', 'mg.periode_id')
      .where({ 'mg.inscription_id': inscription.inscription_id, 'mg.bulletin_genere': true })
      .whereNotNull('mg.valide_at')
      .orderBy('p.numero')
      .select(
        'mg.id', 'p.numero as trimestre', 'p.libelle as periode',
        'mg.moyenne_generale', 'mg.rang', 'mg.rang_sur',
        'mg.mention', 'mg.decision_conseil', 'mg.appreciation_conseil',
        'mg.nb_absences_justifiees', 'mg.nb_absences_injustifiees', 'mg.nb_retards',
        'mg.bulletin_url', 'mg.bulletin_genere_at', 'mg.valide_at'
      );

    const bulletinsComplets = await Promise.all(
      bulletins.map(async (bulletin) => {
        const matieres = await db('moyennes_matieres as mm')
          .join('matieres as m', 'm.id', 'mm.matiere_id')
          .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
          .join('periodes as p2', 'p2.id', 'mm.periode_id')
          .where({ 'mm.inscription_id': inscription.inscription_id, 'p2.numero': bulletin.trimestre })
          .whereIn('p2.annee_scolaire_id',
            db('annees_scolaires').select('id').where({ etablissement_id: req.etablissement_id, est_courante: true })
          )
          .orderBy('m.nom')
          .select(
            'm.nom as matiere', 'dm.couleur_affichage',
            'mm.moyenne', 'mm.coefficient', 'mm.rang_dans_classe',
            'mm.appreciation_enseignant', 'mm.est_complete'
          );
        return { ...bulletin, matieres };
      })
    );

    return ok(res, {
      enfant: { classe: inscription.classe, niveau: inscription.niveau },
      annee: inscription.annee_libelle,
      bulletins: bulletinsComplets,
    });
  } catch (err) { next(err); }
});

module.exports = router;
