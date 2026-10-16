'use strict';

// Base PostgreSQL réelle : GET/PUT /securite/politique (tâche 2.4)

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, tokenDir, tokenEns;
const PUT = (token, corps) => request.put('/api/v1/securite/politique').set('Authorization', `Bearer ${token}`).send(corps);

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});
afterAll(async () => { await closeTestDB(); });

describe('politique de sécurité', () => {
  test('GET renvoie les valeurs de l\'établissement', async () => {
    const res = await request.get('/api/v1/securite/politique').set('Authorization', `Bearer ${tokenDir}`).expect(200);
    expect(res.body.data).toMatchObject({ blocage_nb_tentatives: 5, blocage_duree_minutes: 15, session_max_simultanees: 3 });
  });

  test('PUT modifie, renvoie la nouvelle valeur et journalise avant/après', async () => {
    const res = await PUT(tokenDir, { session_max_simultanees: 5, mdp_longueur_min: 10 }).expect(200);
    expect(res.body.data).toMatchObject({ session_max_simultanees: 5, mdp_longueur_min: 10, blocage_nb_tentatives: 5 });

    const ligne = await db('journal_audit').where({ action: 'securite.politique_modifier' }).first();
    expect(ligne.etablissement_id).toBe(seed.etablissement.id);
    const details = typeof ligne.details === 'string' ? JSON.parse(ligne.details) : ligne.details;
    expect(details.avant.session_max_simultanees).toBe(3);
    expect(details.apres).toEqual({ session_max_simultanees: 5, mdp_longueur_min: 10 });
  });

  test.each([
    [{ blocage_nb_tentatives: 2 }], [{ blocage_nb_tentatives: 11 }], [{ mdp_longueur_min: 7 }],
    [{ mdp_longueur_min: 33 }], [{ session_max_simultanees: 0 }], [{ session_max_simultanees: 6 }],
    [{ blocage_duree_minutes: 1 }], [{}], [{ mdp_longueur_min: 'dix' }],
  ])('valeur hors bornes %j → 422, rien n\'est modifié', async (corps) => {
    await PUT(tokenDir, corps).expect(422);
    const p = await db('politique_securite').where({ etablissement_id: seed.etablissement.id }).first();
    expect(p.mdp_longueur_min).toBe(10);
    expect(p.blocage_nb_tentatives).toBe(5);
  });

  test('un enseignant ne peut pas modifier (403)', async () => {
    await PUT(tokenEns, { session_max_simultanees: 1 }).expect(403);
  });
});
