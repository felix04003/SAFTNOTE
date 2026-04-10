'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn().mockResolvedValue({ id: 'notif-001' }),
  enqueuerCalculMoyennes: jest.fn(), enqueuerGenerationBulletins: jest.fn(),
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
const { conversation, messageFixture } = require('../helpers/fixtures');

const router = require('../../src/domains/06-messagerie/messagerie.routes');
const app = createTestApp(router);

describe('Messagerie Routes', () => {
  let db;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── POST /conversations ─────────────────────────────────────────
  describe('POST /conversations', () => {
    const payload = {
      parent_id:     conversation.parent_id,
      enseignant_id: conversation.enseignant_id,
      eleve_id:      conversation.eleve_id,
    };

    it("crée une conversation si elle n'existe pas", async () => {
      // 1. enseignant lookup (utilisateur → enseignants row)
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignantRow }));
      // 2. affectation check (enseignant affecté à la classe de l'élève)
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      // 3. existing conversation → none
      db.mockReturnValueOnce(mockQuery(null));
      // 4. insert returning new conversation
      db.mockReturnValueOnce(mockQuery([conversation]));

      const res = await request(app)
        .post('/conversations')
        .send(payload)
        .expect(201);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(conversation.id);
    });

    it('retourne la conversation existante si le triplet existe', async () => {
      // 1. enseignant lookup
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignantRow }));
      // 2. affectation check
      db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
      // 3. existing conversation found
      db.mockReturnValueOnce(mockQuery(conversation));

      const res = await request(app)
        .post('/conversations')
        .send(payload)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.id).toBe(conversation.id);
    });
  });
});
