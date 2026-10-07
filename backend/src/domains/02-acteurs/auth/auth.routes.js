'use strict';

const express     = require('express');
const rateLimit   = require('express-rate-limit');
const { z }       = require('zod');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const crypto      = require('crypto');
const { v4: uuid} = require('uuid');

const { getDB }         = require('../../../infrastructure/database/pool');
const { envoyerOTP }    = require('../../../infrastructure/notifications/sms.service');
const { valider }       = require('../../../middleware/validate.middleware');
const { authentifier }  = require('../../../middleware/auth.middleware');
const ApiError          = require('../../../utils/ApiError');
const { ok }            = require('../../../utils/reponse');
const logger            = require('../../../utils/logger');
const { getOrSet } = require('../../../infrastructure/cache/redis');

const {
  normaliserTelephone, variantesTelephone, ressembleATelephone,
} = require('../../../utils/telephone');
const { schemaMotDePasse, exigerMotDePasseConforme } = require('../../../utils/mot-de-passe');

const router = express.Router();
/**
 * Filtre knex « identifiant » = email, ou téléphone. Un numéro est comparé sous
 * toutes ses formes connues (E.164, sans « + », national, tel que saisi) pour
 * retrouver aussi les comptes créés avant la normalisation.
 */
function filtreIdentifiant(identifiant, pays) {
  return function () {
    this.where('email', identifiant);
    if (ressembleATelephone(identifiant)) {
      this.orWhere(function () { this.whereIn('telephone', variantesTelephone(identifiant, pays)); });
    } else {
      this.orWhere('telephone', identifiant);
    }
  };
}

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

/**
 * Envoie un code OTP par SMS, ou le logue en développement/test si Africa's
 * Talking n'est pas configuré (lot E, finding E1 audit 2026-09).
 *
 * Sans AT_API_KEY, en dehors des environnements explicitement sûrs
 * (development, test) : ne JAMAIS construire de message de log contenant
 * le code — ces logs sont accessibles à quiconque a accès aux journaux
 * applicatifs (Render/CloudWatch/etc.), souvent moins protégés que la base
 * de données. On lève une 503 explicite plutôt que de fuiter le code.
 * Volontairement une liste blanche (et non `NODE_ENV === 'production'` en
 * négatif) : un staging/préprod, ou un NODE_ENV vide/mal orthographié, doit
 * tomber du côté "ne pas logguer" par défaut, pas du côté "logguer".
 *
 * Note : `env.js` (`validateEnv()`, appelé au boot dans `app.js`) rend déjà
 * AT_API_KEY/AT_USERNAME obligatoires en production — le serveur ne démarre
 * donc normalement jamais dans cet état. Cette vérification est une
 * deuxième ligne de défense (contournement de validateEnv, appel direct de
 * la route dans un test qui ne passe pas par `start()`, etc.).
 *
 * @param {string} telephone - Numéro international du destinataire
 * @param {string} code      - Code OTP à 6 chiffres (jamais loggué hors dev/test)
 * @param {string} libelle   - Nom affiché dans le SMS (établissement, contexte)
 * @throws {ApiError} 503 SMS_INDISPONIBLE hors development/test sans AT_API_KEY
 */
async function envoyerOuLoggerOTP(telephone, code, libelle) {
  const ENVIRONNEMENTS_LOG_AUTORISE = ['development', 'test'];

  if (!process.env.AT_API_KEY) {
    if (!ENVIRONNEMENTS_LOG_AUTORISE.includes(process.env.NODE_ENV)) {
      throw ApiError.serviceIndisponible(
        'Service SMS indisponible — réessayez plus tard',
        'SMS_INDISPONIBLE'
      );
    }
    // Dev/test uniquement : logguer le code plutôt que de tenter un envoi
    // réel qui échouera toujours faute de credentials.
    logger.warn('⚠️  SMS non configuré — CODE OTP (dev/test uniquement) : ' + code, { telephone });
    return;
  }

  await envoyerOTP(telephone, code, libelle);
}

// Rate limiting strict sur les routes d'auth
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  message:  { succes: false, erreur: 'Trop de tentatives — réessayez dans 15 minutes', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// Rate limiting dédié à /auth/refresh — instance distincte de limiterAuth
// (bucket séparé par IP) : un token expiré sur une IP partagée (NAT école)
// déclenchant plusieurs refresh concurrents ne doit pas épuiser le quota
// de /auth/connexion pour tous les utilisateurs derrière cette IP.
const limiterRefresh = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      parseInt(process.env.RATE_LIMIT_REFRESH_MAX) || parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  message:  { succes: false, erreur: 'Trop de tentatives — réessayez dans 15 minutes', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Schémas de validation ────────────────────────────────────────
const schemaMotDePasseOublie = z.object({
  identifiant:        z.string().min(3), // email ou téléphone
  etablissement_code: z.string().min(2),
});

const schemaReinitialiserMotDePasse = z.object({
  identifiant:        z.string().min(3),
  etablissement_code: z.string().min(2),
  code:               z.string().length(6).regex(/^\d{6}$/),
  nouveau_mot_de_passe: schemaMotDePasse,
});

const schemaConnexion = z.object({
  identifiant:     z.string().min(3),   // email ou téléphone
  mot_de_passe:    z.string().min(6),
  etablissement_code: z.string().min(2),
});

const schemaOtpDemander = z.object({
  telephone:          z.string().min(6, 'Numéro invalide').max(25, 'Numéro invalide'),
  etablissement_code: z.string().min(2),
});

const schemaOtpValider = z.object({
  telephone:          z.string().min(6).max(25),
  code:               z.string().length(6).regex(/^\d{6}$/),
  etablissement_code: z.string().min(2),
});

const schemaRefresh = z.object({
  refresh_token: z.string().min(1, 'Refresh token manquant'),
});

// ── POST /auth/connexion — Connexion mot de passe ────────────────
router.post('/auth/connexion', limiterAuth, valider(schemaConnexion), async (req, res, next) => {
  const { identifiant, mot_de_passe, etablissement_code } = req.body;
  const db = getDB();
  const ip = req.ip;

  try {
    // 1. Trouver l'établissement (avant le contrôle de blocage : la politique
    //    de blocage est celle de CET établissement)
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom', 'pays');

    // 2. Vérifier blocage force brute — politique de l'établissement, ou
    //    valeurs par défaut strictes si le code est inconnu (un code inconnu
    //    ne doit pas permettre de tester des mots de passe sans limite)
    const bloque = await db.raw(
      'SELECT est_compte_bloque(?, ?, ?) AS bloque',
      [identifiant, ip, etablissement ? etablissement.id : null]
    );
    if (bloque.rows[0]?.bloque) {
      throw ApiError.compteBloque('Trop de tentatives — réessayez dans quelques minutes');
    }

    if (!etablissement) {
      try {
        await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'etablissement_inconnu' });
      } catch (logErr) {
        // Log silently — ne pas bloquer la réponse
        logger.warn('tentatives_connexion insert failed', { err: logErr.message });
      }
      throw ApiError.nonAutorise('Établissement inconnu ou inactif');
    }

    // 3. Trouver l'utilisateur
    const utilisateur = await db('utilisateurs')
      .where({ etablissement_id: etablissement.id, actif: true })
      .andWhere(filtreIdentifiant(identifiant, etablissement.pays))
      .first('id', 'nom', 'prenom', 'mot_de_passe_hash', 'email', 'mdp_a_changer');

    if (!utilisateur || !utilisateur.mot_de_passe_hash) {
      try {
        await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'compte_inexistant' });
      } catch (logErr) {
        // Log silently — ne pas bloquer la réponse
        logger.warn('tentatives_connexion insert failed', { err: logErr.message });
      }
      throw ApiError.nonAutorise('Identifiants incorrects');
    }

    // 4. Vérifier le mot de passe
    const motDePasseValide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe_hash);
    if (!motDePasseValide) {
      try {
        await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'mot_de_passe_incorrect' });
      } catch (logErr) {
        // Log silently — ne pas bloquer la réponse
        logger.warn('tentatives_connexion insert failed', { err: logErr.message });
      }
      throw ApiError.nonAutorise('Identifiants incorrects');
    }

    // 5. Créer la session
    const { token, refreshToken } = await creerSession(db, utilisateur.id, etablissement.id, req);

    // 6. Charger le rôle principal
    const roleRow = await db('utilisateur_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'ur.utilisateur_id': utilisateur.id, 'ur.etablissement_id': etablissement.id, 'ur.actif': true })
      .first('r.code', 'r.libelle');

    // 7. Logger la tentative réussie
    try {
      await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: true });
    } catch (logErr) {
      // Log silently — ne pas bloquer la réponse
      logger.warn('tentatives_connexion insert failed', { err: logErr.message });
    }

    logger.info('Connexion réussie', { utilisateur_id: utilisateur.id, etablissement_id: etablissement.id });

    return ok(res, {
      token,
      refresh_token: refreshToken,
      utilisateur: {
        id:              utilisateur.id,
        nom:             utilisateur.nom,
        prenom:          utilisateur.prenom,
        email:           utilisateur.email,
        role:            roleRow?.code || 'utilisateur',
        doit_changer_mdp: !!utilisateur.mdp_a_changer,
        etablissement_id: etablissement.id,
        etablissement_nom: etablissement.nom,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ── POST /auth/otp/demander — Demander un OTP SMS (parents) ─────
router.post('/auth/otp/demander', limiterAuth, valider(schemaOtpDemander), async (req, res, next) => {
  const { etablissement_code } = req.body;
  const db = getDB();

  try {
    // Trouver l'établissement
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom', 'pays');

    if (!etablissement) throw ApiError.nonAutorise('Établissement inconnu');

    // Numéro normalisé (E.164) : c'est celui qui reçoit le SMS et qui sert
    // de clé à l'OTP, quelle que soit la façon dont il a été saisi.
    const telephone = normaliserTelephone(req.body.telephone, etablissement.pays);
    if (!telephone) throw ApiError.validationEchouee('Numéro invalide — format attendu : +221 77 123 45 67');

    // Vérifier que l'utilisateur existe (parent), y compris sous une forme
    // historique non normalisée
    const utilisateur = await db('utilisateurs')
      .whereIn('telephone', variantesTelephone(req.body.telephone, etablissement.pays))
      .where({ etablissement_id: etablissement.id, actif: true })
      .first('id');

    // On ne révèle pas si le compte existe (anti-enumération)
    if (!utilisateur) {
      // Simuler un délai pour éviter la détection par timing
      await new Promise(r => setTimeout(r, 800));
      return ok(res, { message: 'Si ce numéro est connu, vous allez recevoir un code' });
    }

    // Générer le code OTP à 6 chiffres
    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Invalider les anciens OTP de CE COMPTE (et non de tout le numéro : le même
    // numéro peut avoir un compte dans plusieurs établissements, et demander un
    // code pour l'école B ne doit pas annuler celui de l'école A)
    await db('otp_verifications')
      .where({ telephone, utilisateur_id: utilisateur.id, utilise: false })
      .update({ utilise: true });

    // Insérer le nouveau OTP
    await db('otp_verifications').insert({
      id:            uuid(),
      telephone,
      code_hash:     codeHash,
      objectif:      'connexion',
      utilisateur_id: utilisateur.id,
      expire_at:     db.raw("NOW() + INTERVAL '10 minutes'"),
    });

    // Envoi SMS réel si AT_API_KEY est configurée ; sinon logué en dev/test
    // uniquement — jamais en production (503 SMS_INDISPONIBLE, voir
    // envoyerOuLoggerOTP, lot E). L'ancienne condition
    // (NODE_ENV==='test' uniquement) laissait passer un vrai appel réseau
    // en dev normal, dont l'échec (réponse gateway non-JSON) faisait fuiter
    // son message brut tel quel dans la réponse HTTP — affiché littéralement
    // dans la bannière d'erreur de l'app.
    try {
      await envoyerOuLoggerOTP(telephone, code, etablissement.nom);
    } catch (smsErr) {
      if (smsErr.isApiError) throw smsErr; // ex: SMS_INDISPONIBLE (503)
      logger.error('Échec envoi SMS OTP', { telephone, error: smsErr.message });
      throw ApiError.erreurServeur('Échec de l\'envoi du SMS — réessayez dans quelques instants.');
    }

    logger.info('OTP envoyé', { telephone, etablissement_id: etablissement.id });

    return ok(res, { message: 'Code envoyé par SMS. Valable 10 minutes.' });

  } catch (err) {
    next(err);
  }
});

// ── POST /auth/otp/valider — Valider un OTP et créer session ────
router.post('/auth/otp/valider', limiterAuth, valider(schemaOtpValider), async (req, res, next) => {
  const { code, etablissement_code } = req.body;
  const db = getDB();

  try {
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom', 'pays');

    if (!etablissement) throw ApiError.otpInvalide();

    const telephone = normaliserTelephone(req.body.telephone, etablissement.pays);
    if (!telephone) throw ApiError.otpInvalide('Code invalide, expiré ou trop de tentatives');

    // Le compte de CET établissement porteur de ce numéro : les codes, leurs
    // tentatives et leur validation sont propres à ce compte (le même numéro
    // peut exister dans plusieurs établissements). Même réponse que pour un
    // code faux : ne pas révéler si le numéro existe ici.
    const compte = await db('utilisateurs')
      .whereIn('telephone', variantesTelephone(req.body.telephone, etablissement.pays))
      .where({ etablissement_id: etablissement.id, actif: true })
      .first('id');
    if (!compte) throw ApiError.otpInvalide('Code invalide, expiré ou trop de tentatives');

    // Incrémenter les tentatives d'abord
    await db('otp_verifications')
      .where({ telephone, utilisateur_id: compte.id, utilise: false })
      .where('expire_at', '>', db.raw('NOW()'))
      .increment('nb_tentatives', 1);

    // Valider l'OTP
    const otp = await db('otp_verifications')
      .where({
        telephone,
        utilisateur_id: compte.id,
        code_hash: codeHash,
        utilise:   false,
      })
      .where('expire_at', '>', db.raw('NOW()'))
      .where('nb_tentatives', '<=', 3)
      .first();

    if (!otp) throw ApiError.otpInvalide('Code invalide, expiré ou trop de tentatives');

    // Marquer comme utilisé
    await db('otp_verifications').where({ id: otp.id }).update({ utilise: true });

    const utilisateur = await db('utilisateurs')
      .where({ id: otp.utilisateur_id, actif: true })
      .first('id', 'nom', 'prenom', 'telephone', 'mdp_a_changer', 'etablissement_id');

    // Le compte doit appartenir à l'établissement dont le code est fourni.
    // Sans ce contrôle, un code demandé pour l'école A pouvait être validé
    // avec le code de l'école B et ouvrait une session B pour un utilisateur
    // de A (JWT eid = B, aucun rôle). Même réponse que pour un code faux :
    // ne pas révéler dans quel établissement le numéro existe.
    if (!utilisateur || utilisateur.etablissement_id !== etablissement.id) {
      throw ApiError.otpInvalide('Code invalide, expiré ou trop de tentatives');
    }

    // Récupérer le rôle pour ce couple utilisateur/établissement
    const roleRow = await db('utilisateur_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'ur.utilisateur_id': utilisateur.id, 'ur.etablissement_id': etablissement.id, 'ur.actif': true })
      .first('r.code as role');

    const { token, refreshToken } = await creerSession(db, utilisateur.id, etablissement.id, req);

    return ok(res, {
      token,
      refresh_token: refreshToken,
      utilisateur: {
        id:               utilisateur.id,
        nom:              utilisateur.nom,
        prenom:           utilisateur.prenom,
        telephone:        utilisateur.telephone,
        role:             roleRow ? roleRow.role : 'parent',
        doit_changer_mdp: !!utilisateur.mdp_a_changer,
        etablissement_id: etablissement.id,
        etablissement_nom: etablissement.nom,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /auth/profil — Profil de l'utilisateur connecté ─────────
async function fetchProfil(db, utilisateurId, etablissementId, session) {
  const utilisateur = await db('utilisateurs')
    .where({ id: utilisateurId, actif: true })
    .first('id', 'nom', 'prenom', 'email', 'telephone');

  const etablissement = await db('etablissements')
    .where({ id: etablissementId })
    .first('id', 'nom', 'code_officiel');

  return {
    ...utilisateur,
    role:              session.role,
    roles:             session.roles,
    doit_changer_mdp:  !!session.mdp_a_changer,
    etablissement_id:  etablissement.id,
    etablissement_nom: etablissement.nom,
  };
}

router.get('/auth/profil', authentifier, async (req, res, next) => {
  try {
    const db = getDB();
    const cle = `profil:${req.session.utilisateur_id}`;

    let profil;
    try {
      profil = await getOrSet(cle, () => fetchProfil(db, req.session.utilisateur_id, req.session.etablissement_id, req.session), 3600);
    } catch {
      profil = await fetchProfil(db, req.session.utilisateur_id, req.session.etablissement_id, req.session);
    }

    return ok(res, profil);
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/changer-mot-de-passe — Changer son mot de passe ───
// Sert à la fois au changement volontaire et au changement OBLIGATOIRE d'un
// mot de passe provisoire (utilisateurs.mdp_a_changer) : c'est la seule route
// protégée accessible tant que le drapeau est levé (voir auth.middleware).
const schemaChangerMotDePasse = z.object({
  mot_de_passe_actuel:  z.string().min(1, 'Mot de passe actuel requis'),
  nouveau_mot_de_passe: schemaMotDePasse,
});

router.post('/auth/changer-mot-de-passe', limiterAuth, authentifier, valider(schemaChangerMotDePasse), async (req, res, next) => {
  const { mot_de_passe_actuel, nouveau_mot_de_passe } = req.body;
  const db = getDB();

  try {
    const utilisateur = await db('utilisateurs')
      .where({ id: req.session.utilisateur_id, actif: true })
      .first('id', 'nom', 'prenom', 'email', 'telephone', 'mot_de_passe_hash');

    // Parents/élèves : pas de mot de passe (connexion par code SMS)
    if (!utilisateur || !utilisateur.mot_de_passe_hash) {
      throw ApiError.interdit('Ce compte n\'utilise pas de mot de passe (connexion par code SMS)');
    }

    const actuelValide = await bcrypt.compare(mot_de_passe_actuel, utilisateur.mot_de_passe_hash);
    if (!actuelValide) throw ApiError.nonAutorise('Mot de passe actuel incorrect');

    if (nouveau_mot_de_passe === mot_de_passe_actuel) {
      throw ApiError.validationEchouee('Le nouveau mot de passe doit être différent de l\'actuel');
    }

    const politique = await db('politique_securite')
      .where({ etablissement_id: req.session.etablissement_id })
      .first('mdp_longueur_min');
    exigerMotDePasseConforme(nouveau_mot_de_passe, politique, utilisateur);

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 12);

    // Sessions à fermer : toutes SAUF celle en cours (l'utilisateur reste connecté)
    const autres = await db('sessions')
      .where({ utilisateur_id: utilisateur.id, revoquee: false })
      .where('id', '!=', req.session.id)
      .select('id', 'token_hash');

    await db.transaction(async trx => {
      await trx('utilisateurs')
        .where({ id: utilisateur.id })
        .update({ mot_de_passe_hash: hash, mdp_a_changer: false, updated_at: trx.raw('NOW()') });

      if (autres.length) {
        await trx('sessions')
          .whereIn('id', autres.map(a => a.id))
          .update({ revoquee: true, motif_revocation: 'changement_mot_de_passe' });
      }
    });

    // Purger les caches : sinon la session courante garderait le drapeau
    // « mot de passe à changer » (et les autres sessions resteraient
    // utilisables) jusqu'à 10 min.
    try {
      const { getRedis } = require('../../../infrastructure/cache/redis');
      const redis = getRedis();
      const courant = crypto.createHash('sha256').update(req.headers.authorization.slice(7)).digest('hex');
      await redis.del(`sess:${courant}`);
      await redis.del(`profil:${utilisateur.id}`);
      for (const a of autres) await redis.del(`sess:${a.token_hash}`);
    } catch { /* Redis down, pas critique */ }

    logger.info('Mot de passe changé', { utilisateur_id: utilisateur.id, sessions_fermees: autres.length });
    return ok(res, {
      message: 'Mot de passe modifié.',
      sessions_fermees: autres.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/deconnexion ──────────────────────────────────────
router.post('/auth/deconnexion', authentifier, async (req, res, next) => {
  try {
    await getDB()('sessions')
      .where({ id: req.session.id })
      .update({ revoquee: true, motif_revocation: 'deconnexion_utilisateur' });

    // Invalider le cache session et permissions Redis
    try {
      const { getRedis } = require('../../../infrastructure/cache/redis');
      const redis = getRedis();
      const tokenHash = require('crypto').createHash('sha256')
        .update(req.headers.authorization.slice(7)).digest('hex');
      await redis.del(`sess:${tokenHash}`);
      await redis.del(`user:${req.session.utilisateur_id}:perms:${req.session.etablissement_id}`);
      await redis.del(`profil:${req.session.utilisateur_id}`);
    } catch { /* Redis down, pas critique */ }

    return ok(res, { message: 'Déconnecté avec succès' });
  } catch (err) {
    next(err);
  }
});

// ── GET /auth/sessions — Sessions actives de l'utilisateur ──────
router.get('/auth/sessions', authentifier, async (req, res, next) => {
  try {
    const sessions = await getDB()('sessions')
      .where({
        utilisateur_id: req.session.utilisateur_id,
        revoquee:       false,
      })
      .where('expire_at', '>', getDB().raw('NOW()'))
      .select('id', 'ip_address', 'appareil', 'canal_connexion', 'derniere_activite', 'created_at');

    return ok(res, sessions);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /auth/sessions/:id — Révoquer une session ───────────
router.delete('/auth/sessions/:id', authentifier, async (req, res, next) => {
  try {
    const db = getDB();
    // UPDATE ... RETURNING atomique (pas de first() + update() séparés) :
    // capture le token_hash réellement révoqué, sans fenêtre de course
    // avec un /auth/refresh concurrent qui écrirait un nouveau token_hash
    // entre la lecture et l'écriture — ce qui purgerait Redis avec un hash
    // périmé et laisserait le nouveau token actif jusqu'à 10 min.
    const [cible] = await db('sessions')
      .where({ id: req.params.id, utilisateur_id: req.session.utilisateur_id })
      .update({ revoquee: true, motif_revocation: 'revocation_manuelle' })
      .returning('token_hash');

    if (!cible) throw ApiError.nonTrouve('Session introuvable');

    // Purger le cache Redis — sinon la session révoquée reste utilisable
    // jusqu'à 10 min (TTL du cache session de authentifier).
    try {
      const { getRedis } = require('../../../infrastructure/cache/redis');
      const redis = getRedis();
      await redis.del(`sess:${cible.token_hash}`);
    } catch { /* Redis down, pas critique */ }

    return ok(res, { message: 'Session révoquée' });
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/mot-de-passe-oublie — Demander un OTP de reset ───
router.post('/auth/mot-de-passe-oublie', limiterAuth, valider(schemaMotDePasseOublie), async (req, res, next) => {
  const { identifiant, etablissement_code } = req.body;
  const db = getDB();

  try {
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom', 'pays');

    if (!etablissement) {
      await new Promise(r => setTimeout(r, 800));
      return ok(res, { message: 'Si ce compte existe, un code vous a été envoyé.' });
    }

    const utilisateur = await db('utilisateurs')
      .where({ etablissement_id: etablissement.id, actif: true })
      .andWhere(filtreIdentifiant(identifiant, etablissement.pays))
      .first('id', 'telephone', 'email');

    if (!utilisateur) {
      await new Promise(r => setTimeout(r, 800));
      return ok(res, { message: 'Si ce compte existe, un code vous a été envoyé.' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    // Clé OTP et destinataire SMS : forme normalisée (repli sur la valeur
    // stockée si elle est inexploitable), identique à l'étape de validation
    const telephone = normaliserTelephone(utilisateur.telephone, etablissement.pays) || utilisateur.telephone;

    await db('otp_verifications')
      .where({ telephone, utilisateur_id: utilisateur.id, objectif: 'reset_mdp', utilise: false })
      .update({ utilise: true });

    await db('otp_verifications').insert({
      id:             uuid(),
      telephone,
      code_hash:      codeHash,
      objectif:       'reset_mdp',
      utilisateur_id: utilisateur.id,
      expire_at:      db.raw("NOW() + INTERVAL '15 minutes'"),
    });

    // Même logique que /auth/otp/demander (lot E) : log en dev/test sans
    // AT_API_KEY, 503 SMS_INDISPONIBLE hors dev/test sans clé, envoi réel
    // sinon. L'ancienne condition ne couvrait que NODE_ENV==='test' et
    // laissait passer un appel réseau réel (et un éventuel plantage) en
    // développement normal sans credentials Africa's Talking.
    // Même try/catch que /auth/otp/demander (code-review lot E, MEDIUM 2) :
    // sans lui, un échec réel d'envoi SMS pour un compte existant plantait
    // avec une erreur brute différente du message anti-énumération standard
    // ci-dessous — un canal d'énumération de comptes involontaire.
    try {
      await envoyerOuLoggerOTP(telephone, code, `Réinitialisation — ${etablissement.nom}`);
    } catch (smsErr) {
      if (smsErr.isApiError) throw smsErr; // ex: SMS_INDISPONIBLE (503)
      logger.error('Échec envoi SMS reset mot de passe', { telephone, error: smsErr.message });
      throw ApiError.erreurServeur('Échec de l\'envoi du SMS — réessayez dans quelques instants.');
    }

    return ok(res, { message: 'Si ce compte existe, un code vous a été envoyé.' });

  } catch (err) {
    next(err);
  }
});

// ── POST /auth/reinitialiser-mot-de-passe — Valider OTP + nouveau MDP ─
router.post('/auth/reinitialiser-mot-de-passe', limiterAuth, valider(schemaReinitialiserMotDePasse), async (req, res, next) => {
  const { identifiant, etablissement_code, code, nouveau_mot_de_passe } = req.body;
  const db = getDB();

  try {
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'pays');

    if (!etablissement) throw ApiError.nonAutorise('Établissement inconnu');

    const utilisateurBrut = await db('utilisateurs')
      .where({ etablissement_id: etablissement.id, actif: true })
      .andWhere(filtreIdentifiant(identifiant, etablissement.pays))
      .first('id', 'telephone', 'email', 'nom', 'prenom');

    if (!utilisateurBrut) throw ApiError.otpInvalide('Code invalide ou expiré');

    // Même clé OTP qu'à la demande (forme normalisée)
    const utilisateur = {
      ...utilisateurBrut,
      telephone: normaliserTelephone(utilisateurBrut.telephone, etablissement.pays) || utilisateurBrut.telephone,
    };

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await db('otp_verifications')
      .where({ telephone: utilisateur.telephone, utilisateur_id: utilisateur.id, objectif: 'reset_mdp', utilise: false })
      .where('expire_at', '>', db.raw('NOW()'))
      .increment('nb_tentatives', 1);

    const otp = await db('otp_verifications')
      .where({
        telephone:       utilisateur.telephone,
        utilisateur_id:  utilisateur.id,
        code_hash:       codeHash,
        objectif:        'reset_mdp',
        utilise:         false,
      })
      .where('expire_at', '>', db.raw('NOW()'))
      .where('nb_tentatives', '<=', 5)
      .first();

    if (!otp) throw ApiError.otpInvalide('Code invalide, expiré ou trop de tentatives');

    // Politique de l'établissement (ne peut que durcir le socle commun, déjà
    // vérifié par le schéma) + interdiction de reprendre l'identité du compte.
    // Aucune exception avalée : une erreur ici doit refuser la requête.
    const politique = await db('politique_securite')
      .where({ etablissement_id: etablissement.id })
      .first('mdp_longueur_min');
    exigerMotDePasseConforme(nouveau_mot_de_passe, politique, utilisateur);

    const hash = await bcrypt.hash(nouveau_mot_de_passe, 12);

    await db.transaction(async trx => {
      await trx('utilisateurs')
        .where({ id: utilisateur.id })
        .update({ mot_de_passe_hash: hash, mdp_a_changer: false, updated_at: trx.raw('NOW()') });

      await trx('otp_verifications').where({ id: otp.id }).update({ utilise: true });

      // Révoquer toutes les sessions actives (sécurité)
      await trx('sessions')
        .where({ utilisateur_id: utilisateur.id, revoquee: false })
        .update({ revoquee: true, motif_revocation: 'reset_mot_de_passe' });
    });

    logger.info('Mot de passe réinitialisé', { utilisateur_id: utilisateur.id });

    return ok(res, { message: 'Mot de passe modifié. Vous pouvez maintenant vous connecter.' });

  } catch (err) {
    next(err);
  }
});

// ── Helpers ──────────────────────────────────────────────────────

async function creerSession(db, utilisateurId, etablissementId, req) {
  // Vérifier et appliquer la limite de sessions simultanées
  try {
    const politique = await db('politique_securite')
      .where({ etablissement_id: etablissementId })
      .first('session_max_simultanees');
    const max = politique?.session_max_simultanees || 3;
    const sessionsActives = await db('sessions')
      .where({ utilisateur_id: utilisateurId, revoquee: false })
      .where('expire_at', '>', db.raw('NOW()'))
      .orderBy('created_at', 'asc')
      .select('id');
    if (sessionsActives.length >= max) {
      // Révoquer les sessions les plus anciennes
      const aRevoquer = sessionsActives.slice(0, sessionsActives.length - max + 1);
      await db('sessions')
        .whereIn('id', aRevoquer.map(s => s.id))
        .update({ revoquee: true, motif_revocation: 'session_max_atteint' });
    }
  } catch { /* Non bloquant — continuer */ }

  const sessionId = uuid();
  const token = jwt.sign(
    { sub: utilisateurId, eid: etablissementId, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30m' }
  );

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  await db('sessions').insert({
    id:                 sessionId,
    utilisateur_id:     utilisateurId,
    etablissement_id:   etablissementId,
    token_hash:         tokenHash,
    refresh_token_hash: refreshTokenHash,
    refresh_expire_at:  db.raw("NOW() + INTERVAL '7 days'"),
    ip_address:         req.ip,
    user_agent:         req.headers['user-agent']?.slice(0, 255),
    appareil:           detecterAppareil(req.headers['user-agent']),
    canal_connexion:    'web',
    expire_at:          db.raw("NOW() + INTERVAL '30 minutes'"),
  });

  return { token, sessionId, refreshToken };
}

function detecterAppareil(userAgent = '') {
  if (/Android/i.test(userAgent))  return 'mobile_android';
  if (/iPhone|iPad/i.test(userAgent)) return 'mobile_ios';
  return 'desktop';
}

// ── POST /auth/refresh — Rafraîchir le token d'accès ────────────
// Rate-limitée comme les autres routes d'auth (B2) : un refresh token qui
// fuite ne doit pas permettre un brute force illimité.
router.post('/auth/refresh', limiterRefresh, valider(schemaRefresh), async (req, res, next) => {
  const { refresh_token } = req.body;
  const db = getDB();

  try {
    const refreshHash = crypto.createHash('sha256').update(refresh_token).digest('hex');

    // Réutilisation d'un refresh token déjà tourné : après un refresh réussi,
    // l'ancien refresh_token_hash n'existe plus en base (remplacé par le
    // nouveau ci-dessous) — la requête ne trouve donc plus la session et
    // retombe naturellement dans ce cas 401, sans logique de révocation
    // en cascade supplémentaire à écrire.
    const session = await db('sessions')
      .where({ refresh_token_hash: refreshHash, revoquee: false })
      .where('refresh_expire_at', '>', db.raw('NOW()'))
      .first('id', 'utilisateur_id', 'etablissement_id', 'token_hash');

    if (!session) {
      // Session fermée parce que l'utilisateur a ouvert trop d'appareils :
      // un code distinct permet au client d'expliquer la déconnexion.
      const fermee = await db('sessions')
        .where({ refresh_token_hash: refreshHash, revoquee: true, motif_revocation: 'session_max_atteint' })
        .first('id');
      if (fermee) {
        return next(new ApiError(401, 'Vous avez été déconnecté : trop d\'appareils connectés avec ce compte', 'SESSION_REVOQUEE'));
      }
      return next(ApiError.nonAutorise('Refresh token invalide ou expiré'));
    }

    // Le sid du JWT reste l'id de session existant — ne JAMAIS le changer :
    // il est référencé par DELETE /auth/sessions/:id et par req.session.id
    // côté client (mobile/dashboard).
    const newToken = jwt.sign(
      { sub: session.utilisateur_id, eid: session.etablissement_id, sid: session.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30m' }
    );
    const tokenHash = crypto.createHash('sha256').update(newToken).digest('hex');

    // Rotation du refresh token — invalide l'ancien à chaque usage.
    const nouveauRefreshToken = crypto.randomBytes(40).toString('hex');
    const nouveauRefreshTokenHash = crypto.createHash('sha256').update(nouveauRefreshToken).digest('hex');

    // Prolonger la session (expire_at) sinon `authentifier` (qui filtre
    // expire_at > NOW()) rejette tout refresh effectué après les 30
    // premières minutes, rendant la route inutilisable au-delà.
    await db('sessions').where({ id: session.id }).update({
      token_hash:         tokenHash,
      refresh_token_hash: nouveauRefreshTokenHash,
      refresh_expire_at:  db.raw("NOW() + INTERVAL '7 days'"),
      expire_at:          db.raw("NOW() + INTERVAL '30 minutes'"),
      derniere_activite:  db.raw('NOW()'),
    });

    // Purger le cache Redis de l'ancien token — sinon l'ancien token reste
    // utilisable jusqu'à 10 min (TTL du cache session de authentifier).
    try {
      const { getRedis } = require('../../../infrastructure/cache/redis');
      const redis = getRedis();
      await redis.del(`sess:${session.token_hash}`);
    } catch { /* Redis down, pas critique */ }

    return ok(res, { token: newToken, refresh_token: nouveauRefreshToken });
  } catch (err) {
    next(err);
  }
});

// POST /etablissements/register a été retiré (fusion des parcours
// d'inscription, audit 2026-09) : /inscription (backend/src/domains/setup/
// setup.routes.js) est désormais l'unique route publique de création
// d'établissement — elle reprend la même logique (code auto-généré, année
// scolaire courante, niveaux par défaut) que cette route avait déjà. Le
// wizard dashboard/inscription.html est l'unique point d'entrée UI ;
// l'onglet "Créer un établissement" de login.html a été retiré.

module.exports = router;
