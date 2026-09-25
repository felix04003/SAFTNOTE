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
    // Mot de passe fort obligatoire à la création (audit 2026-09) : la
    // création de compte n'appliquait auparavant aucune règle de
    // complexité (seulement une longueur minimale), contrairement à la
    // réinitialisation de mot de passe qui utilise déjà validerMotDePasse()
    // dans auth.routes.js. Même exigence ici : au moins une majuscule, une
    // minuscule et un chiffre.
    mot_de_passe: z.string()
      .min(8, 'Minimum 8 caractères')
      .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
      .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
      .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre'),
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
 * Schéma du self-service /inscription (fusion parcours 1 + parcours 2,
 * audit 2026-09) — distinct de schemaSetup, réservé au bootstrap interne
 * /setup (jamais appelé depuis l'UI). Contrairement à schemaSetup :
 *   - Pas de code_officiel : généré côté serveur (genererCodeUnique), pour
 *     ne plus demander à un utilisateur self-service de choisir un
 *     identifiant technique unique système.
 *   - Pas d'annee_scolaire : l'année scolaire courante est calculée et
 *     créée automatiquement (comme le faisait déjà /etablissements/register
 *     dans auth.routes.js), au lieu de la demander dans le wizard.
 *   - Pas d'etablissement.email : un seul email est désormais demandé (celui
 *     du directeur, à l'étape 2 du wizard), pour éviter de le demander deux
 *     fois dans le même parcours.
 */
const schemaInscription = z.object({
  etablissement: z.object({
    nom:       z.string().min(2),
    type:      z.enum(['ecole_primaire', 'college', 'lycee', 'universite', 'formation_pro']).default('lycee'),
    pays:      z.string().min(2).default('SN'),
    ville:     z.string().optional(),
    telephone: z.string().optional(),
  }),
  directeur: z.object({
    nom:          z.string().min(2),
    prenom:       z.string().min(2),
    email:        z.string().email(),
    telephone:    z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro invalide'),
    mot_de_passe: z.string()
      .min(8, 'Minimum 8 caractères')
      .regex(/[a-z]/, 'Le mot de passe doit contenir au moins une minuscule')
      .regex(/[A-Z]/, 'Le mot de passe doit contenir au moins une majuscule')
      .regex(/[0-9]/, 'Le mot de passe doit contenir au moins un chiffre'),
  }),
});

// Niveaux créés par défaut pour toute nouvelle école self-service — repris
// tel quel du parcours /etablissements/register (auth.routes.js), qui
// insère toujours ces 7 niveaux quel que soit le type d'établissement
// choisi (limitation préexistante, hors du périmètre de cette fusion).
const NIVEAUX_DEFAUT = [
  { nom: '6ème',      nom_court: '6e',   ordre: 1, cycle: 'college' },
  { nom: '5ème',      nom_court: '5e',   ordre: 2, cycle: 'college' },
  { nom: '4ème',      nom_court: '4e',   ordre: 3, cycle: 'college' },
  { nom: '3ème',      nom_court: '3e',   ordre: 4, cycle: 'college' },
  { nom: '2nde',      nom_court: '2nde', ordre: 5, cycle: 'lycee'   },
  { nom: '1ère',      nom_court: '1ere', ordre: 6, cycle: 'lycee'   },
  { nom: 'Terminale', nom_court: 'Tle',  ordre: 7, cycle: 'lycee'   },
];

/**
 * Génère un code établissement unique (initiales du nom + ville + 4 chiffres
 * aléatoires, ex. LBD-DAKAR-4821), avec vérification d'unicité en base et
 * plusieurs tentatives en cas de collision — auth.routes.js ne fait, lui,
 * aucune vérification avant insert (repose uniquement sur la contrainte
 * UNIQUE en base + le handler d'erreur Postgres 23505). Ici on vérifie
 * explicitement avant insertion pour renvoyer une erreur claire plutôt que
 * de dépendre du hasard d'un conflit non prévu par l'appelant.
 */
async function genererCodeUnique(db, nom, ville) {
  const initiales = nom.trim().split(/\s+/).slice(0, 3).map(w => w[0].toUpperCase()).join('');
  const villeSlug = (ville || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'ECOLE';

  for (let tentative = 0; tentative < 5; tentative++) {
    const rand4 = String(Math.floor(1000 + Math.random() * 9000));
    const code  = `${initiales}-${villeSlug}-${rand4}`;
    const existe = await db('etablissements').where({ code_officiel: code }).first('id');
    if (!existe) return code;
  }
  throw new Error('Impossible de générer un code établissement unique — réessayez.');
}

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
router.post('/inscription', valider(schemaInscription), async (req, res, next) => {
  const db = getDB();
  const { etablissement: etabData, directeur: dirData } = req.body;

  try {
    // Vérifier unicité de l'email directeur (global)
    const emailExiste = await db('utilisateurs').where({ email: dirData.email }).first('id');
    if (emailExiste) {
      throw ApiError.conflit('Cet email est déjà associé à un compte existant.');
    }

    const codeOfficiel = await genererCodeUnique(db, etabData.nom, etabData.ville);

    // Année scolaire courante calculée automatiquement (règle sept.→juil.,
    // identique à l'ancien parcours /etablissements/register), sans la
    // demander dans le wizard.
    const now   = new Date();
    const annee = now.getMonth() >= 7
      ? `${now.getFullYear()}-${now.getFullYear() + 1}`
      : `${now.getFullYear() - 1}-${now.getFullYear()}`;
    const [anneeStartYear] = annee.split('-').map(Number);
    const anneeDateDebut = `${anneeStartYear}-09-01`;
    const anneeDateFin   = `${anneeStartYear + 1}-07-31`;
    const periodes = calculerPeriodes(anneeDateDebut, anneeDateFin, 3, 'trimestre');

    await db.transaction(async trx => {
      const etabId = uuid();
      const [etab] = await trx('etablissements').insert({
        id:            etabId,
        nom:           etabData.nom,
        code_officiel: codeOfficiel,
        type:          etabData.type,
        pays:          etabData.pays,
        ville:         etabData.ville || null,
        telephone:     etabData.telephone || null,
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

      const [anneeRow] = await trx('annees_scolaires').insert({
        etablissement_id: etabId,
        libelle:          annee,
        date_debut:       anneeDateDebut,
        date_fin:         anneeDateFin,
        nb_periodes:      3,
        type_periode:     'trimestre',
        est_courante:     true,
      }).returning('id');

      await trx('periodes').insert(
        periodes.map(p => ({ ...p, annee_scolaire_id: anneeRow.id }))
      );

      await trx('niveaux').insert(
        NIVEAUX_DEFAUT.map(n => ({ id: uuid(), etablissement_id: etabId, actif: true, ...n }))
      );

      logger.info('Inscription nouvel établissement', {
        etablissement_id:   etabId,
        etablissement_code: codeOfficiel,
        directeur_id:       utilisateurId,
        annee_scolaire:     annee,
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
          etablissement_code: codeOfficiel,
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
