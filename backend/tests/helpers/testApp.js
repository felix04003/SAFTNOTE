'use strict';

const express      = require('express');
const errorHandler = require('../../src/middleware/error.middleware');

/**
 * Crée une app Express de test avec un routeur monté.
 * Les middlewares d'auth et permission sont mockés au niveau module
 * (voir setupMocks() ci-dessous).
 *
 * @param {express.Router} router - Le routeur à tester
 * @param {string} prefix - Préfixe de montage (ex: '/api/v1')
 * @returns {express.Application}
 */
function createTestApp(router, prefix = '') {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  if (prefix) {
    app.use(prefix, router);
  } else {
    app.use(router);
  }

  // Middleware d'erreur centralisé (le vrai, pas mocké)
  app.use(errorHandler);

  return app;
}

/**
 * Session de test par défaut (directeur avec tous les droits).
 */
const defaultSession = {
  id:               '88888888-8888-8888-8888-888888888888',
  utilisateur_id:   '22222222-2222-2222-2222-222222222222',
  etablissement_id: '11111111-1111-1111-1111-111111111111',
  roles:            ['directeur'],
  role:             'directeur',
  nom_complet:      'Moussa Diallo',
};

/**
 * Crée les mocks Jest pour les modules partagés.
 * À appeler AVANT tout require() de routes dans les fichiers de test.
 *
 * Usage en tête de fichier de test :
 *   jest.mock('../../src/infrastructure/database/pool');
 *   jest.mock('../../src/infrastructure/cache/redis');
 *   jest.mock('../../src/infrastructure/queue/bullmq');
 *   jest.mock('../../src/utils/logger');
 *
 * Puis dans beforeEach :
 *   const { getDB } = require('../../src/infrastructure/database/pool');
 *   getDB.mockReturnValue(db);
 */

/**
 * Mock factory pour le middleware d'authentification.
 * Définit automatiquement req.session et req.etablissement_id.
 *
 * @param {object} [session] - Session custom (override defaultSession)
 */
function mockAuthentifier(session = defaultSession) {
  return (req, _res, next) => {
    req.session = { ...session };
    req.etablissement_id = session.etablissement_id;
    next();
  };
}

/**
 * Mock factory pour le middleware de permission.
 * Laisse toujours passer (permission accordée).
 */
function mockExigerPermission() {
  return (_req, _res, next) => next();
}

/**
 * Mock factory pour le middleware d'isolation.
 * Pose req.etablissement_id et laisse passer.
 */
function mockIsolerEtablissement(req, _res, next) {
  if (req.session) {
    req.etablissement_id = req.session.etablissement_id;
  }
  next();
}

module.exports = {
  createTestApp,
  defaultSession,
  mockAuthentifier,
  mockExigerPermission,
  mockIsolerEtablissement,
};
