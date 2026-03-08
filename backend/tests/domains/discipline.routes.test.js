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
const { sanction } = require('../helpers/fixtures');

const router = require('../../src/domains/04-vie-scolaire/discipline/discipline.routes');
const app = createTestApp(router);

describe('Discipline Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /discipline/sanctions ───────────────────────────────────
  describe('GET /discipline/sanctions', () => {
    test('retourne la liste des sanctions', async () => {
      // Un seul db() call avec clone().count()
      db.mockReturnValueOnce(mockQuery([sanction], [{ count: '1' }]));

      const res = await request(app)
        .get('/discipline/sanctions')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].type).toBe('avertissement_oral');
    });
  });

  // ── POST /discipline/sanctions ──────────────────────────────────
  describe('POST /discipline/sanctions', () => {
    test('crée une sanction et notifie les parents', async () => {
      // 1. db('inscriptions as i')...first() → inscription check
      db.mockReturnValueOnce(mockQuery({ id: IDS.inscription }));
      // 2. db('sanctions')...insert()...returning('*')
      db.mockReturnValueOnce(mockQuery([{ id: 'san-new', type: 'avertissement_oral', inscription_id: IDS.inscription }]));

      const res = await request(app)
        .post('/discipline/sanctions')
        .send({
          inscription_id: IDS.inscription,
          type: 'avertissement_oral',
          motif: 'Bavardage répété en classe',
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
    });
  });

  // ── PUT /discipline/sanctions/:id ───────────────────────────────
  describe('PUT /discipline/sanctions/:id', () => {
    test('modifie une sanction existante', async () => {
      // 1. exists check
      db.mockReturnValueOnce(mockQuery({ id: sanction.id }));
      // 2. update returning
      db.mockReturnValueOnce(mockQuery([{ ...sanction, motif: 'Motif mis à jour' }]));

      const res = await request(app)
        .put(`/discipline/sanctions/${sanction.id}`)
        .send({ motif: 'Motif mis à jour pour clarifier' })
        .expect(200);

      expect(res.body.succes).toBe(true);
    });

    test('retourne 404 si sanction introuvable', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .put(`/discipline/sanctions/${IDS.evaluation}`)
        .send({ motif: 'Motif de test valide' })
        .expect(404);
    });
  });

  // ── GET /discipline/eleve/:eleveId ──────────────────────────────
  describe('GET /discipline/eleve/:eleveId', () => {
    test('retourne le dossier disciplinaire d\'un élève', async () => {
      // 1. db('utilisateurs')...first() → eleve
      db.mockReturnValueOnce(mockQuery({ id: IDS.eleve, nom: 'Traoré', prenom: 'Aminata' }));
      // 2. db('eleves')...first() → eleveObj
      db.mockReturnValueOnce(mockQuery({ id: 'eleve-pk-id' }));
      // 3. db('incidents_discipline as inc')...select()
      db.mockReturnValueOnce(mockQuery([]));
      // 4. db('sanctions as s')...select()
      db.mockReturnValueOnce(mockQuery([sanction]));

      const res = await request(app)
        .get(`/discipline/eleve/${IDS.eleve}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('sanctions');
      expect(res.body.data.nb_sanctions).toBe(1);
    });
  });
});
