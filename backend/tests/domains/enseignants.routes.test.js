'use strict';

// ── Mocks de modules (AVANT tout require) ──────────────────────────
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
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(),
  log: jest.fn(),
}));

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');
const { enseignantProfil, anneeCourante, classeTermS1, creneauEdt } = require('../helpers/fixtures');

// ── Mock auth & permission ─────────────────────────────────────────
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

// ── Chargement du routeur APRÈS les mocks ─────────────────────────
const router = require('../../src/domains/02-acteurs/enseignants/enseignants.routes');
const app = createTestApp(router);

// ═══════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════

describe('Enseignants Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /enseignants/moi/classes ─────────────────────────────────
  describe('GET /enseignants/moi/classes', () => {
    test('retourne les classes de l\'enseignant connecté', async () => {
      db.mockReturnValueOnce(mockQuery(enseignantProfil))  // db('enseignants').first()
        .mockReturnValueOnce(mockQuery(anneeCourante))     // db('annees_scolaires').first()
        .mockReturnValueOnce(mockQuery([classeTermS1]))    // db('affectations_enseignants')
        .mockReturnValueOnce(mockQuery([{ count: '32' }])); // db('inscriptions').count()

      const res = await request(app)
        .get('/enseignants/moi/classes')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        classe_id: IDS.classe,
        matiere: 'Mathématiques',
      });
      expect(res.body.meta).toHaveProperty('annee');
    });

    test('retourne 403 si profil enseignant introuvable', async () => {
      db.mockReturnValueOnce(mockQuery(null)); // enseignant non trouvé

      const res = await request(app)
        .get('/enseignants/moi/classes')
        .expect(403);

      expect(res.body.succes).toBe(false);
      expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
    });
  });

  // ── GET /enseignants/moi/edt ─────────────────────────────────────
  describe('GET /enseignants/moi/edt', () => {
    test('retourne l\'EDT organisé par jour', async () => {
      db.mockReturnValueOnce(mockQuery(enseignantProfil))
        .mockReturnValueOnce(mockQuery(anneeCourante))
        .mockReturnValueOnce(mockQuery([creneauEdt]));

      const res = await request(app)
        .get('/enseignants/moi/edt')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('nb_creneaux', 1);
      expect(res.body.data.emploi_du_temps).toHaveLength(1);
      expect(res.body.data.emploi_du_temps[0].nom).toBe('Lundi');
    });
  });

  // ── GET /enseignants/:id/affectations ────────────────────────────
  describe('GET /enseignants/:id/affectations', () => {
    test('retourne les affectations d\'un enseignant', async () => {
      const affectation = {
        affectation_id: IDS.affectation,
        classe_id: IDS.classe,
        classe: 'Term S1',
        niveau: 'Terminale',
        cycle: 'secondaire',
        matiere_id: IDS.matiere,
        matiere: 'Mathématiques',
        matiere_code: 'MATH',
        est_titulaire: true,
        date_debut: '2024-10-01',
        date_fin: null,
        annee_scolaire: '2024-2025',
      };

      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant, nom: 'Diallo', prenom: 'Moussa' }))
        .mockReturnValueOnce(mockQuery({ id: IDS.enseignant })) // estLuiMeme
        .mockReturnValueOnce(mockQuery(anneeCourante))          // anneeCourante
        .mockReturnValueOnce(mockQuery([affectation]));         // affectations

      const res = await request(app)
        .get(`/enseignants/${IDS.enseignant}/affectations`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].matiere).toBe('Mathématiques');
    });

    test('retourne 404 si enseignant introuvable', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .get(`/enseignants/fake-id/affectations`)
        .expect(404);

      expect(res.body.code).toBe('RESSOURCE_INTROUVABLE');
    });
  });

  // ── PUT /enseignants/:id ─────────────────────────────────────────
  describe('PUT /enseignants/:id', () => {
    test('modifie le profil avec des champs contact', async () => {
      const profilMaj = {
        id: IDS.enseignant, utilisateur_id: IDS.utilisateur,
        nom: 'Diallo', prenom: 'Moussa', telephone: '+221771234567',
      };

      db.mockReturnValueOnce(mockQuery({
        id: IDS.enseignant, utilisateur_id: IDS.utilisateur, nom: 'Diallo', prenom: 'Moussa',
      }))
        .mockReturnValueOnce(mockQuery(profilMaj)); // rechargement profil

      // db.transaction mock — trx calls
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn(() => mockQuery(1));
        await fn(trx);
      });

      const res = await request(app)
        .put(`/enseignants/${IDS.enseignant}`)
        .send({ telephone: '+221771234567' })
        .expect(200);

      expect(res.body.succes).toBe(true);
    });

    test('rejette si aucun champ à modifier', async () => {
      db.mockReturnValueOnce(mockQuery({
        id: IDS.enseignant, utilisateur_id: IDS.utilisateur, nom: 'X', prenom: 'Y',
      }));

      const res = await request(app)
        .put(`/enseignants/${IDS.enseignant}`)
        .send({})
        .expect(422);

      expect(res.body.code).toBe('VALIDATION_ECHOUEE');
    });
  });
});
