'use strict';

// Lot E (finding E1, audit 2026-09) : /auth/otp/demander et
// /auth/mot-de-passe-oublie ne doivent JAMAIS logguer le code OTP en
// production quand Africa's Talking (AT_API_KEY) n'est pas configurée —
// elles doivent répondre 503 à la place. Hors production, le comportement
// de log en dev/test reste inchangé.

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(),
  getRedis: jest.fn(),
  getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(),
  healthCheck: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerOTP: jest.fn().mockResolvedValue({ succes: true }),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));

const request = require('supertest');

const { getDB }     = require('../../src/infrastructure/database/pool');
const logger        = require('../../src/utils/logger');
const { envoyerOTP } = require('../../src/infrastructure/notifications/sms.service');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_min_ok';

// Note (code-review lot E, MEDIUM 3) : `router` charge une seule instance de
// `limiterAuth` (module-level, voir auth.routes.js) partagée par TOUTES les
// requêtes de ce fichier, dans les deux describe blocks ci-dessous — chaque
// test ajoute au même compteur par IP. Ce fichier reste aujourd'hui sous la
// limite (6 requêtes au total sur un max de 10/15 min), donc pas de flakiness
// actuelle. Si de nouveaux tests sont ajoutés ici, soit répartir sur
// plusieurs fichiers de test (module registry Jest séparé = limiteur
// réinitialisé, comme fait ici vs. auth.routes.test.js), soit désactiver
// temporairement `RATE_LIMIT_AUTH_MAX` via l'environnement dans ce fichier.
const router = require('../../src/domains/02-acteurs/auth/auth.routes');
const app = createTestApp(router);

const NODE_ENV_ORIGINAL = process.env.NODE_ENV;
const AT_API_KEY_ORIGINAL = process.env.AT_API_KEY;

afterEach(() => {
  process.env.NODE_ENV = NODE_ENV_ORIGINAL;
  process.env.AT_API_KEY = AT_API_KEY_ORIGINAL;
});

describe('POST /auth/otp/demander — SMS/OTP en production (lot E)', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('production sans AT_API_KEY → 503 SMS_INDISPONIBLE, code jamais loggué', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AT_API_KEY;

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1' };
    db.mockReturnValueOnce(mockQuery(etablissement)); // SELECT etablissement
    db.mockReturnValueOnce(mockQuery(utilisateur));   // SELECT utilisateur
    db.mockReturnValueOnce(mockQuery(1));             // UPDATE invalider anciens OTP
    db.mockReturnValueOnce(mockQuery([1]));           // INSERT otp_verifications

    const res = await request(app)
      .post('/auth/otp/demander')
      .send({ telephone: '+221771234567', etablissement_code: 'ETAB1' })
      .expect(503);

    expect(res.body.succes).toBe(false);
    expect(res.body.code).toBe('SMS_INDISPONIBLE');
    expect(envoyerOTP).not.toHaveBeenCalled();

    // Le code généré est aléatoire (crypto.randomInt) — on vérifie qu'aucun
    // nombre à 6 chiffres n'apparaît dans les appels logger.
    for (const niveau of ['warn', 'info', 'error']) {
      for (const appel of logger[niveau].mock.calls) {
        expect(JSON.stringify(appel)).not.toMatch(/\b\d{6}\b/);
      }
    }
  });

  test('production avec AT_API_KEY configurée → envoi SMS réel, 200', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AT_API_KEY = 'cle-at-valide';

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1' };
    db.mockReturnValueOnce(mockQuery(etablissement));
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery(1));
    db.mockReturnValueOnce(mockQuery([1]));

    const res = await request(app)
      .post('/auth/otp/demander')
      .send({ telephone: '+221771234568', etablissement_code: 'ETAB1' })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(envoyerOTP).toHaveBeenCalledTimes(1);
    expect(envoyerOTP).toHaveBeenCalledWith('+221771234568', expect.any(String), 'École Test');
  });

  test('développement sans AT_API_KEY → code loggué (comportement dev inchangé)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AT_API_KEY;

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1' };
    db.mockReturnValueOnce(mockQuery(etablissement));
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery(1));
    db.mockReturnValueOnce(mockQuery([1]));

    const res = await request(app)
      .post('/auth/otp/demander')
      .send({ telephone: '+221771234569', etablissement_code: 'ETAB1' })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(envoyerOTP).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('CODE OTP'),
      expect.objectContaining({ telephone: '+221771234569' })
    );
  });
});

describe('POST /auth/mot-de-passe-oublie — SMS/OTP en production (lot E)', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('production sans AT_API_KEY → 503 SMS_INDISPONIBLE, code jamais loggué', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AT_API_KEY;

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1', telephone: '+221771234570', email: 'p@test.sn' };
    db.mockReturnValueOnce(mockQuery(etablissement)); // SELECT etablissement
    db.mockReturnValueOnce(mockQuery(utilisateur));   // SELECT utilisateur
    db.mockReturnValueOnce(mockQuery(1));             // UPDATE invalider anciens OTP
    db.mockReturnValueOnce(mockQuery([1]));           // INSERT otp_verifications

    const res = await request(app)
      .post('/auth/mot-de-passe-oublie')
      .send({ identifiant: 'p@test.sn', etablissement_code: 'ETAB1' })
      .expect(503);

    expect(res.body.succes).toBe(false);
    expect(res.body.code).toBe('SMS_INDISPONIBLE');
    expect(envoyerOTP).not.toHaveBeenCalled();
    for (const niveau of ['warn', 'info', 'error']) {
      for (const appel of logger[niveau].mock.calls) {
        expect(JSON.stringify(appel)).not.toMatch(/\b\d{6}\b/);
      }
    }
  });

  test('production avec AT_API_KEY configurée → envoi SMS réel', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AT_API_KEY = 'cle-at-valide';

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1', telephone: '+221771234571', email: 'p2@test.sn' };
    db.mockReturnValueOnce(mockQuery(etablissement));
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery(1));
    db.mockReturnValueOnce(mockQuery([1]));

    const res = await request(app)
      .post('/auth/mot-de-passe-oublie')
      .send({ identifiant: 'p2@test.sn', etablissement_code: 'ETAB1' })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(envoyerOTP).toHaveBeenCalledTimes(1);
  });

  test('développement sans AT_API_KEY → code loggué (comportement dev inchangé)', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.AT_API_KEY;

    const etablissement = { id: 'etab-1', nom: 'École Test' };
    const utilisateur = { id: 'user-1', telephone: '+221771234572', email: 'p3@test.sn' };
    db.mockReturnValueOnce(mockQuery(etablissement));
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery(1));
    db.mockReturnValueOnce(mockQuery([1]));

    const res = await request(app)
      .post('/auth/mot-de-passe-oublie')
      .send({ identifiant: 'p3@test.sn', etablissement_code: 'ETAB1' })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(envoyerOTP).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('CODE OTP'), expect.anything());
  });
});
