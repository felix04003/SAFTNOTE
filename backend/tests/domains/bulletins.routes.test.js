'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn(), enqueuerCalculMoyennes: jest.fn(),
  enqueuerGenerationBulletins: jest.fn().mockResolvedValue({ id: 'job-001' }),
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
const { bulletin } = require('../helpers/fixtures');

const router = require('../../src/domains/03-pedagogie/bulletins/bulletins.routes');
const app = createTestApp(router);

describe('Bulletins Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /bulletins ──────────────────────────────────────────────
  describe('GET /bulletins', () => {
    test('retourne la liste des bulletins avec filtres', async () => {
      // Un seul db() call — clone().count() utilise le 2e arg de mockQuery
      db.mockReturnValueOnce(mockQuery([bulletin], [{ count: '1' }]));

      const res = await request(app)
        .get('/bulletins?page=1&limite=10')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toHaveProperty('total', 1);
    });
  });

  // ── GET /bulletins/:id ──────────────────────────────────────────
  describe('GET /bulletins/:id', () => {
    test('retourne un bulletin détaillé', async () => {
      // 1. db('moyennes_generales as mg')...first() → bulletin
      db.mockReturnValueOnce(mockQuery(bulletin));
      // 2. Promise.all[0]: db('moyennes_matieres as mm')...select()
      db.mockReturnValueOnce(mockQuery([
        { matiere: 'Maths', moyenne: 15, coefficient: 5, rang_dans_classe: 2 },
      ]));
      // 3. Promise.all[1]: db('notes_conduite')...first()
      db.mockReturnValueOnce(mockQuery(null));
      // 4. Promise.all[2]: db('etablissements')...first()
      db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Delafosse', code_officiel: 'LYC-001' }));

      const res = await request(app)
        .get(`/bulletins/${bulletin.id}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('eleve');
      expect(res.body.data.eleve).toHaveProperty('nom', 'Traoré');
      expect(res.body.data).toHaveProperty('matieres');
    });

    test('retourne 404 si bulletin inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .get(`/bulletins/${IDS.evaluation}`)
        .expect(404);

      expect(res.body.code).toBe('RESSOURCE_INTROUVABLE');
    });
  });

  // ── POST /bulletins/generer ─────────────────────────────────────
  describe('POST /bulletins/generer', () => {
    test('lance la génération de bulletins', async () => {
      // 1. db('classes as c')...first() → classe exists
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe, classe: 'Term S1' }));
      // 2. db('moyennes_generales as mg')...select() → bulletins list (array!)
      db.mockReturnValueOnce(mockQuery([{ id: 'mg-1', inscription_id: IDS.inscription }]));
      // Transaction
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn()
          .mockReturnValueOnce(mockQuery(null))   // recap absences
          .mockReturnValueOnce(mockQuery(1));      // update moyennes_generales
        trx.raw = jest.fn().mockReturnValue('NOW()');
        await fn(trx);
      });

      const res = await request(app)
        .post('/bulletins/generer')
        .send({ classe_id: IDS.classe, periode_id: IDS.periode })
        .expect(202);

      expect(res.body.succes).toBe(true);
    });
  });

  // ── PUT /bulletins/:id/valider ──────────────────────────────────
  describe('PUT /bulletins/:id/valider', () => {
    test('valide un bulletin (signature directeur)', async () => {
      // 1. db('moyennes_generales as mg')...first() → bulletin exists
      db.mockReturnValueOnce(mockQuery({ id: bulletin.id }));
      // 2. db('moyennes_generales')...update()...returning('*')
      db.mockReturnValueOnce(mockQuery([{ ...bulletin, valide_at: '2025-01-21T14:00:00Z' }]));

      const res = await request(app)
        .put(`/bulletins/${bulletin.id}/valider`)
        .send({ decision_conseil: 'encouragements', appreciation_conseil: 'Bon ensemble' })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('bulletin');
    });
  });

  // ── GET /bulletins/:id/download ─────────────────────────────────
  describe('GET /bulletins/:id/download', () => {
    test('retourne l\'URL de téléchargement du bulletin', async () => {
      db.mockReturnValueOnce(mockQuery({
        bulletin_url: 'https://storage.example.com/bulletins/bul-001.pdf',
        valide_at: '2025-01-21T14:00:00Z',
      }));

      const res = await request(app)
        .get(`/bulletins/${bulletin.id}/download`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('download_url');
    });

    test('retourne 404 si bulletin sans PDF', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      await request(app)
        .get(`/bulletins/${IDS.evaluation}/download`)
        .expect(404);
    });
  });

  // ── GET /bulletins/jobs/:jobId ───────────────────────────────────
  describe('GET /bulletins/jobs/:jobId', () => {
    const { getQueue } = require('../../src/infrastructure/queue/bullmq');

    test('retourne l\'état d\'un job en cours', async () => {
      const mockJob = {
        id: 'job-001',
        getState: jest.fn().mockResolvedValue('active'),
        progress: 42,
        returnvalue: null,
        failedReason: null,
      };
      getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(mockJob) });

      const res = await request(app)
        .get('/bulletins/jobs/job-001')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toMatchObject({ job_id: 'job-001', etat: 'active', progress: 42 });
    });

    test('retourne 404 si job inexistant', async () => {
      getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(null) });

      const res = await request(app)
        .get('/bulletins/jobs/job-999')
        .expect(404);

      expect(res.body.code).toBe('RESSOURCE_INTROUVABLE');
    });
  });
});
