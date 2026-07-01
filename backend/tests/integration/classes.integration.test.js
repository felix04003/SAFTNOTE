'use strict';

const supertest = require('supertest');
const {
  closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, token;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  token = await creerSession(seed.directeur.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /classes ────────────────────────────────────────────────

describe('GET /api/v1/classes', () => {
  it('devrait lister les classes de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const classe = res.body.data.find(c => c.nom === 'Term S1');
    expect(classe).toBeDefined();
  });

  it('devrait refuser sans authentification', async () => {
    await request
      .get('/api/v1/classes')
      .expect(401);
  });
});

// ── GET /classes/:classe_id/eleves ──────────────────────────────

describe('GET /api/v1/classes/:classe_id/eleves', () => {
  it('devrait retourner les élèves de la classe', async () => {
    const res = await request
      .get(`/api/v1/classes/${seed.classe.id}/eleves`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
  });

  it('devrait retourner 404 pour une classe inexistante', async () => {
    await request
      .get('/api/v1/classes/00000000-0000-0000-0000-000000000099/eleves')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
