'use strict';

let mockSessionOverride = null;

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
    req.session = mockSessionOverride
      ? { ...mockSessionOverride }
      : { ...require('../helpers/testApp').defaultSession };
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

const router = require('../../src/domains/notifications.routes');
const app = createTestApp(router);

describe('Notifications Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    mockSessionOverride = null;
  });

  // ── Rôle enseignant seul ─────────────────────────────────────────
  // Régression m1 : req.session.role (singulier) a été remplacé par
  // req.session.roles (tableau). Un enseignant seul (pas d'autre rôle)
  // doit retrouver EXACTEMENT le même comportement qu'avant le fix —
  // seulement les catégories que notifsEnseignant() peut produire
  // (appels_manques, notes_publiees), pas les 5 catégories admin.
  describe('GET /notifications — rôle enseignant seul', () => {
    test('ne retourne que les catégories enseignant (pas absences/bulletins/incidents)', async () => {
      mockSessionOverride = {
        utilisateur_id: IDS.enseignant, etablissement_id: IDS.etablissement,
        roles: ['enseignant'], role: 'enseignant',
      };

      // notifsEnseignant() : 1. lookup enseignant, 2. appelsManques, 3. notes
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app).get('/notifications').expect(200);

      expect(res.body.succes).toBe(true);
      const types = res.body.data.categories.map(c => c.type);
      expect(types).toEqual(['appels_manques', 'notes_publiees']);
    });
  });

  // ── Rôle parent seul ─────────────────────────────────────────────
  describe('GET /notifications — rôle parent seul', () => {
    test('ne retourne que les catégories parent (pas appels_manques)', async () => {
      mockSessionOverride = {
        utilisateur_id: IDS.parent, etablissement_id: IDS.etablissement,
        roles: ['parent'], role: 'parent',
      };

      // notifsParent() : enfants → tableau vide → retour anticipé sans autre requête
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app).get('/notifications').expect(200);

      expect(res.body.succes).toBe(true);
      const types = res.body.data.categories.map(c => c.type);
      expect(types).toEqual(['absences_injustifiees', 'notes_publiees', 'bulletins_disponibles', 'incidents_discipline']);
      expect(types).not.toContain('appels_manques');
    });
  });

  // ── Rôle directeur (branche admin par défaut) ─────────────────────
  describe('GET /notifications — rôle directeur (défaut)', () => {
    test('retourne les 5 catégories admin (comportement inchangé)', async () => {
      // defaultSession = { roles: ['directeur'], ... }
      // notifsAdmin() : appelsManques, absences, notes, bulletins, incidents
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app).get('/notifications').expect(200);

      expect(res.body.succes).toBe(true);
      const types = res.body.data.categories.map(c => c.type);
      expect(types).toEqual([
        'appels_manques', 'absences_injustifiees', 'notes_publiees',
        'bulletins_disponibles', 'incidents_discipline',
      ]);
    });
  });

  // ── Rôle eleve seul (comportement pré-existant préservé) ──────────
  describe('GET /notifications — rôle eleve seul (aucune branche dédiée)', () => {
    test('bascule sur la branche admin par défaut, comme avant m1', async () => {
      mockSessionOverride = {
        utilisateur_id: IDS.eleve, etablissement_id: IDS.etablissement,
        roles: ['eleve'], role: 'eleve',
      };

      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app).get('/notifications').expect(200);

      const types = res.body.data.categories.map(c => c.type);
      expect(types).toEqual([
        'appels_manques', 'absences_injustifiees', 'notes_publiees',
        'bulletins_disponibles', 'incidents_discipline',
      ]);
    });
  });
});
