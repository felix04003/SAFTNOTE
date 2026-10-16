'use strict';

const express = require('express');
const { z }   = require('zod');

const { getDB, withTransaction } = require('../../infrastructure/database/pool');
const { invalidatePattern }      = require('../../infrastructure/cache/redis');
const { authentifier }           = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }                = require('../../middleware/validate.middleware');
const { ok, cree }               = require('../../utils/reponse');
const service                    = require('./passage-annee.service');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format : AAAA-MM-JJ');

// ═════════════════════════════════════════════════════════════════
// GET /annees-scolaires/passage/apercu — classes, élèves et décisions proposées
// ?seuil=10 : moyenne annuelle à partir de laquelle un élève est proposé « admis » (sans décision du conseil)
// ═════════════════════════════════════════════════════════════════
router.get('/annees-scolaires/passage/apercu', auth, isoler, perm('config.annee_scolaire'), async (req, res, next) => {
  try {
    const seuil = req.query.seuil === undefined ? service.SEUIL_DEFAUT : Number(req.query.seuil);
    if (!Number.isFinite(seuil) || seuil < 0 || seuil > 20) {
      return res.status(422).json({ succes: false, erreur: 'Le seuil doit être compris entre 0 et 20', code: 'VALIDATION_ECHOUEE' });
    }
    return ok(res, await service.apercu(getDB(), req.etablissement_id, { seuil }));
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /annees-scolaires/passage — clôturer l'année courante et ouvrir la suivante
// Une décision par élève inscrit (admis, redouble, diplome, transfere, abandonne, exclu). Tout ou rien.
// ═════════════════════════════════════════════════════════════════
router.post('/annees-scolaires/passage', auth, isoler, perm('config.annee_scolaire'),
  valider(z.object({
    libelle:     z.string().regex(/^\d{4}-\d{4}$/, 'Format : 2026-2027'),
    date_debut:  date,
    date_fin:    date,
    nb_periodes: z.number().int().min(2).max(3).optional(),
    periodes:    z.array(z.object({
      numero:     z.number().int().min(1).max(3),
      libelle:    z.string().min(1).max(50),
      date_debut: date,
      date_fin:   date,
    })).optional(),
    copier_affectations: z.boolean().default(false),
    decisions: z.array(z.object({
      inscription_id: z.string().uuid(),
      decision:       z.enum(service.DECISIONS),
      classe_cible:   z.object({ niveau_id: z.string().uuid(), nom: z.string().regex(/^[A-Za-z0-9]{1,10}$/, 'Lettre de classe invalide') }).optional(),
    })).max(5000),
  })),
  async (req, res, next) => {
    try {
      const compteRendu = await withTransaction((trx) => service.effectuerPassage(trx, {
        etablissementId: req.etablissement_id, utilisateurId: req.session.utilisateur_id, params: req.body,
      }));

      try {
        for (const motif of ['classes', 'classe_eleves', 'edt_classe', 'edt_ens', 'moyennes_classe']) {
          await invalidatePattern(`${motif}:${req.etablissement_id}*`);
        }
        await invalidatePattern('classe_eleves:*');
      } catch { /* Redis indisponible — ignoré */ }

      // Réponse APRÈS le COMMIT (voir POST /appels)
      return cree(res, compteRendu);
    } catch (err) { next(err); }
  }
);

module.exports = router;
