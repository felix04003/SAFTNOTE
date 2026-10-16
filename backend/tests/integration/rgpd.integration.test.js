'use strict';

// Base PostgreSQL réelle : droits RGPD de l'utilisateur connecté (export, consentements, effacement)

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, token;
const avec = (methode, chemin) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  token = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});
afterAll(async () => { await closeTestDB(); });

describe('RGPD', () => {
  test('consentements : aucun au départ, puis accorder, retirer, sans doublon', async () => {
    expect((await avec('get', '/utilisateurs/moi/consentements').expect(200)).body.data).toEqual([]);

    await avec('post', '/utilisateurs/moi/consentement').send({ type: 'notifications_sms', accorde: true }).expect(200);
    await avec('post', '/utilisateurs/moi/consentement').send({ type: 'analytics', accorde: true }).expect(200);
    await avec('post', '/utilisateurs/moi/consentement').send({ type: 'analytics', accorde: false }).expect(200);

    const liste = (await avec('get', '/utilisateurs/moi/consentements').expect(200)).body.data;
    expect(liste).toHaveLength(2);
    expect(Object.fromEntries(liste.map((c) => [c.type, c.accorde]))).toEqual({ notifications_sms: true, analytics: false });
    await avec('post', '/utilisateurs/moi/consentement').send({ type: 'inconnu', accorde: true }).expect(422);
  });

  test('export : mes données, rien des autres', async () => {
    const res = await avec('get', '/utilisateurs/moi/donnees').expect(200);
    expect(res.body.data.compte).toMatchObject({ id: seed.enseignantUser.id, nom: seed.enseignantUser.nom });
    expect(res.body.data.roles.map((r) => r.role)).toContain('enseignant');
    expect(res.body.data.consentements).toHaveLength(2);
    expect(JSON.stringify(res.body.data)).not.toContain(seed.directeur.email);
  });

  test('effacement : compte anonymisé et désactivé, sessions fermées, élèves et notes de l\'école conservés', async () => {
    const eleves = await db('eleves').count('id as n').first();
    await avec('delete', '/utilisateurs/moi').expect(200);

    const compte = await db('utilisateurs').where({ id: seed.enseignantUser.id }).first();
    expect(compte).toMatchObject({ prenom: 'Anonyme', email: null, telephone: null, actif: false });
    expect(compte.nom).toMatch(/^ANONYME_/);
    await avec('get', '/utilisateurs/moi/donnees').expect(401);                       // sa session est fermée
    expect(await db('eleves').count('id as n').first()).toEqual(eleves);
  });
});
