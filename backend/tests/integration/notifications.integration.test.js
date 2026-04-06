'use strict';

const express   = require('express');
const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  creerSession, JWT_SECRET,
} = require('./helpers');

let app, request, seed, tokenDir;

beforeAll(async () => {
  process.env.JWT_SECRET  = JWT_SECRET;
  process.env.NODE_ENV    = 'test';

  // Patch the pool to use the test DB
  const pool = require('../../src/infrastructure/database/pool');
  pool.getDB    = () => getTestDB();
  pool.connectDB = async () => {
    const db = getTestDB();
    await db.raw('SELECT 1');
    return db;
  };

  const errorHandler        = require('../../src/middleware/error.middleware');
  const { notFound }        = require('../../src/middleware/notFound.middleware');
  const notificationsRouter = require('../../src/domains/notifications.routes');

  app = express();
  app.use(express.json());
  app.use('/api/v1', notificationsRouter);
  app.use(notFound);
  app.use(errorHandler);

  request = supertest(app);

  await truncateData();
  seed     = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /api/v1/notifications ──────────────────────────────────

describe('GET /api/v1/notifications', () => {
  it('returns 200 with correct structure for admin (tokenDir)', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(typeof res.body.data.total).toBe('number');
    expect(Array.isArray(res.body.data.categories)).toBe(true);
  });

  it('returns 401 without token', async () => {
    await request
      .get('/api/v1/notifications')
      .expect(401);
  });

  it('each category has type, label, count, items', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    const { categories } = res.body.data;
    expect(Array.isArray(categories)).toBe(true);

    for (const cat of categories) {
      expect(cat).toHaveProperty('type');
      expect(cat).toHaveProperty('label');
      expect(cat).toHaveProperty('count');
      expect(cat).toHaveProperty('items');
      expect(typeof cat.type).toBe('string');
      expect(typeof cat.label).toBe('string');
      expect(typeof cat.count).toBe('number');
      expect(Array.isArray(cat.items)).toBe(true);
    }
  });

  it('total equals the sum of all category counts', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    const { total, categories } = res.body.data;
    const sum = categories.reduce((acc, c) => acc + c.count, 0);
    expect(total).toBe(sum);
  });
});
