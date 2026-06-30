'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(),
  getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    next();
  },
}));
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));
jest.mock('../../src/middleware/validate.middleware', () => ({
  valider: (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return res.status(422).json({ succes: false, erreur: 'Validation', code: 'VALIDATION', details: result.error.issues });
    req.body = result.data;
    next();
  },
}));
jest.mock('../../src/utils/medical-crypto', () => ({
  preparerDonneesMediacles: jest.fn((db, data) => {
    const cols = {};
    if (data.allergies !== undefined)            cols.allergies = data.allergies;
    if (data.conditions_medicales !== undefined) cols.conditions_medicales = data.conditions_medicales;
    if (data.groupe_sanguin !== undefined)       cols.groupe_sanguin = data.groupe_sanguin;
    if (data.medecin_urgence !== undefined)      cols.medecin_urgence = data.medecin_urgence;
    return cols;
  }),
  selecteursMedicaux: jest.fn(() => [
    'e.allergies', 'e.conditions_medicales', 'e.groupe_sanguin', 'e.medecin_urgence',
  ]),
}));

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');
const { preparerDonneesMediacles } = require('../../src/utils/medical-crypto');

const router = require('../../src/domains/02-acteurs/eleves/eleves.routes');
const app = createTestApp(router);

describe('Eleves Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    jest.clearAllMocks();
  });

  // ── GET /eleves ──────────────────────────────────────────────────
  describe('GET /eleves', () => {
    test('retourne la liste paginée des élèves', async () => {
      // La route fait db('inscriptions as i')...clone().count() pour le total
      // puis await query.select() pour les données — un seul appel db(), clone pour count
      const eleves = [
        { id: IDS.eleve, nom: 'Traoré', prenom: 'Aminata', matricule: 'E24001', classe: 'Term S1', moyenne: 14.5, nb_absences: 2 },
        { id: IDS.utilisateur, nom: 'Diallo', prenom: 'Moussa', matricule: 'E24002', classe: 'Term S1', moyenne: null, nb_absences: 0 },
      ];
      db.mockReturnValueOnce(mockQuery(eleves, [{ count: '2' }]));

      const res = await request(app).get('/eleves').expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toHaveProperty('total', 2);
    });
  });

  // ── POST /eleves ─────────────────────────────────────────────────
  describe('POST /eleves', () => {
    function mockTransaction(trx) {
      db.transaction.mockImplementation(async (fn) => {
        trx.raw = jest.fn().mockReturnValue('NOW()');
        return fn(trx);
      });
    }

    test('inscrit un élève sans données médicales', async () => {
      const trx = jest.fn()
        .mockReturnValueOnce(mockQuery({ id: IDS.annee }))
        .mockReturnValueOnce(mockQuery(null))
        .mockReturnValueOnce(mockQuery([{ id: IDS.eleve }]))
        .mockReturnValueOnce(mockQuery({ id: 'role-eleve' }))
        .mockReturnValueOnce(mockQuery(null))
        .mockReturnValueOnce(mockQuery(null));
      mockTransaction(trx);

      const res = await request(app)
        .post('/eleves')
        .send({ nom: 'Traoré', prenom: 'Aminata', classe_id: IDS.classe })
        .expect(201);

      expect(res.body.succes).toBe(true);
      expect(preparerDonneesMediacles).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ allergies: undefined, groupe_sanguin: undefined })
      );
    });

    test('inscrit un élève avec données médicales', async () => {
      const trx = jest.fn()
        .mockReturnValueOnce(mockQuery({ id: IDS.annee }))
        .mockReturnValueOnce(mockQuery(null))
        .mockReturnValueOnce(mockQuery([{ id: IDS.eleve }]))
        .mockReturnValueOnce(mockQuery({ id: 'role-eleve' }))
        .mockReturnValueOnce(mockQuery(null))
        .mockReturnValueOnce(mockQuery(null));
      mockTransaction(trx);

      const res = await request(app)
        .post('/eleves')
        .send({
          nom: 'Traoré', prenom: 'Aminata', classe_id: IDS.classe,
          allergies: 'Arachides', groupe_sanguin: 'O+',
          medecin_urgence: 'Dr Sow +221770000000',
        })
        .expect(201);

      expect(res.body.succes).toBe(true);
      expect(preparerDonneesMediacles).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ allergies: 'Arachides', groupe_sanguin: 'O+' })
      );
    });

    test('rejette un groupe sanguin invalide', async () => {
      const res = await request(app)
        .post('/eleves')
        .send({ nom: 'Traoré', prenom: 'Aminata', classe_id: IDS.classe, groupe_sanguin: 'X+' })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });

    test('rejette si classe_id manquant', async () => {
      const res = await request(app)
        .post('/eleves')
        .send({ nom: 'Traoré', prenom: 'Aminata' })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── GET /eleves/:eleve_id ─────────────────────────────────────────
  describe('GET /eleves/:eleve_id', () => {
    test('retourne la fiche élève avec champs médicaux déchiffrés', async () => {
      db.mockReturnValueOnce(mockQuery({
        id: IDS.eleve, nom: 'Traoré', prenom: 'Aminata',
        date_naissance: '2008-03-15', genre: 'F',
        telephone: null, adresse: null, photo_url: null,
        matricule: 'E24001', date_inscription: '2024-09-01',
        allergies: 'Arachides', conditions_medicales: null,
        groupe_sanguin: 'O+', medecin_urgence: 'Dr Sow',
      }));

      const res = await request(app)
        .get(`/eleves/${IDS.eleve}`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('nom', 'Traoré');
      expect(res.body.data).toHaveProperty('allergies', 'Arachides');
      expect(res.body.data).toHaveProperty('groupe_sanguin', 'O+');
    });

    test('retourne 404 si élève inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .get(`/eleves/${IDS.eleve}`)
        .expect(404);

      expect(res.body.code).toBe('RESSOURCE_INTROUVABLE');
    });
  });
});
