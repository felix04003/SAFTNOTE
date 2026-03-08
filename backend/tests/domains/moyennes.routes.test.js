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

const router = require('../../src/domains/03-pedagogie/moyennes/moyennes.routes');
const app = createTestApp(router);

describe('Moyennes Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /moyennes/classe/:classeId ──────────────────────────────
  describe('GET /moyennes/classe/:classeId', () => {
    test('retourne les moyennes par matière pour une classe', async () => {
      const moyenne = {
        eleve_id: IDS.eleve, nom: 'Traoré', prenom: 'Aminata',
        matiere_id: IDS.matiere, matiere: 'Mathématiques', matiere_code: 'MATH',
        moyenne: 14.25, coefficient: 5,
        rang_dans_classe: 3, appreciation_enseignant: 'Bon niveau', est_complete: true,
      };

      // 1. getAnneeCourante → db('annees_scolaires')...first()
      db.mockReturnValueOnce(mockQuery({ id: IDS.annee, libelle: '2024-2025' }));
      // 2. db('classes as c')...first()
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe, classe: 'Term S1', niveau: 'Terminale' }));
      // 3. db('periodes')...first() (pas de periode_id en query)
      db.mockReturnValueOnce(mockQuery({ id: IDS.periode }));
      // 4. db('moyennes_matieres as mm')...select()
      db.mockReturnValueOnce(mockQuery([moyenne]));

      const res = await request(app)
        .get(`/moyennes/classe/${IDS.classe}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('classe', 'Term S1');
      expect(res.body.data.matieres).toHaveLength(1);
      expect(res.body.data.matieres[0].eleves[0].moyenne).toBe(14.25);
    });
  });

  // ── GET /moyennes/eleve/:eleveId ────────────────────────────────
  describe('GET /moyennes/eleve/:eleveId', () => {
    test('retourne les moyennes d\'un élève', async () => {
      // 1. db('inscriptions as i')...first()
      db.mockReturnValueOnce(mockQuery({ inscription_id: IDS.inscription, classe: 'Term S1', annee: '2024-2025' }));
      // 2. Promise.all: db('moyennes_matieres as mm')...select()
      db.mockReturnValueOnce(mockQuery([
        { matiere: 'Maths', moyenne: 14.25, coefficient: 5, trimestre: 1, periode: 'Trimestre 1' },
        { matiere: 'Français', moyenne: 12.0, coefficient: 4, trimestre: 1, periode: 'Trimestre 1' },
      ]));
      // 3. Promise.all: db('moyennes_generales as mg')...select()
      db.mockReturnValueOnce(mockQuery([
        { moyenne_generale: 13.5, rang: 5, rang_sur: 35, trimestre: 1, periode: 'Trimestre 1' },
      ]));

      const res = await request(app)
        .get(`/moyennes/eleve/${IDS.eleve}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('classe', 'Term S1');
      expect(res.body.data.moyennes_matieres).toHaveLength(2);
      expect(res.body.data.moyennes_generales).toHaveLength(1);
    });
  });

  // ── POST /moyennes/calculer ─────────────────────────────────────
  describe('POST /moyennes/calculer', () => {
    test('déclenche le calcul batch des moyennes', async () => {
      // 1. db('classes as c')...first() → classe exists
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      // 2. db('inscriptions')...select()
      db.mockReturnValueOnce(mockQuery([{ id: IDS.inscription, eleve_id: IDS.eleve }]));
      // 3. db('affectations_enseignants')...distinct()
      db.mockReturnValueOnce(mockQuery([{ matiere_id: IDS.matiere }]));

      // Transaction mock
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn(() => mockQuery([]));
        trx.raw = jest.fn().mockResolvedValue({
          rows: [{ moyenne: 14.25, somme_devoirs: 42.5, nb_devoirs_comptes: 3, note_composition: 15, denominateur: 20, est_complete: true }],
        });
        await fn(trx);
      });

      const res = await request(app)
        .post('/moyennes/calculer')
        .send({
          classe_id: IDS.classe,
          periode_id: IDS.periode,
        })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('nb_eleves', 1);
    });
  });

  // ── GET /moyennes/classement/:classeId ──────────────────────────
  describe('GET /moyennes/classement/:classeId', () => {
    test('retourne le classement des élèves', async () => {
      const classement = [
        { rang: 1, eleve_id: 'e1', nom: 'A', prenom: 'B', moyenne_generale: 16.5, matricule: 'M1' },
        { rang: 2, eleve_id: 'e2', nom: 'C', prenom: 'D', moyenne_generale: 15.0, matricule: 'M2' },
      ];

      // 1. getAnneeCourante → db('annees_scolaires')...first()
      db.mockReturnValueOnce(mockQuery({ id: IDS.annee, libelle: '2024-2025' }));
      // 2. db('classes as c')...first()
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe, classe: 'Term S1' }));
      // 3. db('periodes')...first() (pas de periode_id)
      db.mockReturnValueOnce(mockQuery({ id: IDS.periode }));
      // 4. db('moyennes_generales as mg')...select()
      db.mockReturnValueOnce(mockQuery(classement));

      const res = await request(app)
        .get(`/moyennes/classement/${IDS.classe}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('classement');
      expect(res.body.data.classement).toHaveLength(2);
      expect(res.body.data.classement[0].rang).toBe(1);
      expect(res.body.data.stats).toHaveProperty('effectif', 2);
    });
  });
});
