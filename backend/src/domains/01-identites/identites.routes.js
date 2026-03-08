'use strict';

const express = require('express');
const { z }   = require('zod');
const { getDB }                              = require('../../infrastructure/database/pool');
const { authentifier }                       = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }                            = require('../../middleware/validate.middleware');
const { ok, cree, liste, paginee, vide, getPagination } = require('../../utils/reponse');
const ApiError                               = require('../../utils/ApiError');
const { v4: uuid }                           = require('uuid');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── GET /etablissement ───────────────────────────────────────────
router.get('/etablissement', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const etab = await getDB()('etablissements')
      .where({ id: req.etablissement_id })
      .first();

    if (!etab) throw ApiError.nonTrouve();
    return ok(res, etab);
  } catch (err) { next(err); }
});

// ── PUT /etablissement ───────────────────────────────────────────
router.put('/etablissement', auth, isoler, perm('config.modifier'),
  valider(z.object({
    nom:          z.string().min(2).optional(),
    telephone:    z.string().optional(),
    email:        z.string().email().optional(),
    ville:        z.string().optional(),
    logo_url:     z.string().url().optional(),
  })),
  async (req, res, next) => {
    try {
      const [updated] = await getDB()('etablissements')
        .where({ id: req.etablissement_id })
        .update({ ...req.body, updated_at: getDB().raw('NOW()') })
        .returning('*');
      return ok(res, updated);
    } catch (err) { next(err); }
  }
);

// ── GET /annees-scolaires ────────────────────────────────────────
router.get('/annees-scolaires', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const annees = await getDB()('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id })
      .orderBy('date_debut', 'desc');
    return liste(res, annees);
  } catch (err) { next(err); }
});

// ── GET /annees-scolaires/courante ───────────────────────────────
router.get('/annees-scolaires/courante', auth, isoler, async (req, res, next) => {
  try {
    const annee = await getDB()('annees_scolaires as a')
      .where({ 'a.etablissement_id': req.etablissement_id, 'a.est_courante': true })
      .join('periodes as p', 'p.annee_scolaire_id', 'a.id')
      .select('a.*', getDB().raw('json_agg(p ORDER BY p.numero) as periodes'))
      .groupBy('a.id')
      .first();

    if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante définie');
    return ok(res, annee);
  } catch (err) { next(err); }
});

// ── POST /annees-scolaires ───────────────────────────────────────
router.post('/annees-scolaires', auth, isoler, perm('config.annee_scolaire'),
  valider(z.object({
    libelle:     z.string().regex(/^\d{4}-\d{4}$/, 'Format : 2024-2025'),
    date_debut:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_fin:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    nb_periodes: z.number().int().min(2).max(3).default(3),
    periodes:    z.array(z.object({
      numero:     z.number().int().min(1).max(3),
      libelle:    z.string(),
      date_debut: z.string(),
      date_fin:   z.string(),
    })).optional(),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      await db.transaction(async trx => {
        // Désactiver l'ancienne année courante
        await trx('annees_scolaires')
          .where({ etablissement_id: req.etablissement_id, est_courante: true })
          .update({ est_courante: false });

        // Créer la nouvelle année
        const [annee] = await trx('annees_scolaires')
          .insert({
            id:               uuid(),
            etablissement_id: req.etablissement_id,
            libelle:          req.body.libelle,
            date_debut:       req.body.date_debut,
            date_fin:         req.body.date_fin,
            nb_periodes:      req.body.nb_periodes,
            est_courante:     true,
          })
          .returning('*');

        // Créer les périodes si fournies
        if (req.body.periodes?.length) {
          await trx('periodes').insert(
            req.body.periodes.map(p => ({
              id:               uuid(),
              annee_scolaire_id: annee.id,
              ...p,
            }))
          );
        }

        return cree(res, annee);
      });
    } catch (err) { next(err); }
  }
);

// ── GET /classes ─────────────────────────────────────────────────
router.get('/classes', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const classes = await getDB()('v_classes_completes')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .orderBy(['ordre', 'nom_classe']);
    return liste(res, classes);
  } catch (err) { next(err); }
});

// ── GET /classes/:classe_id/eleves ───────────────────────────────
router.get('/classes/:classe_id/eleves', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const eleves = await getDB()('inscriptions as i')
      .join('eleves as e', 'e.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
      .where({ 'i.classe_id': req.params.classe_id, 'i.statut': 'actif' })
      .orderBy(['u.nom', 'u.prenom'])
      .select(
        'u.id', 'u.nom', 'u.prenom', 'u.photo_url',
        'e.matricule', 'i.id as inscription_id', 'i.rang_classe'
      );

    return liste(res, eleves);
  } catch (err) { next(err); }
});

module.exports = router;
