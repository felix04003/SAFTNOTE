'use strict';

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
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));

const request = require('supertest');

const { getDB }    = require('../../src/infrastructure/database/pool');
const { getRedis }  = require('../../src/infrastructure/cache/redis');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');
const { createTestApp, defaultSession } = require('../helpers/testApp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_min_ok';

const router = require('../../src/domains/02-acteurs/auth/auth.routes');
const app = createTestApp(router);

describe('POST /auth/refresh (B2)', () => {
  let db, redisDel;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    redisDel = jest.fn().mockResolvedValue(1);
    getRedis.mockReturnValue({ del: redisDel });
  });

  test('refresh réussi renvoie un nouveau token + refresh_token et prolonge la session', async () => {
    const session = {
      id: defaultSession.id,
      utilisateur_id: defaultSession.utilisateur_id,
      etablissement_id: defaultSession.etablissement_id,
      token_hash: 'ancien_hash',
    };
    const updateChain = mockQuery(1);
    db.mockReturnValueOnce(mockQuery(session)); // SELECT session par refresh_token_hash
    db.mockReturnValueOnce(updateChain);        // UPDATE session

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: 'a'.repeat(80) })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.refresh_token).toBeDefined();
    expect(res.body.data.refresh_token).not.toBe('a'.repeat(80)); // rotation

    // La mise à jour doit prolonger expire_at (ne pas juste renouveler token_hash)
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ expire_at: 'NOW() + INTERVAL \'30 minutes\'' })
    );

    // Purge du cache de l'ancien token
    expect(redisDel).toHaveBeenCalledWith('sess:ancien_hash');
  });

  test('refresh avec token invalide ou expiré → 401', async () => {
    db.mockReturnValueOnce(mockQuery(null)); // aucune session trouvée

    const res = await request(app)
      .post('/auth/refresh')
      .send({ refresh_token: 'b'.repeat(80) })
      .expect(401);

    expect(res.body.succes).toBe(false);
  });

  test('rejette un body sans refresh_token (422)', async () => {
    const res = await request(app)
      .post('/auth/refresh')
      .send({})
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  test('11 appels en fenêtre glissante → 429 (rate limiter partagé des routes auth)', async () => {
    db.mockReturnValue(mockQuery(null)); // toutes les tentatives échouent en 401, sauf la 11e bloquée en amont

    let dernierStatut;
    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: 'c'.repeat(80) });
      dernierStatut = res.status;
    }

    expect(dernierStatut).toBe(429);
  });
});

describe('DELETE /auth/sessions/:id (B3)', () => {
  let db, redisDel;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    redisDel = jest.fn().mockResolvedValue(1);
    getRedis.mockReturnValue({ del: redisDel });
  });

  test('révoque la session et purge le cache Redis correspondant', async () => {
    // UPDATE ... RETURNING atomique — résout directement en un tableau de lignes
    db.mockReturnValueOnce(mockQuery([{ token_hash: 'hash_session_cible' }]));

    const res = await request(app)
      .delete('/auth/sessions/session-id-1')
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(redisDel).toHaveBeenCalledWith('sess:hash_session_cible');
  });

  test('session introuvable → 404, pas de purge Redis', async () => {
    db.mockReturnValueOnce(mockQuery([])); // UPDATE ... RETURNING ne trouve aucune ligne

    const res = await request(app)
      .delete('/auth/sessions/inexistante')
      .expect(404);

    expect(res.body.succes).toBe(false);
    expect(redisDel).not.toHaveBeenCalled();
  });
});
