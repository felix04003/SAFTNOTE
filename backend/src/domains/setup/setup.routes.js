'use strict';

/**
 * Routes publiques :
 *  POST /setup         — initialisation (1ère école uniquement, bloqué ensuite)
 *  POST /inscription   — création d'un nouvel établissement (toujours ouvert)
 *  GET  /setup/status  — vérifie si le premier setup est nécessaire
 *  GET  /dashboard     — stats agrégées de l'établissement (authentifié)
 */

const express  = require('express');
const { z }    = require('zod');
const bcrypt   = require('bcryptjs');
const { v4: uuid } = require('uuid');

const { getDB }    = require('../../infrastructure/database/pool');
const { valider }  = require('../../middleware/validate.middleware');
const { cree }     = require('../../utils/reponse');
const ApiError     = require('../../utils/ApiError');
const logger       = require('../../utils/logger');

const router = express.Router();

const schemaSetup = z.object({
  etablissement: z.object({
    nom:           z.string().min(2),
    code_officiel: z.string().min(2).max(20).regex(/^[A-Z0-9_-]+$/, 'Code : lettres majuscules, chiffres, tirets uniquement'),
    type:          z.enum(['ecole_primaire', 'college', 'lycee', 'universite', 'formation_pro']).default('lycee'),
    pays:          z.string().min(2).default('SN'),
    ville:         z.string().optional(),
    telephone:     z.string().optional(),
    email:         z.string().email().optional(),
  }),
  directeur: z.object({
    nom:          z.string().min(2),
    prenom:       z.string().min(2),
    email:        z.string().email(),
    telephone:    z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro invalide'),
    mot_de_passe: z.string().min(8, 'Minimum 8 caractères'),
  }),
  annee_scolaire: z.object({
    libelle:      z.string().min(4),
    date_debut:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_fin:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    nb_periodes:  z.number().int().refine(n => n === 2 || n === 3).default(3),
    type_periode: z.enum(['trimestre', 'semestre']).default('trimestre'),
  }).optional(),
});

/**
 * Divise une année scolaire en périodes de durée égale.
 */
function calculerPeriodes(dateDebutStr, dateFinStr, nbPeriodes, typePeriode) {
  const debut    = new Date(dateDebutStr);
  const fin      = new Date(dateFinStr);
  const totalMs  = fin - debut;
  const periodeMs = totalMs / nbPeriodes;

  return Array.from({ length: nbPeriodes }, (_, i) => {
    const pDebut = new Date(debut.getTime() + i * periodeMs);
    const pFin   = i === nbPeriodes - 1
      ? fin
      : new Date(debut.getTime() + (i + 1) * periodeMs - 86400000);
    const label  = typePeriode === 'semestre' ? `Semestre ${i + 1}` : `Trimestre ${i + 1}`;
    return {
      numero:     i + 1,
      libelle:    label,
      date_debut: pDebut.toISOString().slice(0, 10),
      date_fin:   pFin.toISOString().slice(0, 10),
    };
  });
}

// ── POST /setup — Initialisation première école + directeur ──────
router.post('/setup', valider(schemaSetup), async (req, res, next) => {
  const db = getDB();

  try {
    // Vérifier qu'aucun établissement réel n'existe encore
    const nbEtab = await db('etablissements')
      .where({ actif: true })
      .whereNot({ pays: 'REFERENTIEL' })
      .count('id as total')
      .first();

    if (parseInt(nbEtab.total) > 0) {
      throw ApiError.nonAutorise(
        'Un établissement existe déjà. Contactez votre administrateur pour créer des comptes.'
      );
    }

    const { etablissement: etabData, directeur: dirData, annee_scolaire: anneeData } = req.body;

    // Vérifier unicité du code
    const codeExiste = await db('etablissements')
      .where({ code_officiel: etabData.code_officiel })
      .first('id');
    if (codeExiste) {
      throw ApiError.conflit('Ce code établissement est déjà utilisé.');
    }

    await db.transaction(async trx => {
      // 1. Créer l'établissement
      const etabId = uuid();
      const [etab] = await trx('etablissements').insert({
        id:            etabId,
        nom:           etabData.nom,
        code_officiel: etabData.code_officiel,
        type:          etabData.type,
        pays:          etabData.pays,
        ville:         etabData.ville || null,
        telephone:     etabData.telephone || null,
        email:         etabData.email || null,
        actif:         true,
      }).returning('*');

      // 2. Config système de notes par défaut
      await trx('configs_systeme_notes')
        .insert({ etablissement_id: etabId })
        .onConflict('etablissement_id').ignore();

      // 3. Créer l'utilisateur directeur
      const motDePasseHash = await bcrypt.hash(dirData.mot_de_passe, 12);
      const utilisateurId  = uuid();

      await trx('utilisateurs').insert({
        id:                utilisateurId,
        etablissement_id:  etabId,
        nom:               dirData.nom,
        prenom:            dirData.prenom,
        email:             dirData.email,
        telephone:         dirData.telephone,
        mot_de_passe_hash: motDePasseHash,
        actif:             true,
      });

      // 4. Récupérer le role_id du directeur
      const role = await trx('roles').where({ code: 'directeur' }).first('id');
      if (!role) throw new Error('Rôle directeur introuvable — vérifiez les migrations.');

      // 5. Affecter le rôle directeur
      await trx('utilisateur_roles').insert({
        utilisateur_id:   utilisateurId,
        role_id:          role.id,
        etablissement_id: etabId,
        actif:            true,
      });

      // 6. Créer l'année scolaire + périodes si fournie
      let anneeId = null;
      if (anneeData) {
        const [annee] = await trx('annees_scolaires').insert({
          etablissement_id: etabId,
          libelle:          anneeData.libelle,
          date_debut:       anneeData.date_debut,
          date_fin:         anneeData.date_fin,
          nb_periodes:      anneeData.nb_periodes,
          type_periode:     anneeData.type_periode,
          est_courante:     true,
        }).returning('id');
        anneeId = annee.id;

        const periodes = calculerPeriodes(
          anneeData.date_debut,
          anneeData.date_fin,
          anneeData.nb_periodes,
          anneeData.type_periode
        );
        await trx('periodes').insert(
          periodes.map(p => ({ ...p, annee_scolaire_id: anneeId }))
        );
      }

      logger.info('Setup initial terminé', {
        etablissement_id:   etabId,
        etablissement_code: etabData.code_officiel,
        directeur_id:       utilisateurId,
      });

      return cree(res, {
        message:    'Établissement et compte directeur créés avec succès.',
        etablissement: {
          id:            etab.id,
          nom:           etab.nom,
          code_officiel: etab.code_officiel,
        },
        connexion: {
          identifiant:        dirData.email,
          etablissement_code: etabData.code_officiel,
          note:               'Utilisez ces identifiants pour vous connecter.',
        },
      });
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /inscription — Créer un nouvel établissement (toujours ouvert) ─
router.post('/inscription', valider(schemaSetup), async (req, res, next) => {
  const db = getDB();
  const { etablissement: etabData, directeur: dirData } = req.body;

  try {
    // Vérifier unicité du code
    const codeExiste = await db('etablissements')
      .where({ code_officiel: etabData.code_officiel })
      .first('id');
    if (codeExiste) {
      throw ApiError.conflit('Ce code établissement est déjà utilisé. Choisissez un autre code.');
    }

    // Vérifier unicité de l'email directeur (global)
    const emailExiste = await db('utilisateurs').where({ email: dirData.email }).first('id');
    if (emailExiste) {
      throw ApiError.conflit('Cet email est déjà associé à un compte existant.');
    }

    await db.transaction(async trx => {
      const etabId = uuid();
      const [etab] = await trx('etablissements').insert({
        id:            etabId,
        nom:           etabData.nom,
        code_officiel: etabData.code_officiel,
        type:          etabData.type,
        pays:          etabData.pays,
        ville:         etabData.ville || null,
        telephone:     etabData.telephone || null,
        email:         etabData.email || null,
        actif:         true,
      }).returning('*');

      await trx('configs_systeme_notes')
        .insert({ etablissement_id: etabId })
        .onConflict('etablissement_id').ignore();

      const motDePasseHash = await bcrypt.hash(dirData.mot_de_passe, 12);
      const utilisateurId  = uuid();

      await trx('utilisateurs').insert({
        id:                utilisateurId,
        etablissement_id:  etabId,
        nom:               dirData.nom,
        prenom:            dirData.prenom,
        email:             dirData.email,
        telephone:         dirData.telephone,
        mot_de_passe_hash: motDePasseHash,
        actif:             true,
      });

      const role = await trx('roles').where({ code: 'directeur' }).first('id');
      if (!role) throw new Error('Rôle directeur introuvable — vérifiez les migrations.');

      await trx('utilisateur_roles').insert({
        utilisateur_id:   utilisateurId,
        role_id:          role.id,
        etablissement_id: etabId,
        actif:            true,
      });

      logger.info('Inscription nouvel établissement', {
        etablissement_id:   etabId,
        etablissement_code: etabData.code_officiel,
        directeur_id:       utilisateurId,
      });

      return cree(res, {
        message: 'Votre école est créée. Vous pouvez maintenant vous connecter.',
        etablissement: {
          id:            etab.id,
          nom:           etab.nom,
          code_officiel: etab.code_officiel,
          type:          etab.type,
          pays:          etab.pays,
        },
        connexion: {
          identifiant:        dirData.email,
          etablissement_code: etabData.code_officiel,
          note:               'Utilisez ces identifiants pour vous connecter sur EcoleManager.',
        },
      });
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /setup/status — Savoir si le setup est nécessaire ────────
router.get('/setup/status', async (req, res, next) => {
  try {
    const nbEtab = await getDB()('etablissements')
      .where({ actif: true })
      .whereNot({ pays: 'REFERENTIEL' })
      .count('id as total')
      .first();

    const setupNecessaire = parseInt(nbEtab.total) === 0;
    res.json({ succes: true, data: { setup_necessaire: setupNecessaire } });
  } catch (err) {
    next(err);
  }
});

// ── GET /dashboard — Stats réelles de l'établissement ────────────
const { authentifier }        = require('../../middleware/auth.middleware');
const { isolerEtablissement, exigerPermission } = require('../../middleware/permission.middleware');
const { ok }                  = require('../../utils/reponse');

router.get('/dashboard', authentifier, isolerEtablissement, exigerPermission('rapports.voir'), async (req, res, next) => {
  try {
    const db     = getDB();
    const etabId = req.etablissement_id;

    const result = await db.raw(
      'SELECT get_dashboard_etablissement(?) AS stats',
      [etabId]
    );
    const stats = result.rows[0]?.stats || {};

    // Compléter les champs absents de la fonction PG
    if (stats.annee_id) {
      const annee = await db('annees_scolaires')
        .where('id', stats.annee_id)
        .first('libelle');
      stats.annee_courante = annee?.libelle || null;

      // Moyenne générale sur toutes les moyennes calculées de l'année
      const moyRes = await db('moyennes_generales as mg')
        .join('inscriptions as i', 'i.id', 'mg.inscription_id')
        .join('classes as c', 'c.id', 'i.classe_id')
        .where('c.annee_scolaire_id', stats.annee_id)
        .whereNotNull('mg.moyenne_generale')
        .avg('mg.moyenne_generale as moy')
        .first();
      stats.moyenne_generale = moyRes?.moy ? parseFloat(moyRes.moy).toFixed(2) : null;
    }

    return ok(res, stats);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
