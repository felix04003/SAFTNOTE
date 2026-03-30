'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB, withTransaction } = require('../../../infrastructure/database/pool');
const { authentifier }   = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }        = require('../../../middleware/validate.middleware');
const { ok, cree, liste } = require('../../../utils/reponse');
const ApiError           = require('../../../utils/ApiError');
const logger             = require('../../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── POST /appels — Ouvrir un appel ───────────────────────────────
router.post('/appels', auth, isoler, perm('absences.faire_appel'),
  valider(z.object({
    emploi_du_temps_id: z.string().uuid(),
    date_cours:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      // Vérifier qu'un appel n'existe pas déjà pour ce cours ce jour
      const existant = await db('appels')
        .where({
          emploi_du_temps_id: req.body.emploi_du_temps_id,
          date_cours:         req.body.date_cours,
        })
        .first('id');

      if (existant) return ok(res, existant); // Idempotent

      // Récupérer les élèves inscrits dans la classe
      const edt = await db('emplois_du_temps as e')
        .join('affectations_enseignants as ae', 'ae.id', 'e.affectation_id')
        .join('classes as c', 'c.id', 'ae.classe_id')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'e.id': req.body.emploi_du_temps_id })
        .first('ae.classe_id', 'a.id as annee_id');

      if (!edt) throw ApiError.nonTrouve('Cours introuvable dans l\'EDT');

      const inscriptions = await db('inscriptions')
        .where({ classe_id: edt.classe_id, annee_scolaire_id: edt.annee_id, statut: 'actif' })
        .select('id');

      await withTransaction(async trx => {
        // Créer l'appel
        const appel = await trx('appels').insert({
          id:                 uuid(),
          emploi_du_temps_id: req.body.emploi_du_temps_id,
          date_cours:         req.body.date_cours,
          effectue_par:       req.session.utilisateur_id,
          statut:             'ouvert',
        }).returning('id').then(rows => rows[0]);

        // Pré-remplir toutes les présences à "non_saisi"
        if (inscriptions.length > 0) {
          await trx('presences').insert(
            inscriptions.map(i => ({
              id:             uuid(),
              appel_id:       appel.id,
              inscription_id: i.id,
              statut:         'non_saisi',
            }))
          );
        }

        return cree(res, { appel_id: appel.id, nb_eleves: inscriptions.length });
      });

    } catch (err) { next(err); }
  }
);

// ── GET /appels/cours — État d'un cours pour le drawer EDT ──────
// ?emploi_du_temps_id=<uuid>&date_cours=YYYY-MM-DD
router.get('/appels/cours', auth, isoler, perm('absences.faire_appel'), async (req, res, next) => {
  const db = getDB();
  try {
    const { emploi_du_temps_id, date_cours } = req.query;

    if (!emploi_du_temps_id || !date_cours) {
      throw ApiError.validationEchouee('emploi_du_temps_id et date_cours requis');
    }

    // Ownership check : le créneau doit appartenir à une affectation de l'enseignant
    // dans l'établissement courant (scoping via annees_scolaires)
    const creneauEns = await db('emplois_du_temps as edt')
      .join('affectations_enseignants as ae', 'ae.id',  'edt.affectation_id')
      .join('classes as c',                  'c.id',   'ae.classe_id')
      .join('annees_scolaires as a',          'a.id',   'c.annee_scolaire_id')
      .join('enseignants as ens',             'ens.id', 'ae.enseignant_id')
      .where({
        'edt.id':             emploi_du_temps_id,
        'ens.utilisateur_id': req.session.utilisateur_id,
        'a.etablissement_id': req.etablissement_id,
      })
      .first('edt.id', 'ae.classe_id', 'a.id as annee_id');

    if (!creneauEns) throw ApiError.interdit('Ce créneau ne vous appartient pas');

    // Chercher l'appel existant
    const appel = await db('appels')
      .where({ emploi_du_temps_id, date_cours })
      .first('id', 'statut');

    // Récupérer les élèves inscrits dans la classe
    const inscriptions = await db('inscriptions as i')
      .join('eleves as el',       'el.id', 'i.eleve_id')
      .join('utilisateurs as u',  'u.id',  'el.utilisateur_id')
      .where({
        'i.classe_id':         creneauEns.classe_id,
        'i.annee_scolaire_id': creneauEns.annee_id,
        'i.statut':            'actif',
      })
      .orderBy(['u.nom', 'u.prenom'])
      .select('i.id as inscription_id', 'u.nom', 'u.prenom');

    // Si un appel existe, récupérer les statuts de présence
    const presencesMap = {};
    if (appel) {
      const presences = await db('presences')
        .where({ appel_id: appel.id })
        .select('inscription_id', 'statut', 'minutes_retard');
      presences.forEach(function(p) {
        presencesMap[p.inscription_id] = { statut: p.statut, minutes_retard: p.minutes_retard || 0 };
      });
    }

    const eleves = inscriptions.map(function(i) {
      const p = presencesMap[i.inscription_id] || { statut: 'non_saisi', minutes_retard: 0 };
      return {
        inscription_id: i.inscription_id,
        nom:            i.nom,
        prenom:         i.prenom,
        statut:         p.statut,
        minutes_retard: p.minutes_retard,
      };
    });

    return ok(res, {
      appel_id: appel ? appel.id     : null,
      statut:   appel ? appel.statut : null,
      eleves,
    });

  } catch (err) { next(err); }
});

// ── PUT /appels/:appel_id/presences — Saisir l'appel ────────────
// Déclencheur principal des notifications parents
router.put('/appels/:appel_id/presences', auth, isoler, perm('absences.faire_appel'),
  valider(z.object({
    presences: z.array(z.object({
      inscription_id: z.string().uuid(),
      statut:         z.enum(['present', 'absent', 'retard', 'sorti_avant', 'dispense']),
      minutes_retard: z.number().int().min(1).max(120).optional(),
      est_justifie:   z.boolean().optional(),
      justification:  z.string().optional(),
    })).min(1),
    cloturer: z.boolean().default(true), // Clôturer l'appel après saisie
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      // Vérifier que l'appel existe et n'est pas clôturé
      const appel = await db('appels')
        .where({ id: req.params.appel_id, statut: 'ouvert' })
        .first();

      if (!appel) throw ApiError.nonTrouve('Appel introuvable ou déjà clôturé');

      const absentesNonJustifies = [];

      await withTransaction(async trx => {
        for (const p of req.body.presences) {
          // Mise à jour de la présence
          await trx('presences')
            .where({ appel_id: req.params.appel_id, inscription_id: p.inscription_id })
            .update({
              statut:         p.statut,
              minutes_retard: p.minutes_retard || 0,
              est_justifie:   p.est_justifie || false,
              justification:  p.justification,
              updated_at:     trx.raw('NOW()'),
            });

          // Collecter les absences non justifiées pour notification
          if ((p.statut === 'absent' || p.statut === 'retard') && !p.est_justifie) {
            absentesNonJustifies.push({
              inscription_id: p.inscription_id,
              statut:         p.statut,
            });
          }
        }

        // Clôturer l'appel si demandé
        if (req.body.cloturer) {
          await trx('appels')
            .where({ id: req.params.appel_id })
            .update({ statut: 'effectue', heure_debut_reelle: trx.raw('NOW()') });
        }
      });

      // Déclencher les notifications pour absences/retards (hors transaction)
      if (absentesNonJustifies.length > 0) {
        const { enqueuerNotification } = require('../../../infrastructure/queue/bullmq');
        for (const abs of absentesNonJustifies) {
          await enqueuerNotification({
            type_notif:       abs.statut === 'absent' ? 'absence' : 'retard',
            inscription_id:   abs.inscription_id,
            appel_id:         req.params.appel_id,
            etablissement_id: req.etablissement_id,
          }, 1); // Priorité 1 = urgence
        }

        logger.info('Notifications absence enqueueées', {
          nb:       absentesNonJustifies.length,
          appel_id: req.params.appel_id,
        });
      }

      return ok(res, {
        message:      `${req.body.presences.length} présences enregistrées`,
        notifications: absentesNonJustifies.length,
      });

    } catch (err) { next(err); }
  }
);

// ── GET /presences/absences — Liste des absences (directeur) ────
router.get('/presences/absences', auth, isoler, perm('absences.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const { classe_id, limite = 50, page = 1 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limite);

    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id');

    if (!annee) return liste(res, []);

    let query = db('presences as p')
      .join('appels as a',                   'a.id',   'p.appel_id')
      .join('inscriptions as i',             'i.id',   'p.inscription_id')
      .join('classes as c',                  'c.id',   'i.classe_id')
      .join('eleves as el',                  'el.id',  'i.eleve_id')
      .join('utilisateurs as u',             'u.id',   'el.utilisateur_id')
      .join('emplois_du_temps as edt',       'edt.id', 'a.emploi_du_temps_id')
      .join('affectations_enseignants as ae','ae.id',  'edt.affectation_id')
      .join('matieres as m',                 'm.id',   'ae.matiere_id')
      .where({ 'c.annee_scolaire_id': annee.id })
      .whereIn('p.statut', ['absent', 'retard'])
      .orderBy('a.date_cours', 'desc')
      .limit(parseInt(limite))
      .offset(offset)
      .select(
        'u.nom', 'u.prenom', 'c.nom as classe',
        'a.date_cours as date', 'm.nom as matiere',
        'p.statut', 'p.est_justifie', 'p.motif_justification as justification',
        'p.id as presence_id'
      );

    if (classe_id) query = query.where('c.id', classe_id);

    const rows = await query;
    return liste(res, rows);
  } catch (err) { next(err); }
});

// ── PUT /presences/:presence_id/justifier ───────────────────────
router.put('/presences/:presence_id/justifier', auth, isoler, perm('absences.justifier'),
  valider(z.object({
    justification:    z.string().min(3),
    document_url:     z.string().url().optional(),
  })),
  async (req, res, next) => {
    try {
      const [updated] = await getDB()('presences')
        .where({ id: req.params.presence_id })
        .update({
          est_justifie:     true,
          justification:    req.body.justification,
          justification_doc: req.body.document_url,
          updated_at:       getDB().raw('NOW()'),
        })
        .returning('*');

      if (!updated) throw ApiError.nonTrouve('Présence introuvable');
      return ok(res, updated);
    } catch (err) { next(err); }
  }
);

module.exports = router;
