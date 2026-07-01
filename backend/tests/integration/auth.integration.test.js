'use strict';

const supertest = require('supertest');
const {
  closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /auth/connexion ───────────────────────────────────────

describe('POST /api/v1/auth/connexion', () => {
  it('devrait connecter un directeur avec email et mot de passe', async () => {
    const res = await request
      .post('/api/v1/auth/connexion')
      .send({
        identifiant: 'directeur@test.sn',
        mot_de_passe: seed.mdpClair,
        etablissement_code: 'TEST_LBD',
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.token).toBeDefined();
    expect(res.body.data.utilisateur.nom).toBe('Diallo');
    expect(res.body.data.utilisateur.prenom).toBe('Moussa');
    expect(res.body.data.utilisateur.etablissement_nom).toBe('Lycée Test Blaise Diagne');
    expect(res.body.data.utilisateur.role).toBeDefined();
  });

  it('devrait connecter avec le numéro de téléphone', async () => {
    const res = await request
      .post('/api/v1/auth/connexion')
      .send({
        identifiant: '+221770000001',
        mot_de_passe: seed.mdpClair,
        etablissement_code: 'TEST_LBD',
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.token).toBeDefined();
  });

  it('devrait refuser un mot de passe incorrect', async () => {
    const res = await request
      .post('/api/v1/auth/connexion')
      .send({
        identifiant: 'directeur@test.sn',
        mot_de_passe: 'mauvais_mdp',
        etablissement_code: 'TEST_LBD',
      })
      .expect(401);

    expect(res.body.succes).toBe(false);
  });

  it('devrait refuser un code établissement inconnu', async () => {
    const res = await request
      .post('/api/v1/auth/connexion')
      .send({
        identifiant: 'directeur@test.sn',
        mot_de_passe: seed.mdpClair,
        etablissement_code: 'INEXISTANT',
      })
      .expect(401);

    expect(res.body.succes).toBe(false);
  });

  it('devrait rejeter un body incomplet', async () => {
    const res = await request
      .post('/api/v1/auth/connexion')
      .send({ identifiant: 'test' })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });
});

// ── POST /auth/deconnexion ─────────────────────────────────────

describe('POST /api/v1/auth/deconnexion', () => {
  it('devrait révoquer la session en base', async () => {
    // Connexion pour obtenir un token
    const loginRes = await request
      .post('/api/v1/auth/connexion')
      .send({
        identifiant: 'directeur@test.sn',
        mot_de_passe: seed.mdpClair,
        etablissement_code: 'TEST_LBD',
      })
      .expect(200);

    const token = loginRes.body.data.token;

    // Déconnexion
    await request
      .post('/api/v1/auth/deconnexion')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Réutiliser le token devrait échouer
    await request
      .get('/api/v1/auth/profil')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});

// ── GET /auth/profil ───────────────────────────────────────────

describe('GET /api/v1/auth/profil', () => {
  it('devrait retourner le profil de l\'utilisateur connecté', async () => {
    const token = await creerSession(seed.directeur.id, seed.etablissement.id);

    const res = await request
      .get('/api/v1/auth/profil')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.nom).toBe('Diallo');
    expect(res.body.data.prenom).toBe('Moussa');
    expect(res.body.data.etablissement_nom).toBe('Lycée Test Blaise Diagne');
  });

  it('devrait refuser sans token', async () => {
    await request
      .get('/api/v1/auth/profil')
      .expect(401);
  });
});
