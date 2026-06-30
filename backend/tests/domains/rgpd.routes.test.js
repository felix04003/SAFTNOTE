'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
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
jest.mock('../../src/middleware/validate.middleware', () => ({
  valider: (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({ succes: false, erreur: 'Validation', code: 'VALIDATION', details: result.error.issues });
    }
    req.body = result.data;
    next();
  },
}));

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');

const router = require('../../src/domains/02-acteurs/auth/rgpd.routes');
const app = createTestApp(router);

describe('RGPD Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /utilisateurs/moi/donnees ────────────────────────────────
  describe('GET /utilisateurs/moi/donnees', () => {
    test('exporte toutes les données personnelles', async () => {
      db.mockReturnValueOnce(mockQuery({
        id: '22222222-2222-2222-2222-222222222222',
        nom: 'Diallo', prenom: 'Moussa',
        email: 'moussa@ecole.sn', telephone: '+221770000000',
        date_naissance: '1980-01-01', genre: 'M', adresse: null,
        created_at: '2024-01-01',
      }));
      db.mockReturnValueOnce(mockQuery([{ role: 'directeur', etablissement: 'Lycée Delafosse' }]));
      db.mockReturnValueOnce(mockQuery([{ ip_address: '127.0.0.1', appareil: 'desktop', canal_connexion: 'web', revoquee: false }]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([]));
      db.mockReturnValueOnce(mockQuery([{ type: 'notifications_sms', accorde: true }]));

      const res = await request(app)
        .get('/utilisateurs/moi/donnees')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveProperty('compte');
      expect(res.body.data.compte).toHaveProperty('nom', 'Diallo');
      expect(res.body.data).toHaveProperty('roles');
      expect(res.body.data).toHaveProperty('historique_connexions');
      expect(res.body.data).toHaveProperty('consentements');
      expect(res.body.data).toHaveProperty('mention_légale');
      expect(res.body.data).toHaveProperty('exporté_le');
    });
  });

  // ── DELETE /utilisateurs/moi ─────────────────────────────────────
  describe('DELETE /utilisateurs/moi', () => {
    test('anonymise le compte et révoque les sessions', async () => {
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn()
          .mockReturnValueOnce(mockQuery(1))
          .mockReturnValueOnce(mockQuery(2))
          .mockReturnValueOnce(mockQuery(1));
        trx.raw = jest.fn().mockReturnValue('NOW()');
        await fn(trx);
      });

      const res = await request(app)
        .delete('/utilisateurs/moi')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.message).toContain('anonymisées');
    });
  });

  // ── POST /utilisateurs/moi/consentement ──────────────────────────
  describe('POST /utilisateurs/moi/consentement', () => {
    test('enregistre un nouveau consentement', async () => {
      db.mockReturnValueOnce(mockQuery(null));   // existing → null
      db.mockReturnValueOnce(mockQuery([{ id: 'c-1' }])); // insert

      const res = await request(app)
        .post('/utilisateurs/moi/consentement')
        .send({ type: 'notifications_sms', accorde: true })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.message).toContain('notifications_sms');
      expect(res.body.data.message).toContain('accordé');
    });

    test('met à jour un consentement existant', async () => {
      db.mockReturnValueOnce(mockQuery({ id: 'c-1' })); // existing
      db.mockReturnValueOnce(mockQuery(1));              // update

      const res = await request(app)
        .post('/utilisateurs/moi/consentement')
        .send({ type: 'notifications_whatsapp', accorde: false })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.message).toContain('retiré');
    });

    test('rejette un type invalide', async () => {
      const res = await request(app)
        .post('/utilisateurs/moi/consentement')
        .send({ type: 'type_inconnu', accorde: true })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });

    test('rejette si accorde manquant', async () => {
      const res = await request(app)
        .post('/utilisateurs/moi/consentement')
        .send({ type: 'analytics' })
        .expect(422);

      expect(res.body.succes).toBe(false);
    });
  });

  // ── GET /utilisateurs/moi/consentements ──────────────────────────
  describe('GET /utilisateurs/moi/consentements', () => {
    test('retourne la liste des consentements', async () => {
      db.mockReturnValueOnce(mockQuery([
        { type: 'notifications_sms',      accorde: true  },
        { type: 'notifications_whatsapp', accorde: false },
      ]));

      const res = await request(app)
        .get('/utilisateurs/moi/consentements')
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('type', 'notifications_sms');
    });

    test('retourne un tableau vide si aucun consentement', async () => {
      db.mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .get('/utilisateurs/moi/consentements')
        .expect(200);

      expect(res.body.data).toHaveLength(0);
    });
  });
});
