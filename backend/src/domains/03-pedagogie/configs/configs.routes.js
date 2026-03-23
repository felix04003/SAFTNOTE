'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, liste } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /configs/coefficients — Coefficients par matière et niveau
// ═════════════════════════════════════════════════════════════════
async function fetchCoefficients(db, etablissementId, query) {
  const { niveau_id, serie_id } = query;

  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id', 'libelle');
  if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

  let q = db('configs_matieres_niveau as cmn')
    .join('matieres as m',    'm.id', 'cmn.matiere_id')
    .join('niveaux as n',     'n.id', 'cmn.niveau_id')
    .leftJoin('series as s',  's.id', 'cmn.serie_id')
    .where({ 'cmn.annee_scolaire_id': annee.id, 'm.etablissement_id': etablissementId })
    .orderBy(['n.ordre', 'm.nom']);

  if (niveau_id) q = q.where('cmn.niveau_id', niveau_id);
  if (serie_id)  q = q.where('cmn.serie_id', serie_id);

  const coefficients = await q.select(
    'cmn.id', 'n.id as niveau_id', 'n.nom as niveau', 'n.cycle',
    'm.id as matiere_id', 'm.nom as matiere', 'm.code as matiere_code',
    's.id as serie_id', 's.code as serie_code', 's.libelle as serie',
    'cmn.coefficient', 'cmn.est_eliminatoire', 'cmn.seuil_eliminatoire',
    'cmn.nb_devoirs_periode', 'cmn.nb_compos_periode', 'cmn.est_obligatoire'
  );

  const parNiveau = {};
  for (const c of coefficients) {
    if (!parNiveau[c.niveau_id]) {
      parNiveau[c.niveau_id] = { niveau_id: c.niveau_id, niveau: c.niveau, cycle: c.cycle, matieres: [] };
    }
    parNiveau[c.niveau_id].matieres.push({
      config_id: c.id, matiere_id: c.matiere_id, matiere: c.matiere, matiere_code: c.matiere_code,
      serie_id: c.serie_id, serie: c.serie, coefficient: c.coefficient,
      est_eliminatoire: c.est_eliminatoire, seuil_eliminatoire: c.seuil_eliminatoire,
      nb_devoirs_periode: c.nb_devoirs_periode, nb_compos_periode: c.nb_compos_periode,
      est_obligatoire: c.est_obligatoire,
    });
  }

  return { annee: annee.libelle, niveaux: Object.values(parNiveau) };
}

router.get('/configs/coefficients', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const niveau = req.query.niveau_id || 'all';
    const serie  = req.query.serie_id  || 'all';
    const cle    = `coefficients:${req.etablissement_id}:${niveau}:${serie}`;

    let data;
    try {
      data = await getOrSet(cle, () => fetchCoefficients(db, req.etablissement_id, req.query), 1800);
    } catch {
      data = await fetchCoefficients(db, req.etablissement_id, req.query);
    }
    return ok(res, data);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// PUT /configs/coefficients — Modifier les coefficients (batch)
// ═════════════════════════════════════════════════════════════════
router.put('/configs/coefficients', auth, isoler, perm('config.coefficients'),
  valider(z.object({
    modifications: z.array(z.object({
      config_id:          z.string().uuid(),
      coefficient:        z.number().min(0.5).max(10).optional(),
      est_eliminatoire:   z.boolean().optional(),
      seuil_eliminatoire: z.number().min(0).max(20).nullable().optional(),
      nb_devoirs_periode: z.number().int().min(1).max(5).nullable().optional(),
      nb_compos_periode:  z.number().int().min(0).max(3).nullable().optional(),
      est_obligatoire:    z.boolean().optional(),
    })).min(1),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      await db.transaction(async trx => {
        for (const modif of req.body.modifications) {
          const { config_id, ...champs } = modif;

          const config = await trx('configs_matieres_niveau as cmn')
            .join('matieres as m', 'm.id', 'cmn.matiere_id')
            .where({ 'cmn.id': config_id, 'm.etablissement_id': req.etablissement_id })
            .first('cmn.id');
          if (!config) throw ApiError.nonTrouve(`Configuration ${config_id} introuvable`);

          const updates = {};
          for (const [key, value] of Object.entries(champs)) {
            if (value !== undefined) updates[key] = value;
          }

          if (Object.keys(updates).length > 0) {
            await trx('configs_matieres_niveau').where({ id: config_id }).update(updates);
          }
        }
      });

      logger.info('Coefficients modifiés', { nb: req.body.modifications.length, par: req.session.utilisateur_id });

      try { await invalidatePattern(`coefficients:${req.etablissement_id}`); } catch { /* Redis down */ }

      return ok(res, { message: `${req.body.modifications.length} coefficients modifiés` });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// GET /configs/matieres — Liste des matières de l'établissement
// ═════════════════════════════════════════════════════════════════
async function fetchMatieres(db, etablissementId, actifSeulement) {
  let query = db('matieres as m')
    .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
    .where({ 'm.etablissement_id': etablissementId })
    .orderBy(['dm.ordre', 'm.nom']);

  if (actifSeulement === 'true') query = query.where('m.actif', true);

  return query.select(
    'm.id', 'm.nom', 'm.nom_court', 'm.code',
    'm.compte_dans_moyenne', 'm.est_eliminatoire',
    'm.seuil_eliminatoire', 'm.est_optionnelle', 'm.actif',
    'dm.id as discipline_id', 'dm.nom as discipline', 'dm.couleur_affichage'
  );
}

router.get('/configs/matieres', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const cle = `matieres:${req.etablissement_id}`;

    let matieres;
    try {
      matieres = await getOrSet(cle, () => fetchMatieres(db, req.etablissement_id, req.query.actif_seulement), 1800);
    } catch {
      matieres = await fetchMatieres(db, req.etablissement_id, req.query.actif_seulement);
    }
    return liste(res, matieres);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /configs/matieres — Créer une matière
// ═════════════════════════════════════════════════════════════════
router.post('/configs/matieres', auth, isoler, perm('config.modifier'),
  valider(z.object({
    nom:                 z.string().min(2).max(150),
    nom_court:           z.string().max(20).optional(),
    code:                z.string().min(1).max(20),
    discipline_id:       z.string().uuid().optional(),
    compte_dans_moyenne: z.boolean().default(true),
    est_eliminatoire:    z.boolean().default(false),
    seuil_eliminatoire:  z.number().min(0).max(20).nullable().optional(),
    est_optionnelle:     z.boolean().default(false),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const existant = await db('matieres')
        .where({ etablissement_id: req.etablissement_id, code: req.body.code })
        .first('id');
      if (existant) throw ApiError.validationEchouee(`Une matière avec le code "${req.body.code}" existe déjà`);

      if (req.body.discipline_id) {
        const discipline = await db('disciplines_matieres')
          .where({ id: req.body.discipline_id, etablissement_id: req.etablissement_id })
          .first('id');
        if (!discipline) throw ApiError.nonTrouve('Discipline introuvable');
      }

      const [matiere] = await db('matieres')
        .insert({
          id: uuid(), etablissement_id: req.etablissement_id,
          nom: req.body.nom, nom_court: req.body.nom_court, code: req.body.code,
          discipline_id: req.body.discipline_id || null,
          compte_dans_moyenne: req.body.compte_dans_moyenne,
          est_eliminatoire: req.body.est_eliminatoire,
          seuil_eliminatoire: req.body.seuil_eliminatoire || null,
          est_optionnelle: req.body.est_optionnelle, actif: true,
        })
        .returning('*');

      logger.info('Matière créée', { id: matiere.id, code: matiere.code });
      try { await invalidatePattern(`matieres:${req.etablissement_id}`); } catch { /* Redis down */ }
      return cree(res, matiere);
    } catch (err) { next(err); }
  }
);

module.exports = router;
