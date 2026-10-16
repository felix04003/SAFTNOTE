'use strict';

// Base PostgreSQL réelle : blocage / déblocage de compte, liste des comptes bloqués, sessions, audit

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns;
const { randomUUID } = require('crypto');
// Session supplémentaire pour un utilisateur (creerSession produit un jeton identique à la seconde près)
const insererSession = async (utilisateurId) => (await db('sessions').insert({
  utilisateur_id: utilisateurId, etablissement_id: seed.etablissement.id, token_hash: randomUUID().replace(/-/g, ''),
  ip_address: '127.0.0.1', user_agent: 'test', appareil: 'desktop', canal_connexion: 'web', revoquee: false,
  expire_at: db.raw("NOW() + INTERVAL '1 hour'"), derniere_activite: db.raw('NOW()'),
}).returning('*'))[0];
const avec = (methode, chemin, token) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});
afterAll(async () => { await closeTestDB(); });

describe('blocage de compte', () => {
  test('aucun compte bloqué au départ', async () => {
    const res = await avec('get', '/securite/comptes-bloques', tokenDir).expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('bloquer ferme les sessions, le compte apparaît dans la liste avec son rôle, et il est journalisé', async () => {
    expect((await avec('get', '/securite/sessions', tokenDir).expect(200)).body.data.some((s) => s.utilisateur_id === seed.enseignantUser.id)).toBe(true);

    const res = await avec('post', `/securite/blocage/${seed.enseignantUser.id}`, tokenDir).send({ motif: 'Absence prolongée' }).expect(200);
    expect(res.body.data.actif).toBe(false);

    const bloques = (await avec('get', '/securite/comptes-bloques', tokenDir).expect(200)).body.data;
    expect(bloques).toHaveLength(1);
    expect(bloques[0]).toMatchObject({ id: seed.enseignantUser.id, roles: 'enseignant' });

    expect((await avec('get', '/securite/sessions', tokenDir).expect(200)).body.data.some((s) => s.utilisateur_id === seed.enseignantUser.id)).toBe(false);
    await avec('get', '/securite/sessions', tokenEns).expect(401);          // sa session est fermée

    const audit = (await avec('get', '/securite/audit?limite=20', tokenDir).expect(200)).body.data;
    expect(audit.find((a) => a.action === 'utilisateurs.bloquer')).toMatchObject({ resultat: 'succes', utilisateur_id: seed.directeur.id });
  });

  test('débloquer (même route, bascule) le retire de la liste', async () => {
    const res = await avec('post', `/securite/blocage/${seed.enseignantUser.id}`, tokenDir).send({ motif: 'De retour' }).expect(200);
    expect(res.body.data.actif).toBe(true);
    expect((await avec('get', '/securite/comptes-bloques', tokenDir).expect(200)).body.data).toHaveLength(0);
  });

  test('on ne peut pas bloquer son propre compte, ni sans motif, ni sans droit', async () => {
    await avec('post', `/securite/blocage/${seed.directeur.id}`, tokenDir).send({ motif: 'Moi-même' }).expect(403);
    await avec('post', `/securite/blocage/${seed.enseignantUser.id}`, tokenDir).send({ motif: 'x' }).expect(422);
    await new Promise((r) => setTimeout(r, 1100));          // le jeton dépend de la seconde : en recréer un tout de suite donnerait le même
    const tokenEns2 = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
    await avec('post', `/securite/blocage/${seed.directeur.id}`, tokenEns2).send({ motif: 'Tentative' }).expect(403);
    await avec('get', '/securite/comptes-bloques', tokenEns2).expect(403);
  });

  test('un compte anonymisé (droit à l\'effacement) n\'est pas proposé au déblocage', async () => {
    const [u] = await db('utilisateurs').insert({
      etablissement_id: seed.etablissement.id, nom: 'ANONYME_1', prenom: 'Anonyme', actif: false,
    }).returning('*');
    const ids = (await avec('get', '/securite/comptes-bloques', tokenDir).expect(200)).body.data.map((c) => c.id);
    expect(ids).not.toContain(u.id);
  });

  test('un compte d\'une autre école n\'apparaît pas', async () => {
    const [etabB] = await db('etablissements').insert({ nom: 'B', code_officiel: 'SEC_B', type: 'college', pays: 'Sénégal', actif: true }).returning('*');
    const [uB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Bloque', prenom: 'Autre', actif: false }).returning('*');
    const ids = (await avec('get', '/securite/comptes-bloques', tokenDir).expect(200)).body.data.map((c) => c.id);
    expect(ids).not.toContain(uB.id);
    await avec('post', `/securite/blocage/${uB.id}`, tokenDir).send({ motif: 'Autre école' }).expect(404);
  });
});

describe('sessions', () => {
  test('révoquer une session la ferme ; une session inconnue est introuvable', async () => {
    const creee = await insererSession(seed.enseignantUser.id);
    const sessions = (await avec('get', `/securite/sessions?utilisateur_id=${seed.enseignantUser.id}`, tokenDir).expect(200)).body.data;
    expect(sessions.length).toBeGreaterThan(0);
    await avec('delete', `/securite/sessions/${creee.id}`, tokenDir).expect(204);
    await avec('delete', `/securite/sessions/${creee.id}`, tokenDir).expect(404);
  });
});
