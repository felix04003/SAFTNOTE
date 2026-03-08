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
const { enfant, lienParentEnfant, inscriptionCourante, noteEleve } = require('../helpers/fixtures');

const router = require('../../src/domains/02-acteurs/parents/parents.routes');
const app = createTestApp(router);

describe('Parents Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /parents/moi/enfants ─────────────────────────────────────
  describe('GET /parents/moi/enfants', () => {
    test('retourne la liste des enfants du parent', async () => {
      db.mockReturnValueOnce(mockQuery([enfant]));

      const res = await request(app)
        .get('/parents/moi/enfants')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].nom).toBe('Traoré');
      expect(res.body.data[0].classe).toBe('Term S1');
    });

    test('retourne liste vide si aucun enfant', async () => {
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .get('/parents/moi/enfants')
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });

  // ── GET /parents/moi/tableau-de-bord ────────────────────────────
  describe('GET /parents/moi/tableau-de-bord', () => {
    test('retourne le tableau de bord agrégé', async () => {
      // 1) liens parent-enfant
      db.mockReturnValueOnce(mockQuery([{
        ...lienParentEnfant,
        peut_voir_notes: true,
        peut_voir_absences: true,
      }]));

      // 2) getInscriptionCourante → db('inscriptions')
      db.mockReturnValueOnce(mockQuery(inscriptionCourante));

      // 3) db('utilisateurs') → élève info
      db.mockReturnValueOnce(mockQuery({ nom: 'Traoré', prenom: 'Aminata', photo_url: null }));

      // 4) moyenne générale
      db.mockReturnValueOnce(mockQuery({ moyenne_generale: 14.5, rang: 3, rang_sur: 35, mention: 'Bien', trimestre: 1 }));

      // 5) absences (peut_voir_absences = true)
      db.mockReturnValueOnce(mockQuery({ justifiees: 2, injustifiees: 1, retards: 3 }));

      // 6) dernières notes (peut_voir_notes = true)
      db.mockReturnValueOnce(mockQuery([noteEleve]));

      const res = await request(app)
        .get('/parents/moi/tableau-de-bord')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].enfant.prenom).toBe('Aminata');
      expect(res.body.data[0].moyenne_generale).toBeDefined();
    });

    test('retourne 404 si aucun enfant lié', async () => {
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .get('/parents/moi/tableau-de-bord')
        .expect(404);

      expect(res.body.code).toBe('RESSOURCE_INTROUVABLE');
    });
  });

  // ── GET /parents/moi/enfants/:id/notes ──────────────────────────
  describe('GET /parents/moi/enfants/:id/notes', () => {
    test('retourne les notes groupées par matière', async () => {
      // 1) verifierLienParentEnfant
      db.mockReturnValueOnce(mockQuery(lienParentEnfant));
      // 2) notes query
      db.mockReturnValueOnce(mockQuery([noteEleve]));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/notes`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.nb_notes).toBe(1);
      expect(res.body.data.par_matiere).toHaveLength(1);
      expect(res.body.data.par_matiere[0].matiere).toBe('Mathématiques');
    });

    test('retourne 403 si parent n\'a pas peut_voir_notes', async () => {
      db.mockReturnValueOnce(mockQuery({ ...lienParentEnfant, peut_voir_notes: false }));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/notes`)
        .expect(403);

      expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
    });

    test('retourne 403 si lien parent-enfant inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .get(`/parents/moi/enfants/fake-id/notes`)
        .expect(403);
    });
  });

  // ── GET /parents/moi/enfants/:id/absences ───────────────────────
  describe('GET /parents/moi/enfants/:id/absences', () => {
    test('retourne le récapitulatif et détail des absences', async () => {
      // verifierLienParentEnfant
      db.mockReturnValueOnce(mockQuery(lienParentEnfant));
      // getInscriptionCourante
      db.mockReturnValueOnce(mockQuery(inscriptionCourante));
      // recap
      db.mockReturnValueOnce(mockQuery([
        { trimestre: 1, periode: 'Trimestre 1', justifiees: 2, injustifiees: 1, retards: 3 },
      ]));
      // détail
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/absences`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.recapitulatif).toHaveLength(1);
    });

    test('retourne 403 si peut_voir_absences est false', async () => {
      db.mockReturnValueOnce(mockQuery({ ...lienParentEnfant, peut_voir_absences: false }));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/absences`)
        .expect(403);
    });
  });

  // ── GET /parents/moi/enfants/:id/bulletins ──────────────────────
  describe('GET /parents/moi/enfants/:id/bulletins', () => {
    test('retourne les bulletins validés', async () => {
      const { bulletin } = require('../helpers/fixtures');

      db.mockReturnValueOnce(mockQuery(lienParentEnfant));
      db.mockReturnValueOnce(mockQuery(inscriptionCourante));
      db.mockReturnValueOnce(mockQuery([bulletin]));
      // matieres par bulletin
      db.mockReturnValueOnce(mockQuery([{ matiere: 'Maths', moyenne: 15, coefficient: 5 }]));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/bulletins`)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.bulletins).toHaveLength(1);
      expect(res.body.data.bulletins[0].matieres).toBeDefined();
    });

    test('retourne 403 si peut_voir_bulletins est false', async () => {
      db.mockReturnValueOnce(mockQuery({ ...lienParentEnfant, peut_voir_bulletins: false }));

      const res = await request(app)
        .get(`/parents/moi/enfants/${IDS.eleve}/bulletins`)
        .expect(403);
    });
  });
});
