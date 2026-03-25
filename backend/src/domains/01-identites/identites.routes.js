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
const { getOrSet, invalidatePattern }        = require('../../infrastructure/cache/redis');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── GET /etablissement ───────────────────────────────────────────
router.get('/etablissement', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const etab = await db('etablissements')
      .where({ id: req.etablissement_id })
      .select('id', 'nom', 'code_officiel', 'type', 'pays', 'ville', 'telephone', 'email', 'actif', 'created_at')
      .first();

    if (!etab) throw ApiError.nonTrouve();

    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id', 'libelle', 'date_debut', 'date_fin');

    return ok(res, {
      ...etab,
      annee_courante: annee?.libelle || null,
      annee_scolaire: annee || null,
    });
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

// ── POST /classes ─────────────────────────────────────────────────
router.post('/classes', auth, isoler, perm('config.modifier'),
  valider(z.object({
    niveau_id:        z.string().uuid('ID niveau invalide'),
    nom:              z.string().min(1).max(10),   // 'A', 'B', 'C'…
    salle_principale: z.string().max(50).optional(),
    effectif_max:     z.number().int().min(1).max(200).optional(),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      const annee = await db('annees_scolaires')
        .where({ etablissement_id: req.etablissement_id, est_courante: true })
        .first('id');
      if (!annee) throw ApiError.validationEchouee('Aucune année scolaire courante — créez-en une d\'abord');

      // Vérifier que le niveau appartient à cet établissement
      const niveau = await db('niveaux')
        .where({ id: req.body.niveau_id, etablissement_id: req.etablissement_id })
        .first('id', 'nom');
      if (!niveau) throw ApiError.nonTrouve('Niveau introuvable');

      const [classe] = await db('classes').insert({
        id:               uuid(),
        annee_scolaire_id: annee.id,
        niveau_id:        req.body.niveau_id,
        nom:              req.body.nom.toUpperCase(),
        salle_principale: req.body.salle_principale,
        effectif_max:     req.body.effectif_max,
      }).returning('*');

      try { await invalidatePattern(`classes:${req.etablissement_id}`); } catch { /* Redis indisponible — ignoré */ }
      return cree(res, { ...classe, niveau: niveau.nom });
    } catch (err) { next(err); }
  }
);

// ── GET /niveaux ──────────────────────────────────────────────────
router.get('/niveaux', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const niveaux = await getDB()('niveaux')
      .where({ etablissement_id: req.etablissement_id })
      .orderBy('ordre');
    return liste(res, niveaux);
  } catch (err) { next(err); }
});

// ── fetchClasses — helper extrait pour le cache ──────────────────
async function fetchClasses(db, etablissementId) {
  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id');

  if (!annee) return [];

  return db('classes as c')
    .join('niveaux as n', 'n.id', 'c.niveau_id')
    .where({ 'c.annee_scolaire_id': annee.id, 'c.actif': true })
    .orderBy(['n.ordre', 'c.nom'])
    .select(
      'c.id', 'c.nom', 'c.effectif_max', 'c.salle_principale',
      'n.nom as niveau', 'n.ordre',
      db.raw("n.nom || ' ' || c.nom AS nom_classe"),
      // Effectif réel
      db.raw(`(
        SELECT COUNT(*) FROM inscriptions i
        WHERE i.classe_id = c.id AND i.statut = 'actif'
      ) as effectif`),
      // Moyenne générale de la classe (dernière période calculée)
      db.raw(`(
        SELECT ROUND(AVG(mg.moyenne_generale)::NUMERIC, 1)
        FROM moyennes_generales mg
        JOIN inscriptions i ON i.id = mg.inscription_id
        JOIN periodes p ON p.id = mg.periode_id
        WHERE i.classe_id = c.id
          AND mg.moyenne_generale IS NOT NULL
          AND p.numero = (
            SELECT MAX(p2.numero) FROM periodes p2
            WHERE p2.annee_scolaire_id = c.annee_scolaire_id
              AND EXISTS (SELECT 1 FROM moyennes_generales mg2
                          JOIN inscriptions i2 ON i2.id = mg2.inscription_id
                          WHERE i2.classe_id = c.id AND mg2.periode_id = p2.id)
          )
      ) as moyenne`)
    );
}

// ── GET /classes ─────────────────────────────────────────────────
router.get('/classes', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    let classes;
    try {
      classes = await getOrSet(
        `classes:${req.etablissement_id}`,
        () => fetchClasses(db, req.etablissement_id),
        600
      );
    } catch {
      classes = await fetchClasses(db, req.etablissement_id);
    }
    return liste(res, classes);
  } catch (err) { next(err); }
});

// ── GET /annees-scolaires/courante ────────────────────────────────
router.get('/annees-scolaires/courante', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id', 'libelle', 'date_debut', 'date_fin', 'nb_periodes');
    if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');
    const periodes = await db('periodes')
      .where({ annee_scolaire_id: annee.id })
      .orderBy('numero')
      .select('id', 'numero', 'libelle', 'date_debut', 'date_fin');
    return ok(res, { ...annee, periodes });
  } catch (err) { next(err); }
});

// ── GET /classes/:classe_id/affectations ──────────────────────────
router.get('/classes/:classe_id/affectations', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id');
    if (!annee) return liste(res, []);
    const affectations = await db('affectations_enseignants as ae')
      .join('matieres as m',              'm.id',  'ae.matiere_id')
      .leftJoin('disciplines_matieres as d', 'd.id', 'm.discipline_id')
      .join('enseignants as e',           'e.id',  'ae.enseignant_id')
      .join('utilisateurs as u',          'u.id',  'e.utilisateur_id')
      .where({ 'ae.classe_id': req.params.classe_id, 'ae.annee_scolaire_id': annee.id })
      .orderBy('m.nom')
      .select(
        'ae.id as affectation_id',
        'm.id as matiere_id', 'm.nom as matiere',
        'd.couleur_affichage',
        'u.nom as enseignant_nom', 'u.prenom as enseignant_prenom'
      );
    return liste(res, affectations);
  } catch (err) { next(err); }
});

// ── fetchElevesClasse — helper extrait pour le cache ─────────────
async function fetchElevesClasse(db, classeId) {
  return db('inscriptions as i')
    .join('eleves as e', 'e.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
    .where({ 'i.classe_id': classeId, 'i.statut': 'actif' })
    .orderBy(['u.nom', 'u.prenom'])
    .select(
      'u.id', 'u.nom', 'u.prenom', 'u.photo_url',
      'e.matricule', 'i.id as inscription_id', 'i.rang_classe'
    );
}

// ── GET /classes/:classe_id/eleves ───────────────────────────────
router.get('/classes/:classe_id/eleves', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    let eleves;
    try {
      eleves = await getOrSet(
        `classe_eleves:${req.params.classe_id}`,
        () => fetchElevesClasse(db, req.params.classe_id),
        600
      );
    } catch {
      eleves = await fetchElevesClasse(db, req.params.classe_id);
    }
    return liste(res, eleves);
  } catch (err) { next(err); }
});

// ── GET /enseignants/moi/affectations — passe au router enseignants
router.get('/enseignants/moi/affectations', (req, res, next) => next('router'));

// ── GET /enseignants/:enseignant_id/affectations ──────────────────
router.get('/enseignants/:enseignant_id/affectations', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id', 'libelle');
    if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

    const affectations = await db('affectations_enseignants as ae')
      .join('matieres as m',  'm.id',  'ae.matiere_id')
      .join('classes as c',   'c.id',  'ae.classe_id')
      .join('niveaux as n',   'n.id',  'c.niveau_id')
      .where({
        'ae.enseignant_id':     req.params.enseignant_id,
        'ae.annee_scolaire_id': annee.id,
        'm.etablissement_id':   req.etablissement_id,
      })
      .select(
        'ae.id', 'ae.est_titulaire',
        'm.id as matiere_id', 'm.nom as matiere',
        'c.id as classe_id',  'c.nom as classe',
        'n.nom as niveau', 'n.ordre'
      )
      .orderBy(['n.ordre', 'm.nom']);

    return ok(res, { annee: annee.libelle, affectations });
  } catch (err) { next(err); }
});

// ── POST /affectations ────────────────────────────────────────────
router.post('/affectations', auth, isoler, perm('config.modifier'),
  valider(z.object({
    enseignant_id: z.string().uuid('enseignant_id doit être un UUID'),
    classe_id:     z.string().uuid('classe_id doit être un UUID'),
    matiere_id:    z.string().uuid('matiere_id doit être un UUID'),
    est_titulaire: z.boolean().default(true),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const annee = await db('annees_scolaires')
        .where({ etablissement_id: req.etablissement_id, est_courante: true })
        .first('id');
      if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

      const enseignant = await db('enseignants as e')
        .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
        .where({ 'e.id': req.body.enseignant_id, 'u.etablissement_id': req.etablissement_id })
        .first('e.id');
      if (!enseignant) throw ApiError.nonTrouve('Enseignant introuvable');

      const classe = await db('classes as c')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'c.id': req.body.classe_id, 'a.etablissement_id': req.etablissement_id })
        .first('c.id');
      if (!classe) throw ApiError.nonTrouve('Classe introuvable');

      const matiere = await db('matieres')
        .where({ id: req.body.matiere_id, etablissement_id: req.etablissement_id })
        .first('id');
      if (!matiere) throw ApiError.nonTrouve('Matière introuvable');

      const existant = await db('affectations_enseignants')
        .where({
          classe_id:          req.body.classe_id,
          matiere_id:         req.body.matiere_id,
          annee_scolaire_id:  annee.id,
        })
        .first('id');
      if (existant) throw ApiError.conflit('Cette matière est déjà assignée dans cette classe pour cette année');

      const [affectation] = await db('affectations_enseignants')
        .insert({
          id:                 uuid(),
          enseignant_id:      req.body.enseignant_id,
          classe_id:          req.body.classe_id,
          matiere_id:         req.body.matiere_id,
          annee_scolaire_id:  annee.id,
          est_titulaire:      req.body.est_titulaire,
        })
        .returning('*');

      return cree(res, affectation);
    } catch (err) { next(err); }
  }
);

// ── DELETE /affectations/:id ──────────────────────────────────────
router.delete('/affectations/:id', auth, isoler, perm('config.modifier'), async (req, res, next) => {
  try {
    const db = getDB();

    const affectation = await db('affectations_enseignants as ae')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .where({ 'ae.id': req.params.id, 'm.etablissement_id': req.etablissement_id })
      .first('ae.id');
    if (!affectation) throw ApiError.nonTrouve('Affectation introuvable');

    const evalExist = await db('evaluations')
      .where({ affectation_id: req.params.id })
      .first('id');
    if (evalExist) throw ApiError.conflit('Impossible de supprimer : des évaluations existent pour cette affectation');

    await db('affectations_enseignants').where({ id: req.params.id }).del();
    return vide(res);
  } catch (err) { next(err); }
});

module.exports = router;
