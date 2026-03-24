'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /discipline/sanctions ─────────────────────────────────

describe('POST /api/v1/discipline/sanctions', () => {
  it('devrait créer une sanction', async () => {
    const inscription = seed.eleves[0].inscription;

    const res = await request
      .post('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        inscription_id:  inscription.id,
        type:            'avertissement_oral',
        motif:           'Perturbation en classe',
        date_prononcee:  '2024-11-15',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.type).toBe('avertissement');
  });

  it('devrait refuser sans motif', async () => {
    await request
      .post('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        inscription_id: seed.eleves[0].inscription.id,
        type: 'avertissement',
        // motif manquant
      })
      .expect(422);
  });

  it('devrait refuser sans authentification', async () => {
    await request.post('/api/v1/discipline/sanctions').send({}).expect(401);
  });
});

// ── GET /discipline/sanctions ──────────────────────────────────

describe('GET /api/v1/discipline/sanctions', () => {
  it('devrait lister les sanctions de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait filtrer par classe_id', async () => {
    const res = await request
      .get(`/api/v1/discipline/sanctions?classe_id=${seed.classe.id}`)
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    for (const sanction of res.body.data) {
      expect(sanction.classe).toBeDefined();
    }
  });
});

// ── GET /discipline/eleves/:id/dossier ────────────────────────

describe('GET /api/v1/discipline/eleves/:id/dossier', () => {
  it('devrait retourner le dossier disciplinaire d\'un élève', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/discipline/eleves/${eleveId}/dossier`)
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('devrait retourner 404 pour un élève inexistant', async () => {
    await request
      .get('/api/v1/discipline/eleves/00000000-0000-0000-0000-000000000099/dossier')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(404);
  });
});
