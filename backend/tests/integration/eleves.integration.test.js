'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
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

// ── GET /eleves ────────────────────────────────────────────────

describe('GET /api/v1/eleves', () => {
  it('devrait lister les élèves de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/eleves')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(3);
    expect(res.body.meta.total).toBe(3);

    // Vérifier les champs retournés
    const eleve = res.body.data[0];
    expect(eleve).toHaveProperty('nom');
    expect(eleve).toHaveProperty('prenom');
    expect(eleve).toHaveProperty('matricule');
  });

  it('devrait paginer les résultats', async () => {
    const res = await request
      .get('/api/v1/eleves?page=1&limite=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.total).toBe(3);
    expect(res.body.meta.pages).toBe(2);
  });

  it('devrait filtrer par recherche (nom)', async () => {
    const res = await request
      .get(encodeURI('/api/v1/eleves?recherche=Traoré'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nom).toBe('Traoré');
  });

  it('devrait filtrer par classe_id', async () => {
    const res = await request
      .get(`/api/v1/eleves?classe_id=${seed.classe.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(3);
  });

  it('devrait retourner vide pour une classe inexistante', async () => {
    const res = await request
      .get('/api/v1/eleves?classe_id=00000000-0000-0000-0000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.data.length).toBe(0);
  });

  it('devrait refuser sans authentification', async () => {
    await request
      .get('/api/v1/eleves')
      .expect(401);
  });
});

// ── POST /eleves ───────────────────────────────────────────────

describe('POST /api/v1/eleves', () => {
  it('devrait inscrire un nouvel élève', async () => {
    const res = await request
      .post('/api/v1/eleves')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nom: 'Sow',
        prenom: 'Ibrahim',
        genre: 'M',
        date_naissance: '2007-05-12',
        classe_id: seed.classe.id,
        matricule: 'ELV-NEW',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
    expect(res.body.data).toHaveProperty('inscription_id');

    // Vérifier que l'élève apparaît dans la liste
    const listRes = await request
      .get(encodeURI('/api/v1/eleves?recherche=Sow'))
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].prenom).toBe('Ibrahim');
  });

  it('devrait refuser un nom trop court', async () => {
    await request
      .post('/api/v1/eleves')
      .set('Authorization', `Bearer ${token}`)
      .send({ nom: 'A', prenom: 'B', classe_id: seed.classe.id })
      .expect(422);
  });

  it('devrait refuser un classe_id invalide', async () => {
    await request
      .post('/api/v1/eleves')
      .set('Authorization', `Bearer ${token}`)
      .send({ nom: 'Test', prenom: 'Invalide', classe_id: 'not-a-uuid' })
      .expect(422);
  });
});

// ── GET /eleves/:eleve_id ──────────────────────────────────────

describe('GET /api/v1/eleves/:eleve_id', () => {
  it('devrait retourner le détail d\'un élève', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/eleves/${eleveId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.nom).toBe('Traoré');
    expect(res.body.data.prenom).toBe('Aminata');
  });

  it('devrait retourner 404 pour un ID inconnu', async () => {
    await request
      .get('/api/v1/eleves/00000000-0000-0000-0000-000000000099')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
