'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, paginee, getPagination } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /discipline/sanctions — Liste des sanctions
// ═════════════════════════════════════════════════════════════════
router.get('/discipline/sanctions', auth, isoler, perm('discipline.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { page, limite, offset } = getPagination(req.query);
    const { classe_id, type, depuis } = req.query;

    let query = db('sanctions as s')
      .join('inscriptions as i',       'i.id', 's.inscription_id')
      .join('eleves as el',            'el.id', 'i.eleve_id')
      .join('utilisateurs as ue',      'ue.id', 'el.utilisateur_id')
      .join('classes as c',            'c.id',  'i.classe_id')
      .join('niveaux as n',            'n.id',  'c.niveau_id')
      .join('annees_scolaires as a',   'a.id',  'i.annee_scolaire_id')
      .join('utilisateurs as up',      'up.id', 's.prononcee_par')
      .where({ 'a.etablissement_id': req.etablissement_id, 'a.est_courante': true });

    if (classe_id) query = query.where('i.classe_id', classe_id);
    if (type)      query = query.where('s.type', type);
    if (depuis)    query = query.where('s.created_at', '>', depuis);

    const [{ count }] = await query.clone().count('s.id as count');
    const sanctions = await query
      .orderBy('s.date_prononcee', 'desc')
      .limit(limite).offset(offset)
      .select(
        's.id', 's.type', 's.date_prononcee', 's.motif',
        's.date_debut', 's.date_fin', 's.nb_jours',
        'ue.id as eleve_id', 'ue.nom as eleve_nom', 'ue.prenom as eleve_prenom',
        'el.matricule',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        db.raw("CONCAT(up.prenom, ' ', up.nom) as prononcee_par"),
        's.notif_parent_envoyee'
      );

    return paginee(res, sanctions, { total: parseInt(count), page, limite });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /discipline/sanctions — Créer une sanction
// ═════════════════════════════════════════════════════════════════
router.post('/discipline/sanctions', auth, isoler, perm('discipline.prononcer'),
  valider(z.object({
    inscription_id: z.string().uuid(),
    incident_id:    z.string().uuid().optional(),
    type:           z.enum(['avertissement_oral', 'avertissement_ecrit', 'retenue', 'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive']),
    motif:          z.string().min(5),
    date_prononcee: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_debut:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_fin:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    nb_jours:       z.number().int().min(1).max(30).optional(),
    // Retenue
    date_retenue:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    heure_debut_retenue: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    heure_fin_retenue:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
    salle_retenue:       z.string().max(50).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier l'inscription
      const inscription = await db('inscriptions as i')
        .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
        .where({ 'i.id': req.body.inscription_id, 'a.etablissement_id': req.etablissement_id, 'i.statut': 'actif' })
        .first('i.id');
      if (!inscription) throw ApiError.nonTrouve('Inscription introuvable');

      // Vérifier l'incident si fourni
      if (req.body.incident_id) {
        const incident = await db('incidents_discipline')
          .where({ id: req.body.incident_id, inscription_id: req.body.inscription_id })
          .first('id');
        if (!incident) throw ApiError.nonTrouve('Incident introuvable');
      }

      const [sanction] = await db('sanctions')
        .insert({
          id:                  uuid(),
          inscription_id:      req.body.inscription_id,
          incident_id:         req.body.incident_id || null,
          type:                req.body.type,
          motif:               req.body.motif,
          date_prononcee:      req.body.date_prononcee || new Date().toISOString().split('T')[0],
          date_debut:          req.body.date_debut || null,
          date_fin:            req.body.date_fin || null,
          nb_jours:            req.body.nb_jours || null,
          prononcee_par:       req.session.utilisateur_id,
          date_retenue:        req.body.date_retenue || null,
          heure_debut_retenue: req.body.heure_debut_retenue || null,
          heure_fin_retenue:   req.body.heure_fin_retenue || null,
          salle_retenue:       req.body.salle_retenue || null,
        })
        .returning('*');

      // Déclencher notification parent (catégorie A — urgente)
      try {
        const { enqueuerNotification } = require('../../../infrastructure/queue/bullmq');
        await enqueuerNotification({
          type_notif:       'sanction',
          inscription_id:   req.body.inscription_id,
          sanction_id:      sanction.id,
          etablissement_id: req.etablissement_id,
        }, 1);
      } catch (notifErr) {
        logger.warn('Notification sanction non envoyée', { error: notifErr.message });
      }

      const typeNormalise = sanction.type.startsWith('avertissement') ? 'avertissement' : sanction.type;
      logger.info('Sanction créée', { id: sanction.id, type: sanction.type, par: req.session.utilisateur_id });
      return cree(res, { ...sanction, type: typeNormalise });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// PUT /discipline/sanctions/:id — Modifier une sanction
// ═════════════════════════════════════════════════════════════════
router.put('/discipline/sanctions/:id', auth, isoler, perm('discipline.prononcer'),
  valider(z.object({
    motif:          z.string().min(5).optional(),
    date_debut:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_fin:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    nb_jours:       z.number().int().min(1).max(30).optional(),
    date_retenue:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    heure_debut_retenue: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    heure_fin_retenue:   z.string().regex(/^\d{2}:\d{2}$/).optional(),
    salle_retenue:       z.string().max(50).optional(),
    approuvee_par:       z.string().uuid().optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier la sanction
      const sanction = await db('sanctions as s')
        .join('inscriptions as i',     'i.id', 's.inscription_id')
        .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
        .where({ 's.id': req.params.id, 'a.etablissement_id': req.etablissement_id })
        .first('s.id');
      if (!sanction) throw ApiError.nonTrouve('Sanction introuvable');

      const updates = {};
      const champsAutorisees = ['motif', 'date_debut', 'date_fin', 'nb_jours', 'date_retenue', 'heure_debut_retenue', 'heure_fin_retenue', 'salle_retenue', 'approuvee_par'];
      for (const champ of champsAutorisees) {
        if (req.body[champ] !== undefined) updates[champ] = req.body[champ];
      }

      if (Object.keys(updates).length === 0) throw ApiError.validationEchouee('Aucun champ à modifier');

      const [updated] = await db('sanctions').where({ id: req.params.id }).update(updates).returning('*');

      logger.info('Sanction modifiée', { id: req.params.id, champs: Object.keys(updates) });
      return ok(res, updated);
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// GET /discipline/eleve/:eleveId — Dossier disciplinaire d'un élève
// ═════════════════════════════════════════════════════════════════
router.get('/discipline/eleves/:id/dossier', auth, isoler, perm('discipline.voir'), async (req, res, next) => {
  try {
    const db = getDB();

    // Vérifier l'élève
    const eleve = await db('utilisateurs').where({ id: req.params.id, etablissement_id: req.etablissement_id }).first('id', 'nom', 'prenom');
    if (!eleve) throw ApiError.nonTrouve('Élève introuvable');

    const eleveObj = await db('eleves').where({ utilisateur_id: req.params.id }).first('id');
    if (!eleveObj) throw ApiError.nonTrouve('Profil élève introuvable');

    // Incidents
    const incidents = await db('incidents_discipline as inc')
      .join('inscriptions as i',      'i.id', 'inc.inscription_id')
      .join('utilisateurs as ur',     'ur.id', 'inc.rapporte_par')
      .where({ 'i.eleve_id': eleveObj.id })
      .orderBy('inc.date_incident', 'desc')
      .limit(50)
      .select(
        'inc.id', 'inc.type', 'inc.gravite', 'inc.description',
        'inc.date_incident', 'inc.heure_incident', 'inc.lieu',
        'inc.statut', 'inc.resolution',
        db.raw("CONCAT(ur.prenom, ' ', ur.nom) as rapporte_par")
      );

    // Sanctions
    const sanctions = await db('sanctions as s')
      .join('inscriptions as i',  'i.id', 's.inscription_id')
      .join('utilisateurs as up', 'up.id', 's.prononcee_par')
      .where({ 'i.eleve_id': eleveObj.id })
      .orderBy('s.date_prononcee', 'desc')
      .limit(50)
      .select(
        's.id', 's.type', 's.date_prononcee', 's.motif',
        's.date_debut', 's.date_fin', 's.nb_jours',
        db.raw("CONCAT(up.prenom, ' ', up.nom) as prononcee_par"),
        's.notif_parent_envoyee', 's.accuse_reception_parent'
      );

    return ok(res, {
      eleve: { id: eleve.id, nom: eleve.nom, prenom: eleve.prenom },
      nb_incidents: incidents.length,
      nb_sanctions: sanctions.length,
      incidents,
      sanctions,
    });
  } catch (err) { next(err); }
});

module.exports = router;
