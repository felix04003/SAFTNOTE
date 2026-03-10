'use strict';

const express  = require('express');
const { z }    = require('zod');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, liste }  = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── Helper : récupérer le profil enseignant depuis la session ────
async function getEnseignantConnecte(db, utilisateurId) {
  const enseignant = await db('enseignants')
    .where({ utilisateur_id: utilisateurId })
    .first('id', 'utilisateur_id', 'matricule_fonct', 'specialite', 'type_contrat');

  if (!enseignant) throw ApiError.nonTrouve('Profil enseignant introuvable');
  return enseignant;
}

// ── Helper : récupérer l'année scolaire courante ─────────────────
async function getAnneeCourante(db, etablissementId) {
  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id', 'libelle');

  if (!annee) throw ApiError.nonTrouve('Aucune annee scolaire courante');
  return annee;
}

// ═════════════════════════════════════════════════════════════════
// GET /enseignants/moi/classes
// Classes de l'enseignant connecte (annee courante)
// ═════════════════════════════════════════════════════════════════
router.get('/enseignants/moi/classes', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const enseignant = await getEnseignantConnecte(db, req.session.utilisateur_id);
    const annee = await getAnneeCourante(db, req.session.etablissement_id);

    const classes = await db('affectations_enseignants as ae')
      .join('classes as c',  'c.id',  'ae.classe_id')
      .join('niveaux as n',  'n.id',  'c.niveau_id')
      .join('matieres as m', 'm.id',  'ae.matiere_id')
      .where({
        'ae.enseignant_id':    enseignant.id,
        'ae.annee_scolaire_id': annee.id,
      })
      .whereNull('ae.date_fin')
      .orderBy(['n.ordre', 'c.nom'])
      .select(
        'ae.id as affectation_id',
        'c.id as classe_id',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        'n.nom as niveau',
        'n.cycle',
        'm.id as matiere_id',
        'm.nom as matiere',
        'm.nom_court as matiere_court',
        'm.code as matiere_code',
        'ae.est_titulaire',
        'c.effectif_max',
        'c.salle_principale'
      );

    // Ajouter l'effectif reel de chaque classe
    const classesAvecEffectif = await Promise.all(
      classes.map(async (cls) => {
        const [{ count }] = await db('inscriptions')
          .where({ classe_id: cls.classe_id, annee_scolaire_id: annee.id, statut: 'actif' })
          .count('id as count');

        return { ...cls, effectif: parseInt(count) };
      })
    );

    return liste(res, classesAvecEffectif, { annee: annee.libelle });

  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /enseignants/moi/edt
// Emploi du temps de l'enseignant connecte (semaine courante)
// ═════════════════════════════════════════════════════════════════
router.get('/enseignants/moi/edt', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const enseignant = await getEnseignantConnecte(db, req.session.utilisateur_id);
    const annee = await getAnneeCourante(db, req.session.etablissement_id);

    // Parametre optionnel : semaine specifique (date ISO)
    const { semaine } = req.query;

    let query = db('emplois_du_temps as edt')
      .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
      .join('classes as c',         'c.id',  'ae.classe_id')
      .join('niveaux as n',         'n.id',  'c.niveau_id')
      .join('matieres as m',        'm.id',  'ae.matiere_id')
      .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
      .where({
        'ae.enseignant_id':     enseignant.id,
        'ae.annee_scolaire_id': annee.id,
        'edt.actif':            true,
      })
      .orderBy(['edt.jour_semaine', 'ph.heure_debut'])
      .select(
        'edt.id as creneau_id',
        'edt.jour_semaine',
        'ph.numero as plage_numero',
        'ph.libelle as plage_libelle',
        'ph.heure_debut',
        'ph.heure_fin',
        'ph.est_pause',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        'c.id as classe_id',
        'm.nom as matiere',
        'm.nom_court as matiere_court',
        'm.code as matiere_code',
        'edt.salle',
        'ae.id as affectation_id'
      );

    // Filtrer par validite si une date de semaine est fournie
    if (semaine) {
      query = query
        .where(function() {
          this.whereNull('edt.date_debut_validite')
            .orWhere('edt.date_debut_validite', '<=', semaine);
        })
        .where(function() {
          this.whereNull('edt.date_fin_validite')
            .orWhere('edt.date_fin_validite', '>=', semaine);
        });
    }

    const creneaux = await query;

    // Organiser par jour pour faciliter l'affichage mobile
    const parJour = {};
    const joursNoms = {
      1: 'Lundi', 2: 'Mardi', 3: 'Mercredi',
      4: 'Jeudi', 5: 'Vendredi', 6: 'Samedi',
    };

    for (const c of creneaux) {
      const jour = c.jour_semaine;
      if (!parJour[jour]) {
        parJour[jour] = { jour: jour, nom: joursNoms[jour], creneaux: [] };
      }
      parJour[jour].creneaux.push(c);
    }

    return ok(res, {
      annee:          annee.libelle,
      nb_creneaux:    creneaux.length,
      emploi_du_temps: Object.values(parJour),
    });

  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /enseignants/:id/affectations
// Affectations d'un enseignant (matieres x classes)
// Accessible par l'enseignant lui-meme, le censeur ou le directeur
// ═════════════════════════════════════════════════════════════════
router.get('/enseignants/:id/affectations', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    const enseignantId = req.params.id;

    // Verifier que l'enseignant existe dans cet etablissement
    const enseignant = await db('enseignants as ens')
      .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
      .where({ 'ens.id': enseignantId, 'u.etablissement_id': req.session.etablissement_id })
      .first('ens.id', 'u.nom', 'u.prenom');

    if (!enseignant) throw ApiError.nonTrouve('Enseignant introuvable');

    // Verifier les droits : soit l'enseignant lui-meme, soit un admin/censeur/directeur
    const estLuiMeme = await db('enseignants')
      .where({ id: enseignantId, utilisateur_id: req.session.utilisateur_id })
      .first('id');

    const rolesAdmin = ['directeur', 'censeur', 'admin', 'super_admin'];
    const estAdmin = req.session.roles.some(r => rolesAdmin.includes(r));

    if (!estLuiMeme && !estAdmin) {
      throw ApiError.interdit('Vous ne pouvez consulter que vos propres affectations');
    }

    // Filtre optionnel par annee scolaire
    const { annee_scolaire_id } = req.query;
    let anneeId = annee_scolaire_id;

    if (!anneeId) {
      const annee = await getAnneeCourante(db, req.session.etablissement_id);
      anneeId = annee.id;
    }

    const affectations = await db('affectations_enseignants as ae')
      .join('classes as c',           'c.id',  'ae.classe_id')
      .join('niveaux as n',           'n.id',  'c.niveau_id')
      .join('matieres as m',          'm.id',  'ae.matiere_id')
      .join('annees_scolaires as a',  'a.id',  'ae.annee_scolaire_id')
      .where({
        'ae.enseignant_id':     enseignantId,
        'ae.annee_scolaire_id': anneeId,
      })
      .orderBy(['n.ordre', 'c.nom', 'm.nom'])
      .select(
        'ae.id as affectation_id',
        'c.id as classe_id',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        'n.nom as niveau',
        'n.cycle',
        'm.id as matiere_id',
        'm.nom as matiere',
        'm.code as matiere_code',
        'ae.est_titulaire',
        'ae.date_debut',
        'ae.date_fin',
        'a.libelle as annee_scolaire'
      );

    return liste(res, affectations, {
      enseignant: `${enseignant.prenom} ${enseignant.nom}`,
    });

  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// PUT /enseignants/:id
// Modifier le profil d'un enseignant
// L'enseignant peut modifier ses propres infos de contact
// Le directeur/censeur peut modifier les infos administratives
// ═════════════════════════════════════════════════════════════════
router.put('/enseignants/:id', auth, isoler,
  valider(z.object({
    // Infos de contact (modifiables par l'enseignant)
    telephone:        z.string().min(8).max(20).optional(),
    telephone_2:      z.string().min(8).max(20).optional(),
    email:            z.string().email().optional(),
    adresse:          z.string().optional(),
    quartier:         z.string().optional(),
    ville:            z.string().optional(),
    photo_url:        z.string().url().optional(),
    // Infos administratives (modifiables par directeur/censeur uniquement)
    specialite:       z.string().optional(),
    type_contrat:     z.enum(['titulaire', 'vacataire', 'contractuel', 'benevole']).optional(),
    matricule_fonct:  z.string().optional(),
    date_prise_service: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_fin_contrat:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();
      const enseignantId = req.params.id;

      // Verifier que l'enseignant existe dans cet etablissement
      const enseignant = await db('enseignants as ens')
        .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
        .where({ 'ens.id': enseignantId, 'u.etablissement_id': req.session.etablissement_id })
        .first('ens.id', 'ens.utilisateur_id', 'u.nom', 'u.prenom');

      if (!enseignant) throw ApiError.nonTrouve('Enseignant introuvable');

      // Verifier les droits
      const estLuiMeme = enseignant.utilisateur_id === req.session.utilisateur_id;
      const rolesAdmin = ['directeur', 'censeur', 'admin', 'super_admin'];
      const estAdmin = req.session.roles.some(r => rolesAdmin.includes(r));

      if (!estLuiMeme && !estAdmin) {
        throw ApiError.interdit('Vous ne pouvez modifier que votre propre profil');
      }

      // Separer les champs utilisateur et enseignant
      const champsUtilisateur = {};
      const champsEnseignant = {};

      // Champs contact -> table utilisateurs (modifiables par l'enseignant)
      const champsMappingUtilisateur = [
        'telephone', 'telephone_2', 'email', 'adresse',
        'quartier', 'ville', 'photo_url',
      ];

      // Champs admin -> table enseignants (directeur/censeur uniquement)
      const champsMappingEnseignant = [
        'specialite', 'type_contrat', 'matricule_fonct',
        'date_prise_service', 'date_fin_contrat',
      ];

      for (const champ of champsMappingUtilisateur) {
        if (req.body[champ] !== undefined) {
          champsUtilisateur[champ] = req.body[champ];
        }
      }

      for (const champ of champsMappingEnseignant) {
        if (req.body[champ] !== undefined) {
          // Seuls les admins peuvent modifier ces champs
          if (!estAdmin) {
            throw ApiError.interdit(
              `Seul un directeur ou censeur peut modifier le champ "${champ}"`
            );
          }
          champsEnseignant[champ] = req.body[champ];
        }
      }

      // Verifier qu'il y a quelque chose a modifier
      if (Object.keys(champsUtilisateur).length === 0 && Object.keys(champsEnseignant).length === 0) {
        throw ApiError.validationEchouee('Aucun champ a modifier');
      }

      // Executer les mises a jour dans une transaction
      await db.transaction(async trx => {
        if (Object.keys(champsUtilisateur).length > 0) {
          await trx('utilisateurs')
            .where({ id: enseignant.utilisateur_id })
            .update(champsUtilisateur);
        }

        if (Object.keys(champsEnseignant).length > 0) {
          await trx('enseignants')
            .where({ id: enseignantId })
            .update(champsEnseignant);
        }
      });

      // Recharger le profil complet
      const profil = await db('enseignants as ens')
        .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
        .where({ 'ens.id': enseignantId })
        .first(
          'ens.id',
          'u.id as utilisateur_id',
          'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre',
          'u.telephone', 'u.telephone_2', 'u.email',
          'u.adresse', 'u.quartier', 'u.ville', 'u.photo_url',
          'ens.matricule_fonct', 'ens.specialite',
          'ens.type_contrat', 'ens.date_prise_service', 'ens.date_fin_contrat'
        );

      logger.info('Profil enseignant modifie', {
        enseignant_id: enseignantId,
        modifie_par:   req.session.utilisateur_id,
        champs:        [
          ...Object.keys(champsUtilisateur),
          ...Object.keys(champsEnseignant),
        ],
      });

      return ok(res, profil);

    } catch (err) { next(err); }
  }
);

// ── GET /enseignants — Liste admin (directeur / censeur) ─────────
router.get('/enseignants', auth, isoler, perm('enseignants.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id');

    const enseignants = await db('enseignants as ens')
      .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
      .where({ 'u.etablissement_id': req.etablissement_id, 'u.actif': true })
      .orderBy(['u.nom', 'u.prenom'])
      .select(
        'u.id', 'u.nom', 'u.prenom', 'u.email', 'u.telephone',
        'ens.id as enseignant_id', 'ens.specialite', 'ens.matricule_fonct', 'ens.type_contrat',
        db.raw(`(
          SELECT string_agg(DISTINCT m.nom, ', ')
          FROM affectations_enseignants ae
          JOIN matieres m ON m.id = ae.matiere_id
          WHERE ae.enseignant_id = ens.id
            ${annee ? 'AND ae.annee_scolaire_id = ?' : ''}
        ) as matieres_assignees`, annee ? [annee.id] : []),
        db.raw(`(
          SELECT COUNT(DISTINCT ae.classe_id)
          FROM affectations_enseignants ae
          WHERE ae.enseignant_id = ens.id
            ${annee ? 'AND ae.annee_scolaire_id = ?' : ''}
        ) as nb_classes`, annee ? [annee.id] : [])
      );

    return liste(res, enseignants);
  } catch (err) { next(err); }
});

module.exports = router;
