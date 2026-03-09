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

const router = express.Router();

// Rate limiting strict sur les routes d'auth
const limiterAuth = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 10,
  message:  { succes: false, erreur: 'Trop de tentatives — réessayez dans 15 minutes', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Schémas de validation ────────────────────────────────────────
const schemaConnexion = z.object({
  identifiant:     z.string().min(3),   // email ou téléphone
  mot_de_passe:    z.string().min(6),
  etablissement_code: z.string().min(2),
});

const schemaOtpDemander = z.object({
  telephone:          z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro invalide'),
  etablissement_code: z.string().min(2),
});

const schemaOtpValider = z.object({
  telephone:          z.string().regex(/^\+?[0-9]{8,15}$/),
  code:               z.string().length(6).regex(/^\d{6}$/),
  etablissement_code: z.string().min(2),
});

// ── POST /auth/connexion — Connexion mot de passe ────────────────
router.post('/auth/connexion', limiterAuth, valider(schemaConnexion), async (req, res, next) => {
  const { identifiant, mot_de_passe, etablissement_code } = req.body;
  const db = getDB();
  const ip = req.ip;

  try {
    // 1. Vérifier blocage force brute
    const bloque = await db.raw(
      'SELECT est_compte_bloque(?, ?) AS bloque',
      [identifiant, ip]
    );
    if (bloque.rows[0]?.bloque) {
      throw ApiError.compteBloque('Trop de tentatives — réessayez dans 15 minutes');
    }

    // 2. Trouver l'établissement
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom');

    if (!etablissement) {
      await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'etablissement_inconnu' });
      throw ApiError.nonAutorise('Établissement inconnu ou inactif');
    }

    // 3. Trouver l'utilisateur
    const utilisateur = await db('utilisateurs')
      .where({ etablissement_id: etablissement.id, actif: true })
      .andWhere(function () {
        this.where('email', identifiant).orWhere('telephone', identifiant);
      })
      .first('id', 'nom', 'prenom', 'mot_de_passe_hash', 'email');

    if (!utilisateur || !utilisateur.mot_de_passe_hash) {
      await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'compte_inexistant' });
      throw ApiError.nonAutorise('Identifiants incorrects');
    }

    // 4. Vérifier le mot de passe
    const motDePasseValide = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe_hash);
    if (!motDePasseValide) {
      await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: false, motif_echec: 'mot_de_passe_incorrect' });
      throw ApiError.nonAutorise('Identifiants incorrects');
    }

    // 5. Créer la session
    const { token, sessionId } = await creerSession(db, utilisateur.id, etablissement.id, req);

    // 6. Charger le rôle principal
    const roleRow = await db('utilisateur_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .where({ 'ur.utilisateur_id': utilisateur.id, 'ur.etablissement_id': etablissement.id, 'ur.actif': true })
      .first('r.code', 'r.libelle');

    // 7. Logger la tentative réussie
    await db('tentatives_connexion').insert({ identifiant, ip_address: ip, succes: true });

    logger.info('Connexion réussie', { utilisateur_id: utilisateur.id, etablissement_id: etablissement.id });

    return ok(res, {
      token,
      utilisateur: {
        id:              utilisateur.id,
        nom:             utilisateur.nom,
        prenom:          utilisateur.prenom,
        email:           utilisateur.email,
        role:            roleRow?.libelle || roleRow?.code || 'Utilisateur',
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
  const { telephone, etablissement_code } = req.body;
  const db = getDB();

  try {
    // Trouver l'établissement
    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom');

    if (!etablissement) throw ApiError.nonAutorise('Établissement inconnu');

    // Vérifier que l'utilisateur existe (parent)
    const utilisateur = await db('utilisateurs')
      .where({ telephone, etablissement_id: etablissement.id, actif: true })
      .first('id');

    // On ne révèle pas si le compte existe (anti-enumération)
    if (!utilisateur) {
      // Simuler un délai pour éviter la détection par timing
      await new Promise(r => setTimeout(r, 800));
      return ok(res, { message: 'Si ce numéro est connu, vous allez recevoir un code' });
    }

    // Générer le code OTP à 6 chiffres
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    // Invalider les anciens OTP du même numéro
    await db('otp_verifications')
      .where({ telephone, utilise: false })
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

    // Envoyer le SMS
    await envoyerOTP(telephone, code, etablissement.nom);

    logger.info('OTP envoyé', { telephone, etablissement_id: etablissement.id });

    return ok(res, { message: 'Code envoyé par SMS. Valable 10 minutes.' });

  } catch (err) {
    next(err);
  }
});

// ── POST /auth/otp/valider — Valider un OTP et créer session ────
router.post('/auth/otp/valider', limiterAuth, valider(schemaOtpValider), async (req, res, next) => {
  const { telephone, code, etablissement_code } = req.body;
  const db = getDB();

  try {
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    const etablissement = await db('etablissements')
      .where({ code_officiel: etablissement_code, actif: true })
      .first('id', 'nom');

    if (!etablissement) throw ApiError.otpInvalide();

    // Incrémenter les tentatives d'abord
    await db('otp_verifications')
      .where({ telephone, utilise: false })
      .where('expire_at', '>', db.raw('NOW()'))
      .increment('nb_tentatives', 1);

    // Valider l'OTP
    const otp = await db('otp_verifications')
      .where({
        telephone,
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
      .first('id', 'nom', 'prenom', 'telephone');

    const { token } = await creerSession(db, utilisateur.id, etablissement.id, req);

    return ok(res, {
      token,
      utilisateur: {
        id:              utilisateur.id,
        nom:             utilisateur.nom,
        prenom:          utilisateur.prenom,
        telephone:       utilisateur.telephone,
        etablissement_id: etablissement.id,
        etablissement_nom: etablissement.nom,
      },
    });

  } catch (err) {
    next(err);
  }
});

// ── GET /auth/profil — Profil de l'utilisateur connecté ─────────
router.get('/auth/profil', authentifier, async (req, res, next) => {
  try {
    const db = getDB();

    const utilisateur = await db('utilisateurs')
      .where({ id: req.session.utilisateur_id, actif: true })
      .first('id', 'nom', 'prenom', 'email', 'telephone');

    const etablissement = await db('etablissements')
      .where({ id: req.session.etablissement_id })
      .first('id', 'nom', 'code_officiel');

    return ok(res, {
      ...utilisateur,
      role:              req.session.role,
      roles:             req.session.roles,
      etablissement_id:  etablissement.id,
      etablissement_nom: etablissement.nom,
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
    const updated = await getDB()('sessions')
      .where({ id: req.params.id, utilisateur_id: req.session.utilisateur_id })
      .update({ revoquee: true, motif_revocation: 'revocation_manuelle' });

    if (!updated) throw ApiError.nonTrouve('Session introuvable');
    return ok(res, { message: 'Session révoquée' });
  } catch (err) {
    next(err);
  }
});

// ── Helpers ──────────────────────────────────────────────────────

async function creerSession(db, utilisateurId, etablissementId, req) {
  const sessionId = uuid();
  const token = jwt.sign(
    { sub: utilisateurId, eid: etablissementId, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await db('sessions').insert({
    id:               sessionId,
    utilisateur_id:   utilisateurId,
    etablissement_id: etablissementId,
    token_hash:       tokenHash,
    ip_address:       req.ip,
    user_agent:       req.headers['user-agent']?.slice(0, 255),
    appareil:         detecterAppareil(req.headers['user-agent']),
    canal_connexion:  'web',
    expire_at:        db.raw("NOW() + INTERVAL '8 hours'"),
  });

  return { token, sessionId };
}

function detecterAppareil(userAgent = '') {
  if (/Android/i.test(userAgent))  return 'mobile_android';
  if (/iPhone|iPad/i.test(userAgent)) return 'mobile_ios';
  return 'desktop';
}

// ── POST /etablissements/register ────────────────────────────────
// Endpoint PUBLIC — crée un nouvel établissement + compte directeur
// Rate-limited comme les autres routes auth
const limiterRegister = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max:      5,
  message:  { succes: false, erreur: 'Trop de tentatives — réessayez dans 1 heure', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders:   false,
});

router.post('/etablissements/register', limiterRegister,
  valider(z.object({
    // Infos école
    nom:          z.string().min(3),
    type:         z.enum(['primaire', 'college', 'lycee', 'primaire_college', 'college_lycee', 'complet', 'franco_arabe', 'professionnel']).default('lycee'),
    pays:         z.string().min(2).default('Sénégal'),
    ville:        z.string().min(2),
    // Compte directeur
    directeur_nom:       z.string().min(2),
    directeur_prenom:    z.string().min(2),
    directeur_telephone: z.string().regex(/^\+?[0-9]{8,15}$/, 'Numéro invalide'),
    directeur_email:     z.string().email().optional().or(z.literal('')),
    directeur_mdp:       z.string().min(6),
    // Année scolaire initiale (optionnel — déduite si absent)
    annee_libelle:  z.string().regex(/^\d{4}-\d{4}$/).optional(),
  })),
  async (req, res, next) => {
    const db = getDB();
    const { nom, type, pays, ville,
            directeur_nom, directeur_prenom,
            directeur_telephone, directeur_email, directeur_mdp,
            annee_libelle } = req.body;

    try {
      // Générer un code officiel unique : initiales + ville + random 4 chiffres
      const initiales = nom.trim().split(/\s+/).slice(0, 3).map(w => w[0].toUpperCase()).join('');
      const villeSlug = ville.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8);
      const rand4     = String(Math.floor(1000 + Math.random() * 9000));
      const codeOfficiel = `${initiales}-${villeSlug}-${rand4}`;

      const mdpHash = await bcrypt.hash(directeur_mdp, 10);

      // Calcul de l'année scolaire courante si non fournie
      const now    = new Date();
      const annee  = annee_libelle ||
        (now.getMonth() >= 7
          ? `${now.getFullYear()}-${now.getFullYear() + 1}`
          : `${now.getFullYear() - 1}-${now.getFullYear()}`);
      const [startYear] = annee.split('-').map(Number);
      const dateDebut = `${startYear}-09-01`;
      const dateFin   = `${startYear + 1}-07-31`;

      const etablissementId = uuid();
      const utilisateurId   = uuid();
      const anneeId         = uuid();

      await db.transaction(async trx => {
        // 1. Créer l'établissement
        await trx('etablissements').insert({
          id:            etablissementId,
          nom,
          code_officiel: codeOfficiel,
          type,
          pays,
          ville,
          actif:         true,
        });

        // 2. Créer l'année scolaire courante
        await trx('annees_scolaires').insert({
          id:               anneeId,
          etablissement_id: etablissementId,
          libelle:          annee,
          date_debut:       dateDebut,
          date_fin:         dateFin,
          nb_periodes:      3,
          est_courante:     true,
        });

        // 3. Créer le compte directeur
        await trx('utilisateurs').insert({
          id:                utilisateurId,
          etablissement_id:  etablissementId,
          nom:               directeur_nom,
          prenom:            directeur_prenom,
          telephone:         directeur_telephone,
          email:             directeur_email || null,
          mot_de_passe_hash: mdpHash,
          actif:             true,
        });

        // 4. Affecter le rôle directeur
        const roleRow = await trx('roles').where({ code: 'directeur' }).first('id');
        if (!roleRow) throw new Error('Rôle "directeur" introuvable — vérifiez les données de référence');

        await trx('utilisateur_roles').insert({
          id:               uuid(),
          utilisateur_id:   utilisateurId,
          role_id:          roleRow.id,
          etablissement_id: etablissementId,
        });
      });

      logger.info('Nouvel établissement créé', { etablissement_id: etablissementId, nom, code_officiel: codeOfficiel });

      return res.status(201).json({
        succes: true,
        data: {
          etablissement:  { id: etablissementId, nom, code_officiel: codeOfficiel, pays, ville },
          annee_scolaire: annee,
          message: `Votre établissement "${nom}" est créé. Conservez précieusement votre code : ${codeOfficiel}`,
        },
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;
