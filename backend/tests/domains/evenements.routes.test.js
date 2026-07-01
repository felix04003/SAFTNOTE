'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn().mockResolvedValue({ id: 'notif-001' }),
  enqueuerCalculMoyennes: jest.fn(), enqueuerGenerationBulletins: jest.fn(),
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
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');
const { evenement } = require('../helpers/fixtures');

const router = require('../../src/domains/04-vie-scolaire/evenements/evenements.routes');
const app = createTestApp(router);

describe('Evenements Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /evenements ─────────────────────────────────────────────
  describe('GET /evenements', () => {
    test('retourne la liste des événements', async () => {
      db.mockReturnValueOnce(mockQuery([evenement]));

      const res = await request(app)
        .get('/evenements')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].titre).toBe('Réunion parents-enseignants T1');
    });
  });

  // ── POST /evenements ────────────────────────────────────────────
  describe('POST /evenements', () => {
    test('crée un nouvel événement', async () => {
      db.mockReturnValueOnce(mockQuery([{ id: 'evt-new' }]));

      const res = await request(app)
        .post('/evenements')
        .send({
          titre: 'Examen de fin d\'année',
          description: 'Examens finaux pour toutes les classes',
          type: 'examen_officiel',
          date_debut: '2025-06-15',
          date_fin: '2025-06-20',
          lieu: 'Toutes les salles',
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
    });
  });

  // ── PUT /evenements/:id ─────────────────────────────────────────
  describe('PUT /evenements/:id', () => {
    test('modifie un événement existant', async () => {
      // 1. exists check
      db.mockReturnValueOnce(mockQuery({ id: evenement.id }));
      // 2. update returning
      db.mockReturnValueOnce(mockQuery([{ ...evenement, titre: 'Titre modifié' }]));

      const res = await request(app)
        .put(`/evenements/${evenement.id}`)
        .send({ titre: 'Titre modifié avec détails' })
        .expect(200);

      expect(res.body.succes).toBe(true);
    });

    test('retourne 404 si événement inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      await request(app)
        .put(`/evenements/${IDS.evaluation}`)
        .send({ titre: 'Nouveau titre événement' })
        .expect(404);
    });
  });

  // ── DELETE /evenements/:id ──────────────────────────────────────
  describe('DELETE /evenements/:id', () => {
    test('supprime un événement', async () => {
      db.mockReturnValueOnce(mockQuery({ id: evenement.id }));
      db.mockReturnValueOnce(mockQuery(1));

      await request(app)
        .delete(`/evenements/${evenement.id}`)
        .expect(204);
    });

    test('retourne 404 si événement inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      await request(app)
        .delete(`/evenements/${IDS.evaluation}`)
        .expect(404);
    });
  });
});
