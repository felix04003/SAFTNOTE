'use strict';

const jwt    = require('jsonwebtoken');
const { getDB } = require('../infrastructure/database/pool');
const ApiError  = require('../utils/ApiError');
const logger    = require('../utils/logger');

/**
 * Middleware d'authentification.
 * Vérifie le JWT, charge la session en base, pose req.session.
 */
async function authentifier(req, res, next) {
  try {
    // Extraire le token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw ApiError.nonAutorise('Token manquant');
    }

    const token = authHeader.slice(7);

    // Vérifier la signature JWT
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      throw ApiError.nonAutorise(
        jwtErr.name === 'TokenExpiredError' ? 'Token expiré' : 'Token invalide'
      );
    }

    // Vérifier la session en base (permet la révocation)
    const db = getDB();
    const crypto = require('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Tenter le cache Redis pour la session
    let sessionData;
    try {
      const { getRedis } = require('../infrastructure/cache/redis');
      const redis = getRedis();
      const cached = await redis.get(`sess:${tokenHash}`);
      if (cached) {
        sessionData = JSON.parse(cached);
      }
    } catch { /* Redis down, on continue en base */ }

    if (!sessionData) {
      const session = await db('sessions')
        .where({ token_hash: tokenHash, revoquee: false })
        .where('expire_at', '>', db.raw('NOW()'))
        .first();

      if (!session) {
        throw ApiError.nonAutorise('Session invalide ou expirée');
      }

      const utilisateur = await db('utilisateurs')
        .where({ id: session.utilisateur_id, actif: true })
        .first('id', 'nom', 'prenom', 'email', 'telephone');

      if (!utilisateur) {
        throw ApiError.nonAutorise('Utilisateur inactif');
      }

      const roles = await db('utilisateur_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where({
          'ur.utilisateur_id':   session.utilisateur_id,
          'ur.etablissement_id': session.etablissement_id,
          'ur.actif':            true,
        })
        .select('r.code');

      sessionData = {
        id:               session.id,
        utilisateur_id:   session.utilisateur_id,
        etablissement_id: session.etablissement_id,
        roles:            roles.map(r => r.code),
        role:             roles[0]?.code,
        nom_complet:      `${utilisateur.prenom} ${utilisateur.nom}`,
      };

      // Mettre en cache Redis (TTL = 10 min)
      try {
        const { getRedis } = require('../infrastructure/cache/redis');
        await getRedis().setex(`sess:${tokenHash}`, 600, JSON.stringify(sessionData));
      } catch { /* Redis down, pas critique */ }
    }

    // Mettre à jour la dernière activité (sans bloquer la requête)
    db('sessions')
      .where({ id: sessionData.id })
      .update({ derniere_activite: db.raw('NOW()') })
      .catch(err => logger.warn('Mise à jour derniere_activite échouée', { err: err.message }));

    // Poser req.session — disponible dans tous les handlers suivants
    req.session = sessionData;

    next();

  } catch (err) {
    next(err);
  }
}

/**
 * Middleware de vérification de rôle.
 * @param {...string} rolesAutorises - Rôles autorisés à accéder à la route
 */
function autoriserRoles(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.session) return next(ApiError.nonAutorise());

    const aLeDroit = rolesAutorises.some(role => req.session.roles.includes(role));
    if (!aLeDroit) {
      return next(ApiError.interdit(
        `Rôle requis : ${rolesAutorises.join(' ou ')}. Rôle actuel : ${req.session.role}`
      ));
    }
    next();
  };
}

module.exports = { authentifier, autoriserRoles };
