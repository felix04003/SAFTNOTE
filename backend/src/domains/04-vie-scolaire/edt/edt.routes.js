'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, vide, liste } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

const JOURS_NOMS = { 1: 'Lundi', 2: 'Mardi', 3: 'Mercredi', 4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi' };

// ═════════════════════════════════════════════════════════════════
// GET /plages-horaires — Liste des plages horaires de l'établissement
// (nécessaire au formulaire de création de créneau EDT — aucune route
// ne l'exposait jusqu'ici, cf. plan M2)
// ═════════════════════════════════════════════════════════════════
router.get('/plages-horaires', auth, isoler, perm('edt.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const cle = `plages_horaires:${req.etablissement_id}`;

    const fetchPlages = () => db('plages_horaires')
      .where({ etablissement_id: req.etablissement_id })
      .orderBy('numero')
      .select('id', 'numero', 'libelle', 'heure_debut', 'heure_fin', 'est_pause');

    let plages;
    try {
      plages = await getOrSet(cle, fetchPlages, 3600);
    } catch {
      plages = await fetchPlages();
    }
    return liste(res, plages);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /edt/classe/:classeId — EDT d'une classe (semaine)
// ═════════════════════════════════════════════════════════════════
async function fetchEdtClasse(db, classeId, etablissementId, semaine) {
  const classe = await db('classes as c')
    .join('niveaux as n', 'n.id', 'c.niveau_id')
    .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
    .where({ 'c.id': classeId, 'a.etablissement_id': etablissementId, 'a.est_courante': true })
    .first('c.id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"));

  if (!classe) return null;

  let query = db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('matieres as m',        'm.id',  'ae.matiere_id')
    .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
    .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
    .join('enseignants as ens',    'ens.id', 'ae.enseignant_id')
    .join('utilisateurs as u',     'u.id',   'ens.utilisateur_id')
    .where({ 'edt.classe_id': classeId, 'edt.actif': true })
    .orderBy(['edt.jour_semaine', 'ph.heure_debut'])
    .select(
      'edt.id as creneau_id', 'edt.jour_semaine',
      'ph.numero as plage_numero', 'ph.libelle as plage_libelle',
      'ph.heure_debut', 'ph.heure_fin', 'ph.est_pause',
      'm.nom as matiere', 'm.nom_court as matiere_court', 'dm.couleur_affichage',
      db.raw("CONCAT(u.prenom, ' ', u.nom) as enseignant"),
      'edt.salle', 'ae.id as affectation_id'
    );

  if (semaine) {
    query = query
      .where(function() { this.whereNull('edt.date_debut_validite').orWhere('edt.date_debut_validite', '<=', semaine); })
      .where(function() { this.whereNull('edt.date_fin_validite').orWhere('edt.date_fin_validite', '>=', semaine); });
  }

  const creneaux = await query;
  const parJour = {};
  for (const c of creneaux) {
    const jour = c.jour_semaine;
    if (!parJour[jour]) parJour[jour] = { jour, nom: JOURS_NOMS[jour], creneaux: [] };
    parJour[jour].creneaux.push(c);
  }
  return { classe: classe.classe, nb_creneaux: creneaux.length, emploi_du_temps: Object.values(parJour) };
}

router.get('/edt/classe/:classeId', auth, isoler, perm('edt.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { semaine } = req.query;
    const cle = semaine
      ? `edt_classe:${req.params.classeId}:${semaine}`
      : `edt_classe:${req.params.classeId}`;

    let resultat;
    try {
      resultat = await getOrSet(cle, () => fetchEdtClasse(db, req.params.classeId, req.etablissement_id, semaine), 3600);
    } catch {
      resultat = await fetchEdtClasse(db, req.params.classeId, req.etablissement_id, semaine);
    }

    if (!resultat) throw ApiError.nonTrouve('Classe introuvable');
    return ok(res, resultat);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /edt/enseignant/:enseignantId — EDT d'un enseignant
// ═════════════════════════════════════════════════════════════════
async function fetchEdtEnseignant(db, enseignantId, etablissementId, semaine) {
  const enseignant = await db('enseignants as ens')
    .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
    .where({ 'ens.id': enseignantId, 'u.etablissement_id': etablissementId })
    .first('ens.id', db.raw("CONCAT(u.prenom, ' ', u.nom) as nom_complet"));

  if (!enseignant) return null;

  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id', 'libelle');
  if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

  let query = db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('classes as c',          'c.id',  'ae.classe_id')
    .join('niveaux as n',          'n.id',  'c.niveau_id')
    .join('matieres as m',         'm.id',  'ae.matiere_id')
    .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
    .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
    .where({ 'ae.enseignant_id': enseignantId, 'ae.annee_scolaire_id': annee.id, 'edt.actif': true })
    .orderBy(['edt.jour_semaine', 'ph.heure_debut'])
    .select(
      'edt.id as creneau_id', 'edt.jour_semaine',
      'ph.numero as plage_numero', 'ph.libelle as plage_libelle',
      'ph.heure_debut', 'ph.heure_fin', 'ph.est_pause',
      db.raw("CONCAT(n.nom, ' ', c.nom) as classe"), 'c.id as classe_id',
      'm.nom as matiere', 'm.nom_court as matiere_court', 'dm.couleur_affichage',
      'edt.salle', 'ae.id as affectation_id'
    );

  if (semaine) {
    query = query
      .where(function() { this.whereNull('edt.date_debut_validite').orWhere('edt.date_debut_validite', '<=', semaine); })
      .where(function() { this.whereNull('edt.date_fin_validite').orWhere('edt.date_fin_validite', '>=', semaine); });
  }

  const creneaux = await query;
  const parJour = {};
  for (const c of creneaux) {
    const jour = c.jour_semaine;
    if (!parJour[jour]) parJour[jour] = { jour, nom: JOURS_NOMS[jour], creneaux: [] };
    parJour[jour].creneaux.push(c);
  }
  return { enseignant: enseignant.nom_complet, annee: annee.libelle, nb_creneaux: creneaux.length, emploi_du_temps: Object.values(parJour) };
}

router.get('/edt/enseignant/:enseignantId', auth, isoler, perm('edt.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { semaine } = req.query;
    const cle = semaine
      ? `edt_ens:${req.params.enseignantId}:${semaine}`
      : `edt_ens:${req.params.enseignantId}`;

    let resultat;
    try {
      resultat = await getOrSet(cle, () => fetchEdtEnseignant(db, req.params.enseignantId, req.etablissement_id, semaine), 3600);
    } catch {
      resultat = await fetchEdtEnseignant(db, req.params.enseignantId, req.etablissement_id, semaine);
    }

    if (!resultat) throw ApiError.nonTrouve('Enseignant introuvable');
    return ok(res, resultat);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /edt/creneaux — Créer un créneau
// ═════════════════════════════════════════════════════════════════
router.post('/edt/creneaux', auth, isoler, perm('edt.creer'),
  valider(z.object({
    classe_id:           z.string().uuid(),
    affectation_id:      z.string().uuid(),
    plage_id:            z.string().uuid(),
    jour_semaine:        z.number().int().min(1).max(6),
    salle:               z.string().max(50).optional(),
    date_debut_validite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_fin_validite:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier la classe
      const classe = await db('classes as c')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'c.id': req.body.classe_id, 'a.etablissement_id': req.etablissement_id })
        .first('c.id');
      if (!classe) throw ApiError.nonTrouve('Classe introuvable');

      // Vérifier l'affectation
      const affectation = await db('affectations_enseignants')
        .where({ id: req.body.affectation_id, classe_id: req.body.classe_id })
        .first('id');
      if (!affectation) throw ApiError.nonTrouve('Affectation introuvable pour cette classe');

      // Vérifier la plage horaire
      const plage = await db('plages_horaires')
        .where({ id: req.body.plage_id, etablissement_id: req.etablissement_id })
        .first('id');
      if (!plage) throw ApiError.nonTrouve('Plage horaire introuvable');

      // Vérifier qu'il n'y a pas de conflit (même classe, même plage, même jour)
      const conflit = await db('emplois_du_temps')
        .where({
          classe_id: req.body.classe_id, plage_id: req.body.plage_id,
          jour_semaine: req.body.jour_semaine, actif: true,
        })
        .first('id');
      if (conflit) throw ApiError.validationEchouee('Un créneau existe déjà pour cette classe à cette plage horaire');

      const [creneau] = await db('emplois_du_temps')
        .insert({
          id: uuid(),
          classe_id:           req.body.classe_id,
          affectation_id:      req.body.affectation_id,
          plage_id:            req.body.plage_id,
          jour_semaine:        req.body.jour_semaine,
          salle:               req.body.salle || null,
          date_debut_validite: req.body.date_debut_validite || null,
          date_fin_validite:   req.body.date_fin_validite || null,
          actif:               true,
        })
        .returning('*');

      logger.info('Créneau EDT créé', { id: creneau.id, classe_id: req.body.classe_id, jour: req.body.jour_semaine });

      // Invalider le cache EDT classe
      try {
        await invalidatePattern(`edt_classe:${req.body.classe_id}`);
        // Récupérer l'enseignant pour invalider son cache
        const aff = await db('affectations_enseignants').where({ id: req.body.affectation_id }).first('enseignant_id');
        if (aff) await invalidatePattern(`edt_ens:${aff.enseignant_id}`);
      } catch { /* Redis down, pas critique */ }

      return cree(res, creneau);
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// PUT /edt/creneaux/:id — Modifier un créneau
// ═════════════════════════════════════════════════════════════════
router.put('/edt/creneaux/:id', auth, isoler, perm('edt.creer'),
  valider(z.object({
    plage_id:            z.string().uuid().optional(),
    jour_semaine:        z.number().int().min(1).max(6).optional(),
    salle:               z.string().max(50).optional(),
    affectation_id:      z.string().uuid().optional(),
    date_debut_validite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    date_fin_validite:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    actif:               z.boolean().optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier que le créneau existe et appartient à l'établissement
      const creneau = await db('emplois_du_temps as edt')
        .join('classes as c', 'c.id', 'edt.classe_id')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'edt.id': req.params.id, 'a.etablissement_id': req.etablissement_id })
        .first('edt.id', 'edt.classe_id');

      if (!creneau) throw ApiError.nonTrouve('Créneau introuvable');

      const updates = {};
      const champsAutorisees = ['plage_id', 'jour_semaine', 'salle', 'affectation_id', 'date_debut_validite', 'date_fin_validite', 'actif'];
      for (const champ of champsAutorisees) {
        if (req.body[champ] !== undefined) updates[champ] = req.body[champ];
      }

      if (Object.keys(updates).length === 0) throw ApiError.validationEchouee('Aucun champ à modifier');

      const [updated] = await db('emplois_du_temps').where({ id: req.params.id }).update(updates).returning('*');

      logger.info('Créneau EDT modifié', { id: req.params.id, champs: Object.keys(updates) });

      // Invalider le cache EDT classe et enseignant
      try {
        await invalidatePattern(`edt_classe:${creneau.classe_id}`);
        const aff = await db('affectations_enseignants').where({ id: updated.affectation_id }).first('enseignant_id');
        if (aff) await invalidatePattern(`edt_ens:${aff.enseignant_id}`);
      } catch { /* Redis down, pas critique */ }

      return ok(res, updated);
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// DELETE /edt/creneaux/:id — Supprimer (désactiver) un créneau
// ═════════════════════════════════════════════════════════════════
router.delete('/edt/creneaux/:id', auth, isoler, perm('edt.creer'), async (req, res, next) => {
  try {
    const db = getDB();

    const creneau = await db('emplois_du_temps as edt')
      .join('classes as c', 'c.id', 'edt.classe_id')
      .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
      .where({ 'edt.id': req.params.id, 'a.etablissement_id': req.etablissement_id })
      .first('edt.id', 'edt.classe_id', 'edt.affectation_id');

    if (!creneau) throw ApiError.nonTrouve('Créneau introuvable');

    // Soft delete : on désactive
    await db('emplois_du_temps').where({ id: req.params.id }).update({ actif: false });

    logger.info('Créneau EDT supprimé', { id: req.params.id });

    // Invalider le cache EDT
    try {
      await invalidatePattern(`edt_classe:${creneau.classe_id}`);
      const aff = await db('affectations_enseignants').where({ id: creneau.affectation_id }).first('enseignant_id');
      if (aff) await invalidatePattern(`edt_ens:${aff.enseignant_id}`);
    } catch { /* Redis down, pas critique */ }

    return vide(res);
  } catch (err) { next(err); }
});

module.exports = router;
