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
const { creneauEdt } = require('../helpers/fixtures');

const router = require('../../src/domains/04-vie-scolaire/edt/edt.routes');
const app = createTestApp(router);

describe('EDT Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /plages-horaires ────────────────────────────────────────
  describe('GET /plages-horaires', () => {
    test('retourne les plages horaires triées par numéro', async () => {
      const plages = [
        { id: IDS.plage, numero: 1, libelle: '8h-9h', heure_debut: '08:00:00', heure_fin: '09:00:00', est_pause: false },
      ];
      db.mockReturnValueOnce(mockQuery(plages));

      const res = await request(app)
        .get('/plages-horaires')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].numero).toBe(1);
    });
  });

  // ── GET /edt/classe/:classeId ───────────────────────────────────
  describe('GET /edt/classe/:classeId', () => {
    test('retourne l\'EDT d\'une classe organisé par jour', async () => {
      // 1. db('classes as c')...first() → classe
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe, classe: 'Term S1' }));
      // 2. db('emplois_du_temps as edt')...select()
      db.mockReturnValueOnce(mockQuery([creneauEdt]));

      const res = await request(app)
        .get(`/edt/classe/${IDS.classe}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('classe', 'Term S1');
      expect(res.body.data.emploi_du_temps).toBeDefined();
    });
  });

  // ── GET /edt/enseignant/:enseignantId ───────────────────────────
  describe('GET /edt/enseignant/:enseignantId', () => {
    test('retourne l\'EDT d\'un enseignant', async () => {
      // 1. db('enseignants as ens')...first() → enseignant
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant, nom_complet: 'M. Diop' }));
      // 2. db('annees_scolaires')...first() → année
      db.mockReturnValueOnce(mockQuery({ id: IDS.annee, libelle: '2024-2025' }));
      // 3. db('emplois_du_temps as edt')...select() → creneaux
      db.mockReturnValueOnce(mockQuery([creneauEdt]));

      const res = await request(app)
        .get(`/edt/enseignant/${IDS.enseignant}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('enseignant', 'M. Diop');
    });
  });

  // ── POST /edt/creneaux ─────────────────────────────────────────
  describe('POST /edt/creneaux', () => {
    test('crée un nouveau créneau EDT', async () => {
      // 1. db('classes as c')...first() → classe check
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      // 2. db('affectations_enseignants')...first() → affectation check
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));
      // 3. db('plages_horaires')...first() → plage check
      db.mockReturnValueOnce(mockQuery({ id: IDS.plage }));
      // 4. db('emplois_du_temps')...first() → conflit check → null
      db.mockReturnValueOnce(mockQuery(null));
      // 5. db('emplois_du_temps')...insert()...returning()
      db.mockReturnValueOnce(mockQuery([{ id: 'new-creneau' }]));

      const res = await request(app)
        .post('/edt/creneaux')
        .send({
          classe_id: IDS.classe,
          affectation_id: IDS.affectation,
          plage_id: IDS.plage,
          jour_semaine: 1,
          salle: 'Salle B2',
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
    });

    test('retourne 422 si créneau en conflit', async () => {
      // 1-3: checks passent
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.affectation }));
      db.mockReturnValueOnce(mockQuery({ id: IDS.plage }));
      // 4. conflit trouvé
      db.mockReturnValueOnce(mockQuery({ id: 'existing' }));

      const res = await request(app)
        .post('/edt/creneaux')
        .send({
          classe_id: IDS.classe,
          affectation_id: IDS.affectation,
          plage_id: IDS.plage,
          jour_semaine: 1,
          salle: 'Salle B2',
        })
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ECHOUEE');
    });
  });

  // ── PUT /edt/creneaux/:id ──────────────────────────────────────
  describe('PUT /edt/creneaux/:id', () => {
    test('modifie un créneau existant', async () => {
      // 1. exists check
      db.mockReturnValueOnce(mockQuery({ id: 'creneau-1', classe_id: IDS.classe }));
      // 2. update returning
      db.mockReturnValueOnce(mockQuery([{ id: 'creneau-1', salle: 'Salle C1' }]));

      const res = await request(app)
        .put('/edt/creneaux/creneau-1')
        .send({ salle: 'Salle C1' })
        .expect(200);

      expect(res.body.succes).toBe(true);
    });

    test('retourne 404 si créneau inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      await request(app)
        .put(`/edt/creneaux/${IDS.evaluation}`)
        .send({ salle: 'Salle X' })
        .expect(404);
    });
  });

  // ── DELETE /edt/creneaux/:id ───────────────────────────────────
  describe('DELETE /edt/creneaux/:id', () => {
    test('supprime (soft-delete) un créneau', async () => {
      db.mockReturnValueOnce(mockQuery({ id: 'creneau-1' }));
      db.mockReturnValueOnce(mockQuery(1));

      await request(app)
        .delete('/edt/creneaux/creneau-1')
        .expect(204);
    });

    test('retourne 404 si créneau inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      await request(app)
        .delete(`/edt/creneaux/${IDS.evaluation}`)
        .expect(404);
    });
  });
});
