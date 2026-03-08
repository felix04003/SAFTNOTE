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
const { auditEntry, sessionActive } = require('../helpers/fixtures');

const router = require('../../src/domains/05-securite/securite.routes');
const app = createTestApp(router);

describe('Securite Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /securite/audit ─────────────────────────────────────────
  describe('GET /securite/audit', () => {
    test('retourne le journal d\'audit paginé', async () => {
      // Un seul db() call avec clone().count()
      db.mockReturnValueOnce(mockQuery([auditEntry], [{ count: '42' }]));

      const res = await request(app)
        .get('/securite/audit?page=1&limite=20')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('notes.saisir');
      expect(res.body.meta).toHaveProperty('total', 42);
    });

    test('supporte le filtre par action', async () => {
      db.mockReturnValueOnce(mockQuery([], [{ count: '0' }]));

      const res = await request(app)
        .get('/securite/audit?action=connexion')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.meta).toHaveProperty('total', 0);
    });
  });

  // ── GET /securite/sessions ──────────────────────────────────────
  describe('GET /securite/sessions', () => {
    test('retourne les sessions actives', async () => {
      db.mockReturnValueOnce(mockQuery([sessionActive]));

      const res = await request(app)
        .get('/securite/sessions')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].user_agent).toBe('EcoleManager-Mobile/1.0');
    });
  });

  // ── DELETE /securite/sessions/:id ───────────────────────────────
  describe('DELETE /securite/sessions/:id', () => {
    test('révoque une session', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.session, utilisateur_id: IDS.utilisateur }));
      db.mockReturnValueOnce(mockQuery(1));

      const res = await request(app)
        .delete(`/securite/sessions/${IDS.session}`)
        .expect(204);
    });

    test('retourne 404 si session inexistante', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .delete(`/securite/sessions/${IDS.evaluation}`)
        .expect(404);
    });
  });

  // ── POST /securite/blocage/:userId ──────────────────────────────
  describe('POST /securite/blocage/:userId', () => {
    test('bloque un compte utilisateur', async () => {
      // Utiliser un userId DIFFÉRENT de session.utilisateur_id (évite self-block 403)
      const targetUserId = IDS.autreUtilisateur;

      // 1. db('utilisateurs')...first() → utilisateur existe et actif
      db.mockReturnValueOnce(mockQuery({ id: targetUserId, nom: 'Konaté', prenom: 'Issa', actif: true }));
      // Transaction
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn()
          .mockReturnValueOnce(mockQuery(1))   // update utilisateurs
          .mockReturnValueOnce(mockQuery(2))   // update sessions
          .mockReturnValueOnce(mockQuery(1));   // insert journal_audit
        trx.raw = jest.fn().mockReturnValue('NOW()');
        await fn(trx);
      });

      const res = await request(app)
        .post(`/securite/blocage/${targetUserId}`)
        .send({ motif: 'Tentatives de connexion suspectes' })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('actif', false);
    });

    test('retourne 404 si utilisateur inexistant', async () => {
      db.mockReturnValueOnce(mockQuery(null));

      const res = await request(app)
        .post(`/securite/blocage/${IDS.autreUtilisateur}`)
        .send({ motif: 'Motif de test valide' })
        .expect(404);
    });
  });
});
