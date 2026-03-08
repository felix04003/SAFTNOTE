'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, liste, vide } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /evenements — Liste des événements (agenda)
// ═════════════════════════════════════════════════════════════════
router.get('/evenements', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const { type, depuis, jusqua, a_venir } = req.query;

    let query = db('evenements as ev')
      .where({ 'ev.etablissement_id': req.etablissement_id })
      .orderBy('ev.date_debut', 'asc');

    if (type)    query = query.where('ev.type', type);
    if (depuis)  query = query.where('ev.date_debut', '>=', depuis);
    if (jusqua)  query = query.where('ev.date_fin', '<=', jusqua);
    if (a_venir === 'true') query = query.where('ev.date_debut', '>=', db.raw('CURRENT_DATE'));

    const evenements = await query.select(
      'ev.id', 'ev.titre', 'ev.type', 'ev.description',
      'ev.date_debut', 'ev.date_fin', 'ev.heure_debut', 'ev.heure_fin',
      'ev.lieu', 'ev.concerne_tout_etablissement',
      'ev.classes_concernees', 'ev.niveaux_concernes',
      'ev.necessite_autorisation', 'ev.date_limite_autorisation',
      'ev.cout_participation', 'ev.devise_cout',
      'ev.notif_programmee', 'ev.notif_envoyee_at',
      'ev.created_at'
    );

    return liste(res, evenements);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /evenements — Créer un événement
// ═════════════════════════════════════════════════════════════════
router.post('/evenements', auth, isoler, perm('config.modifier'),
  valider(z.object({
    titre:                      z.string().min(3).max(200),
    type:                       z.enum([
      'sortie_scolaire', 'reunion_parents', 'examen_officiel', 'conseil_classe',
      'conseil_discipline', 'journee_sportive', 'journee_portes_ouvertes',
      'conge', 'formation_enseignants', 'autre',
    ]),
    description:                z.string().optional(),
    date_debut:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_fin:                   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    heure_debut:                z.string().regex(/^\d{2}:\d{2}$/).optional(),
    heure_fin:                  z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lieu:                       z.string().optional(),
    concerne_tout_etablissement: z.boolean().default(true),
    classes_concernees:         z.array(z.string().uuid()).optional(),
    niveaux_concernes:          z.array(z.string().uuid()).optional(),
    necessite_autorisation:     z.boolean().default(false),
    date_limite_autorisation:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cout_participation:         z.number().min(0).optional(),
    devise_cout:                z.string().max(5).default('XOF'),
    notif_programmee:           z.boolean().default(false),
    notif_delai_jours:          z.number().int().min(0).max(30).default(2),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const [evenement] = await db('evenements')
        .insert({
          id:                          uuid(),
          etablissement_id:            req.etablissement_id,
          titre:                       req.body.titre,
          type:                        req.body.type,
          description:                 req.body.description || null,
          date_debut:                  req.body.date_debut,
          date_fin:                    req.body.date_fin,
          heure_debut:                 req.body.heure_debut || null,
          heure_fin:                   req.body.heure_fin || null,
          lieu:                        req.body.lieu || null,
          concerne_tout_etablissement: req.body.concerne_tout_etablissement,
          classes_concernees:          req.body.classes_concernees || null,
          niveaux_concernes:           req.body.niveaux_concernes || null,
          necessite_autorisation:      req.body.necessite_autorisation,
          date_limite_autorisation:    req.body.date_limite_autorisation || null,
          cout_participation:          req.body.cout_participation || null,
          devise_cout:                 req.body.devise_cout,
          notif_programmee:            req.body.notif_programmee,
          notif_delai_jours:           req.body.notif_delai_jours,
          created_par:                 req.session.utilisateur_id,
        })
        .returning('*');

      logger.info('Événement créé', { id: evenement.id, titre: evenement.titre, type: evenement.type });
      return cree(res, evenement);
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// PUT /evenements/:id — Modifier un événement
// ═════════════════════════════════════════════════════════════════
router.put('/evenements/:id', auth, isoler, perm('config.modifier'),
  valider(z.object({
    titre:                      z.string().min(3).max(200).optional(),
    type:                       z.enum([
      'sortie_scolaire', 'reunion_parents', 'examen_officiel', 'conseil_classe',
      'conseil_discipline', 'journee_sportive', 'journee_portes_ouvertes',
      'conge', 'formation_enseignants', 'autre',
    ]).optional(),
    description:                z.string().optional(),
    date_debut:                 z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_fin:                   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    heure_debut:                z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    heure_fin:                  z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    lieu:                       z.string().nullable().optional(),
    concerne_tout_etablissement: z.boolean().optional(),
    classes_concernees:         z.array(z.string().uuid()).nullable().optional(),
    niveaux_concernes:          z.array(z.string().uuid()).nullable().optional(),
    necessite_autorisation:     z.boolean().optional(),
    date_limite_autorisation:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    cout_participation:         z.number().min(0).nullable().optional(),
    notif_programmee:           z.boolean().optional(),
    notif_delai_jours:          z.number().int().min(0).max(30).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const evenement = await db('evenements')
        .where({ id: req.params.id, etablissement_id: req.etablissement_id })
        .first('id');
      if (!evenement) throw ApiError.nonTrouve('Événement introuvable');

      const updates = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (value !== undefined) updates[key] = value;
      }

      if (Object.keys(updates).length === 0) throw ApiError.validationEchouee('Aucun champ à modifier');

      const [updated] = await db('evenements').where({ id: req.params.id }).update(updates).returning('*');

      logger.info('Événement modifié', { id: req.params.id, champs: Object.keys(updates) });
      return ok(res, updated);
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// DELETE /evenements/:id — Supprimer un événement
// ═════════════════════════════════════════════════════════════════
router.delete('/evenements/:id', auth, isoler, perm('config.modifier'), async (req, res, next) => {
  try {
    const db = getDB();

    const evenement = await db('evenements')
      .where({ id: req.params.id, etablissement_id: req.etablissement_id })
      .first('id');
    if (!evenement) throw ApiError.nonTrouve('Événement introuvable');

    await db('evenements').where({ id: req.params.id }).del();

    logger.info('Événement supprimé', { id: req.params.id });
    return vide(res);
  } catch (err) { next(err); }
});

module.exports = router;
