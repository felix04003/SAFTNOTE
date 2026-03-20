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

const router = require('../../src/domains/01-identites/identites.routes');
const app = createTestApp(router);

const anneeCourante = { id: IDS.annee, libelle: '2025-2026' };
const affectationFixture = {
  id: IDS.affectation,
  enseignant_id: IDS.enseignant,
  classe_id: IDS.classe,
  matiere_id: IDS.matiere,
  annee_scolaire_id: IDS.annee,
  est_titulaire: true,
};

describe('Affectations Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /enseignants/:id/affectations ──────────────────────────
  describe('GET /enseignants/:id/affectations', () => {
    test('retourne les affectations de l\'année courante', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));
      db.mockReturnValueOnce(mockQuery([{
        id: IDS.affectation, est_titulaire: true,
        matiere: 'Mathématiques', matiere_id: IDS.matiere,
        classe: 'A', classe_id: IDS.classe, niveau: '6ème', ordre: 1,
      }]));

      const res = await request(app)
        .get(`/enseignants/${IDS.enseignant}/affectations`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.annee).toBe('2025-2026');
      expect(res.body.data.affectations).toHaveLength(1);
      expect(res.body.data.affectations[0].matiere).toBe('Mathématiques');
    });

    test('retourne 404 si aucune année courante', async () => {
      db.mockReturnValueOnce(mockQuery(undefined));

      const res = await request(app)
        .get(`/enseignants/${IDS.enseignant}/affectations`)
        .expect(404);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── POST /affectations ─────────────────────────────────────────
  describe('POST /affectations', () => {
    test('crée une affectation valide', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.matiere }));
      db.mockReturnValueOnce(mockQuery(undefined));
      db.mockReturnValueOnce(mockQuery([affectationFixture]));

      const res = await request(app)
        .post('/affectations')
        .send({
          enseignant_id: IDS.enseignant,
          classe_id: IDS.classe,
          matiere_id: IDS.matiere,
          est_titulaire: true,
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.id).toBe(IDS.affectation);
    });

    test('retourne 409 si doublon classe+matière+année', async () => {
      db.mockReturnValueOnce(mockQuery(anneeCourante));
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.matiere }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));

      const res = await request(app)
        .post('/affectations')
        .send({
          enseignant_id: IDS.enseignant,
          classe_id: IDS.classe,
          matiere_id: IDS.matiere,
        })
        .expect(409);

      expect(res.body.succes).toBe(false);
      expect(res.body.erreur).toMatch(/déjà assignée/);
    });

    test('retourne 422 si payload invalide', async () => {
      const res = await request(app)
        .post('/affectations')
        .send({ enseignant_id: 'pas-un-uuid' })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── DELETE /affectations/:id ───────────────────────────────────
  describe('DELETE /affectations/:id', () => {
    test('supprime une affectation sans évaluations liées', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));
      db.mockReturnValueOnce(mockQuery(undefined));
      db.mockReturnValueOnce(mockQuery(1));

      await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(204);
    });

    test('retourne 409 si des évaluations existent', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.evaluation }));

      const res = await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(409);

      expect(res.body.erreur).toMatch(/évaluations existent/);
    });

    test('retourne 404 si affectation introuvable', async () => {
      db.mockReturnValueOnce(mockQuery(undefined));

      const res = await request(app)
        .delete(`/affectations/${IDS.affectation}`)
        .expect(404);

      expect(res.body.succes).toBe(false);
    });
  });
});
