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

// ── GET /enseignants ────────────────────────────────────────────

describe('GET /api/v1/enseignants', () => {
  it('devrait lister les enseignants de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // seedTestData crée 1 enseignant
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('nom');
    expect(res.body.data[0]).toHaveProperty('specialite');
  });

  it('devrait refuser sans authentification', async () => {
    await request.get('/api/v1/enseignants').expect(401);
  });
});

// ── GET /enseignants/moi/classes ────────────────────────────────

describe('GET /api/v1/enseignants/moi/classes', () => {
  beforeAll(async () => {
    // Créer une affectation pour l'enseignant de test
    const db = getTestDB();
    const matiere = await db('matieres')
      .where({ etablissement_id: seed.etablissement.id })
      .first('id');

    if (matiere) {
      await db('affectations_enseignants').insert({
        enseignant_id: seed.enseignant.id,
        matiere_id: matiere.id,
        classe_id: seed.classe.id,
        annee_scolaire_id: seed.annee.id,
      }).onConflict().ignore();
    }
  });

  it('devrait retourner les classes affectées à l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait accepter un directeur ou refuser selon la politique', async () => {
    await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect((res) => {
        expect([200, 403]).toContain(res.status);
      });
  });
});

// ── GET /enseignants/moi/edt ────────────────────────────────────

describe('GET /api/v1/enseignants/moi/edt', () => {
  it('devrait retourner l\'EDT de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/edt')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ── GET /enseignants/moi/affectations ──────────────────────────

describe('GET /api/v1/enseignants/moi/affectations', () => {
  it('devrait retourner les affectations de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/affectations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── POST /enseignants ───────────────────────────────────────────

describe('POST /api/v1/enseignants', () => {
  it('devrait créer un nouvel enseignant', async () => {
    const res = await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:          'Sène',
        prenom:       'Oumar',
        telephone:    '+221770000099',
        specialite:   'Physique',
        type_contrat: 'vacataire',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
  });

  it('devrait refuser un doublon de téléphone', async () => {
    await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:       'Dupont',
        prenom:    'Jean',
        telephone: '+221770000099', // déjà utilisé ci-dessus
      })
      .expect(422);
  });

  it('devrait refuser sans authentification', async () => {
    await request.post('/api/v1/enseignants').send({}).expect(401);
  });
});
