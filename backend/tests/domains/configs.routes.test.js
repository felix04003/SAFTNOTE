'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn(), enqueuerCalculMoyennes: jest.fn(),
  enqueuerGenerationBulletins: jest.fn(),
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

const router = require('../../src/domains/03-pedagogie/configs/configs.routes');
const app = createTestApp(router);

describe('Configs Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /configs/coefficients ───────────────────────────────────
  describe('GET /configs/coefficients', () => {
    test('retourne les coefficients par niveau', async () => {
      const coefficients = [
        {
          id: 'c1', niveau_id: 'niv-1', niveau: 'Terminale', cycle: 'secondaire',
          matiere_id: IDS.matiere, matiere: 'Maths', matiere_code: 'MATH',
          serie_id: null, serie_code: null, serie: null,
          coefficient: 5, est_eliminatoire: false, seuil_eliminatoire: null,
          nb_devoirs_periode: 3, nb_compos_periode: 1, est_obligatoire: true,
        },
      ];

      // 1er appel: db('annees_scolaires').first() → année courante
      db.mockReturnValueOnce(mockQuery({ id: IDS.annee, libelle: '2024-2025' }));
      // 2e appel: db('configs_matieres_niveau as cmn').join...select()
      db.mockReturnValueOnce(mockQuery(coefficients));

      const res = await request(app)
        .get('/configs/coefficients')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('annee', '2024-2025');
      expect(res.body.data.niveaux).toHaveLength(1);
    });
  });

  // ── PUT /configs/coefficients ───────────────────────────────────
  describe('PUT /configs/coefficients', () => {
    test('modifie les coefficients en batch', async () => {
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn()
          .mockReturnValueOnce(mockQuery({ id: IDS.matiere }))   // config exists check
          .mockReturnValueOnce(mockQuery(1));                     // update
        await fn(trx);
      });

      const res = await request(app)
        .put('/configs/coefficients')
        .send({
          modifications: [
            { config_id: IDS.matiere, coefficient: 6 },
          ],
        })
        .expect(200);

      expect(res.body.succes).toBe(true);
    });
  });

  // ── GET /configs/matieres ───────────────────────────────────────
  describe('GET /configs/matieres', () => {
    test('retourne la liste des matières de l\'établissement', async () => {
      const matieres = [
        { id: IDS.matiere, nom: 'Mathématiques', code: 'MATH', nom_court: 'Maths', couleur_affichage: '#4A90D9' },
      ];

      db.mockReturnValueOnce(mockQuery(matieres));

      const res = await request(app)
        .get('/configs/matieres')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].code).toBe('MATH');
    });
  });

  // ── POST /configs/matieres ──────────────────────────────────────
  describe('POST /configs/matieres', () => {
    test('crée une nouvelle matière', async () => {
      db.mockReturnValueOnce(mockQuery(null));                    // unicité check → pas trouvé
      db.mockReturnValueOnce(mockQuery([{ id: 'new-mat' }]));   // insert returning

      const res = await request(app)
        .post('/configs/matieres')
        .send({
          nom: 'Physique-Chimie',
          code: 'PC',
          nom_court: 'PC',
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
    });

    test('retourne 422 si matière existante (code dupliqué)', async () => {
      db.mockReturnValueOnce(mockQuery({ id: 'existing' }));     // unicité → trouvé

      const res = await request(app)
        .post('/configs/matieres')
        .send({
          nom: 'Mathématiques',
          code: 'MATH',
          nom_court: 'Maths',
        })
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ECHOUEE');
    });
  });
});
