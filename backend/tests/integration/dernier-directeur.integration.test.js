'use strict';

// Base PostgreSQL réelle : on ne ferme ni ne bloque jamais le dernier directeur actif d'un établissement

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenD1, tokenAdmin, d2;
const avec = (methode, chemin, token) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);
const bloquer = (token, id) => avec('post', `/securite/blocage/${id}`, token).send({ motif: 'Test garde-fou' });
const compte = (id) => db('utilisateurs').where({ id }).first();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function creerPersonnel(role, nom, telephone) {
  const [u] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom, prenom: role, telephone, actif: true }).returning('*');
  const r = await db('roles').where({ code: role }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: r.id, etablissement_id: seed.etablissement.id, actif: true });
  return u;
}

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  await db.raw("SELECT affecter_permissions('admin', ARRAY['admin.utilisateurs','admin.audit'])");
  tokenD1 = await creerSession(seed.directeur.id, seed.etablissement.id);
  const admin = await creerPersonnel('admin', 'Gestion', '+221770000401');
  tokenAdmin = await creerSession(admin.id, seed.etablissement.id);
});
afterAll(async () => { await closeTestDB(); });

describe('garde-fou : dernier directeur actif', () => {
  test('le seul directeur ne peut pas supprimer son compte (droit à l\'effacement)', async () => {
    const res = await avec('delete', '/utilisateurs/moi', tokenD1).expect(409);
    expect(res.body.code).toBe('DERNIER_DIRECTEUR');
    expect(res.body.erreur).toMatch(/seul directeur/);
    expect(await compte(seed.directeur.id)).toMatchObject({ nom: seed.directeur.nom, actif: true });
  });

  test('personne ne peut bloquer le seul directeur', async () => {
    const res = await bloquer(tokenAdmin, seed.directeur.id).expect(409);
    expect(res.body.code).toBe('DERNIER_DIRECTEUR');
    expect((await compte(seed.directeur.id)).actif).toBe(true);
  });

  test('avec un second directeur, on peut bloquer le premier ; le dernier reste protégé ; le déblocage est toujours permis', async () => {
    d2 = await creerPersonnel('directeur', 'Second', '+221770000402');
    await bloquer(tokenAdmin, seed.directeur.id).expect(200);
    expect((await compte(seed.directeur.id)).actif).toBe(false);

    expect((await bloquer(tokenAdmin, d2.id).expect(409)).body.code).toBe('DERNIER_DIRECTEUR');   // d2 est maintenant le dernier
    expect((await compte(d2.id)).actif).toBe(true);

    await bloquer(tokenAdmin, seed.directeur.id).expect(200);                                    // débloquer (bascule)
    expect((await compte(seed.directeur.id)).actif).toBe(true);
  });

  test('deux directeurs : l\'un peut supprimer son compte, l\'autre devient le dernier et est protégé', async () => {
    const tokenD2 = await creerSession(d2.id, seed.etablissement.id);
    await avec('delete', '/utilisateurs/moi', tokenD2).expect(200);
    expect(await compte(d2.id)).toMatchObject({ prenom: 'Anonyme', actif: false });

    await pause(1100);                                                                           // le blocage a fermé la session de d1 ; nouveau jeton = nouvelle seconde
    const nouveauToken = await creerSession(seed.directeur.id, seed.etablissement.id);
    const res = await avec('delete', '/utilisateurs/moi', nouveauToken).expect(409);
    expect(res.body.code).toBe('DERNIER_DIRECTEUR');
  });

  test('un enseignant, lui, peut toujours supprimer son compte', async () => {
    const tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
    await avec('delete', '/utilisateurs/moi', tokenEns).expect(200);
  });
});
