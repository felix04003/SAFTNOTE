'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }          = require('../../../infrastructure/database/pool');
const { authentifier }   = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }        = require('../../../middleware/validate.middleware');
const { autoriserAccesEleve } = require('../../../middleware/acces-eleve.middleware');
const { ok, cree, liste } = require('../../../utils/reponse');
const ApiError           = require('../../../utils/ApiError');
const logger             = require('../../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── GET /evaluations ─────────────────────────────────────────────
router.get('/evaluations', auth, isoler, perm('notes.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const { classe_id, periode_id, matiere_id } = req.query;

    let query = db('evaluations as ev')
      .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
      .join('classes as c', 'c.id', 'ae.classe_id')
      .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .where({ 'a.etablissement_id': req.etablissement_id });

    if (classe_id)  query = query.where('ae.classe_id', classe_id);
    if (periode_id) query = query.where('ev.periode_id', periode_id);
    if (matiere_id) query = query.where('ae.matiere_id', matiere_id);

    // Un enseignant ne voit que ses propres évaluations
    if (req.session.roles.includes('enseignant') && !req.session.roles.includes('directeur')) {
      query = query.where('ens.utilisateur_id', req.session.utilisateur_id);
    }

    const evals = await query
      .join('niveaux as n',     'n.id',  'c.niveau_id')
      .join('enseignants as ens','ens.id','ae.enseignant_id')
      .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
      .orderBy('ev.date_evaluation', 'desc')
      .select(
        'ev.id', 'ev.type', 'ev.numero', 'ev.titre', 'ev.date_evaluation',
        'ev.note_max', 'ev.moyenne_classe',
        'm.nom as matiere',
        'c.id as classe_id',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        db.raw("u.prenom || ' ' || u.nom as enseignant"),
        db.raw(`CASE WHEN ev.notes_publiees THEN 'publiee'
                     WHEN ev.date_evaluation < CURRENT_DATE THEN 'non_saisie'
                     ELSE 'brouillon' END as statut`)
      );

    return liste(res, evals);
  } catch (err) { next(err); }
});

// ── POST /evaluations ────────────────────────────────────────────
router.post('/evaluations', auth, isoler, perm('evaluations.creer'),
  valider(z.object({
    affectation_id:  z.string().uuid(),
    periode_id:      z.string().uuid(),
    type:            z.enum(['devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet']),
    numero:          z.number().int().min(1).max(5),
    titre:           z.string().optional(),
    note_max:        z.number().min(0).max(20).default(20),
    date_evaluation: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })),
  async (req, res, next) => {
    try {
      const [evaluation] = await getDB()('evaluations')
        .insert({
          id: uuid(),
          ...req.body,
          notes_publiees: false,
        })
        .returning('*');

      logger.info('Évaluation créée', { id: evaluation.id, type: evaluation.type });
      return cree(res, evaluation);
    } catch (err) { next(err); }
  }
);

// ── GET /evaluations/:evaluation_id/notes ────────────────────────
router.get('/evaluations/:evaluation_id/notes', auth, isoler, perm('notes.voir_classe'), async (req, res, next) => {
  try {
    const notes = await getDB()('notes as n')
      .join('eleves as el', 'el.id', 'n.eleve_id')
      .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
      .where({ 'n.evaluation_id': req.params.evaluation_id })
      .orderBy(['u.nom', 'u.prenom'])
      .select(
        'n.id', 'n.eleve_id', 'u.id as utilisateur_id', 'u.nom', 'u.prenom',
        'n.valeur', 'n.est_absent', 'n.absence_justifiee',
        'n.appreciation', 'n.saisie_at'
      );

    return liste(res, notes);
  } catch (err) { next(err); }
});

// ── POST /evaluations/:evaluation_id/notes — Saisie simplifiée ──
router.post('/evaluations/:evaluation_id/notes', auth, isoler, perm('notes.saisir'),
  valider(z.object({
    notes: z.array(z.object({
      eleve_id: z.string().uuid(),
      note:     z.number().min(0).max(20).nullable().optional(),
    })).min(1),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      const evaluation = await db('evaluations as ev')
        .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
        .join('classes as c', 'c.id', 'ae.classe_id')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'ev.id': req.params.evaluation_id, 'a.etablissement_id': req.etablissement_id })
        .first('ev.id', 'ae.classe_id');

      if (!evaluation) throw ApiError.nonTrouve('Évaluation introuvable');

      await db.transaction(async trx => {
        for (const n of req.body.notes) {
          const eleveRow = await trx('eleves').where({ utilisateur_id: n.eleve_id }).first('id');
          if (!eleveRow) continue;

          const insc = await trx('inscriptions')
            .where({ eleve_id: eleveRow.id, classe_id: evaluation.classe_id })
            .first('id');

          await trx.raw(
            `INSERT INTO notes (id, evaluation_id, eleve_id, inscription_id, valeur, saisie_par)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (evaluation_id, eleve_id)
             DO UPDATE SET valeur = EXCLUDED.valeur, saisie_par = EXCLUDED.saisie_par, saisie_at = NOW()`,
            [uuid(), req.params.evaluation_id, eleveRow.id, insc?.id ?? null, n.note ?? null, req.session.utilisateur_id]
          );
        }
      });

      return ok(res, { message: `${req.body.notes.length} notes enregistrées` });
    } catch (err) { next(err); }
  }
);

// ── PUT /evaluations/:evaluation_id/notes — Saisie en masse ─────
router.put('/evaluations/:evaluation_id/notes', auth, isoler, perm('notes.saisir'),
  valider(z.object({
    notes: z.array(z.object({
      eleve_id:          z.string().uuid(),
      inscription_id:    z.string().uuid(),
      valeur:            z.number().min(0).max(20).nullable().optional(),
      est_absent:        z.boolean().default(false),
      absence_justifiee: z.boolean().default(false),
      appreciation:      z.string().optional(),
    })).min(1),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      // Vérifier que l'évaluation appartient à l'établissement
      const evaluation = await db('evaluations as ev')
        .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
        .join('classes as c', 'c.id', 'ae.classe_id')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({
          'ev.id':                  req.params.evaluation_id,
          'a.etablissement_id':     req.etablissement_id,
          'ev.notes_publiees':      false, // Interdit de modifier des notes publiées sans permission
        })
        .first('ev.id', 'ev.affectation_id', 'ae.matiere_id', 'ae.classe_id');

      if (!evaluation) {
        throw ApiError.nonTrouve('Évaluation introuvable ou notes déjà publiées');
      }

      // Un enseignant ne peut saisir que sur ses propres affectations
      // (affectations_enseignants.enseignant_id référence enseignants.id, PAS
      //  utilisateurs.id — il faut passer par enseignants.utilisateur_id pour
      //  comparer à req.session.utilisateur_id, et comparer l'affectation à
      //  evaluation.affectation_id, pas à evaluation.id).
      if (req.session.roles.includes('enseignant') && !req.session.roles.includes('directeur')) {
        const affectation = await db('affectations_enseignants as ae')
          .join('enseignants as ens', 'ens.id', 'ae.enseignant_id')
          .where({ 'ae.id': evaluation.affectation_id, 'ens.utilisateur_id': req.session.utilisateur_id })
          .first();
        if (!affectation) throw ApiError.interdit('Cette évaluation ne vous appartient pas');
      }

      await db.transaction(async trx => {
        const notesAInserer = req.body.notes.map(n => ({
          id:                uuid(),
          evaluation_id:     req.params.evaluation_id,
          eleve_id:          n.eleve_id,
          inscription_id:    n.inscription_id,
          valeur:            n.est_absent && !n.absence_justifiee ? 0 : (n.valeur ?? null),
          est_absent:        n.est_absent,
          absence_justifiee: n.absence_justifiee,
          appreciation:      n.appreciation ?? null,
          saisie_par:        req.session.utilisateur_id,
        }));

        // Upsert : INSERT ou UPDATE si la note existe déjà
        await trx.raw(
          `INSERT INTO notes (id, evaluation_id, eleve_id, inscription_id, valeur,
                              est_absent, absence_justifiee, appreciation, saisie_par)
           VALUES ${notesAInserer.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',')}
           ON CONFLICT (evaluation_id, eleve_id)
           DO UPDATE SET
             valeur = EXCLUDED.valeur,
             est_absent = EXCLUDED.est_absent,
             absence_justifiee = EXCLUDED.absence_justifiee,
             appreciation = EXCLUDED.appreciation,
             saisie_par = EXCLUDED.saisie_par,
             saisie_at = NOW()`,
          notesAInserer.flatMap(n => [
            n.id, n.evaluation_id, n.eleve_id, n.inscription_id, n.valeur,
            n.est_absent, n.absence_justifiee, n.appreciation, n.saisie_par
          ])
        );

        // Déclencher le recalcul des moyennes en arrière-plan
        const { enqueuerCalculMoyennes } = require('../../../infrastructure/queue/bullmq');
        await enqueuerCalculMoyennes({
          classe_id:        evaluation.classe_id,
          matiere_id:       evaluation.matiere_id,
          evaluation_id:    req.params.evaluation_id,
          etablissement_id: req.etablissement_id,
        });
      });

      logger.info('Notes saisies', {
        evaluation_id: req.params.evaluation_id,
        nb_notes:      req.body.notes.length,
        saisie_par:    req.session.utilisateur_id,
      });

      return ok(res, { message: `${req.body.notes.length} notes enregistrées`, recalcul_en_cours: true });
    } catch (err) { next(err); }
  }
);

// ── PUT /evaluations/:evaluation_id/publier ──────────────────────
router.put('/evaluations/:evaluation_id/publier', auth, isoler, perm('notes.publier'), async (req, res, next) => {
  try {
    const db = getDB();
    const [evaluation] = await db('evaluations')
      .where({ id: req.params.evaluation_id })
      .update({ notes_publiees: true, updated_at: db.raw('NOW()') })
      .returning('*');

    if (!evaluation) throw ApiError.nonTrouve('Évaluation introuvable');

    // Déclencher les notifications aux parents (best-effort — ne pas bloquer si queue absente)
    try {
      const { enqueuerNotification } = require('../../../infrastructure/queue/bullmq');
      await enqueuerNotification({
        type_notif:       'nouvelle_note',
        evaluation_id:    evaluation.id,
        etablissement_id: req.etablissement_id,
      }, 2);
    } catch (notifErr) {
      logger.warn('Notification non envoyée (queue absente)', { error: notifErr.message });
    }

    logger.info('Notes publiées', { evaluation_id: evaluation.id });
    return ok(res, { message: 'Notes publiées — parents notifiés' });
  } catch (err) { next(err); }
});

// ── GET /eleves/:eleve_id/notes ──────────────────────────────────
// notes.voir_eleve (pas notes.voir_classe, réservée à la liste de
// classe d'un enseignant) — consultation du dossier d'UN élève,
// utilisée par le parent depuis mobile et par le staff d'établissement.
// :eleve_id suit la convention de ce domaine (eleves.routes.js) :
// c'est utilisateurs.id, pas eleves.id — d'où le join eleves+utilisateurs
// pour résoudre vers notes.eleve_id (qui référence bien eleves.id).
router.get('/eleves/:eleve_id/notes', auth, isoler, autoriserAccesEleve('notes.voir_eleve'), async (req, res, next) => {
  try {
    const db = getDB();
    const { periode_id, matiere_id, depuis } = req.query;

    let query = db('notes as n')
      .join('eleves as el',                    'el.id', 'n.eleve_id')
      .join('evaluations as ev',              'ev.id', 'n.evaluation_id')
      .join('affectations_enseignants as ae',  'ae.id', 'ev.affectation_id')
      .join('matieres as m',                   'm.id', 'ae.matiere_id')
      .leftJoin('disciplines_matieres as dm',  'dm.id', 'm.discipline_id')
      .join('periodes as p',                   'p.id', 'ev.periode_id')
      .join('annees_scolaires as a',           'a.id', 'p.annee_scolaire_id')
      .where({
        'el.utilisateur_id':  req.params.eleve_id,
        'a.etablissement_id': req.etablissement_id,
        'ev.notes_publiees':  true,
      })
      .orderBy(['p.numero', 'ev.date_evaluation']);

    if (periode_id)  query = query.where('ev.periode_id', periode_id);
    if (matiere_id)  query = query.where('ae.matiere_id', matiere_id);
    if (depuis)      query = query.where('n.saisie_at', '>', depuis);

    const notes = await query.select(
      'n.id', 'n.valeur', 'n.est_absent', 'n.appreciation',
      'ev.type', 'ev.numero', 'ev.date_evaluation',
      'm.nom as matiere', 'dm.couleur_affichage', 'p.numero as trimestre'
    );

    return liste(res, notes);
  } catch (err) { next(err); }
});

module.exports = router;
