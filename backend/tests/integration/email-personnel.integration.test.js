'use strict';

// Base PostgreSQL réelle — règle d'email du 2026-10-07 (tâche 3.6) :
// un parent peut partager un email entre établissements ; un directeur ou un
// enseignant, jamais.

jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerSMS: jest.fn(), envoyerOTP: jest.fn(), envoyerMotDePasseProvisoire: jest.fn(),
}));

const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, etabB, tokenDirA, tokenDirB;

const creerEnseignant = (token, corps) => request
  .post('/api/v1/enseignants').set('Authorization', `Bearer ${token}`)
  .send({ nom: 'Cisse', prenom: 'Mame', ...corps });

async function creerCompte(etabId, roleCode, { email, telephone, nom = 'Test' }) {
  const [u] = await db('utilisateurs').insert({
    etablissement_id: etabId, nom, prenom: 'Compte', email, telephone, actif: true,
    mot_de_passe_hash: await bcrypt.hash('Test1234!', 4),
  }).returning('*');
  const role = await db('roles').where({ code: roleCode }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: role.id, etablissement_id: etabId });
  return u;
}

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDirA = await creerSession(seed.directeur.id, seed.etablissement.id);

  [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_EMAIL_B', type: 'college', pays: 'Sénégal', ville: 'Thiès', actif: true,
  }).returning('*');
  const dirB = await creerCompte(etabB.id, 'directeur', { email: 'dir.b@test.sn', telephone: '+221770000090', nom: 'Camara' });
  tokenDirB = await creerSession(dirB.id, etabB.id);
});

afterAll(async () => { await closeTestDB(); });

describe('email du personnel : jamais partagé entre établissements', () => {
  test('un enseignant ne peut pas reprendre l\'email du directeur d\'une AUTRE école', async () => {
    const res = await creerEnseignant(tokenDirB, { telephone: '77 111 00 01', email: 'directeur@test.sn' }).expect(422);   // email du directeur de A
    expect(res.body.erreur).toMatch(/membre du personnel d'un autre établissement/);
  });

  test('un enseignant avec un email libre est créé ; un autre enseignant ne peut pas le reprendre dans une autre école', async () => {
    await creerEnseignant(tokenDirB, { telephone: '77 111 00 02', email: 'ens.b@test.sn' }).expect(201);

    const res = await creerEnseignant(tokenDirA, { telephone: '77 111 00 03', email: 'ENS.B@test.sn' }).expect(422);   // casse ignorée
    expect(res.body.erreur).toMatch(/membre du personnel/);
  });

  test('l\'email d\'un PARENT d\'une autre école ne bloque pas le personnel', async () => {
    await creerCompte(seed.etablissement.id, 'parent', { email: 'parent@test.sn', telephone: '+221772220077' });

    await creerEnseignant(tokenDirB, { telephone: '77 111 00 04', email: 'parent@test.sn' }).expect(201);
  });

  test('deux parents de deux écoles peuvent avoir le même email (la base ne l\'interdit que dans une même école)', async () => {
    await creerCompte(seed.etablissement.id, 'parent', { email: 'partage@test.sn', telephone: '+221772220078' });
    await creerCompte(etabB.id, 'parent', { email: 'partage@test.sn', telephone: '+221772220078' });   // même email, même numéro, autre école : accepté

    const comptes = await db('utilisateurs').where({ email: 'partage@test.sn' });
    expect(new Set(comptes.map(c => c.etablissement_id)).size).toBe(2);
  });

  test('la base interdit toujours le même email deux fois dans la MÊME école', async () => {
    let erreur;
    try { await creerCompte(seed.etablissement.id, 'parent', { email: 'partage@test.sn', telephone: '+221772220079' }); }
    catch (e) { erreur = e; }
    expect(erreur && erreur.constraint).toBe('utilisateurs_etablissement_id_email_key');
  });
});

describe('PUT /enseignants/:id : changement d\'email', () => {
  let enseignantId, utilisateurId;

  beforeAll(async () => {
    const res = await creerEnseignant(tokenDirA, { telephone: '77 111 00 05', email: 'ens.a@test.sn' }).expect(201);
    enseignantId = res.body.data.enseignant_id;
    utilisateurId = res.body.data.utilisateur_id;
  });

  const modifier = (corps) => request.put(`/api/v1/enseignants/${enseignantId}`)
    .set('Authorization', `Bearer ${tokenDirA}`).send(corps);

  test('reprendre l\'email du personnel d\'une autre école → 422', async () => {
    const res = await modifier({ email: 'dir.b@test.sn' }).expect(422);
    expect(res.body.erreur).toMatch(/autre membre du personnel/);
  });

  test('remettre SON PROPRE email n\'est pas un conflit', async () => {
    await modifier({ email: 'ens.a@test.sn' }).expect(200);
  });

  test('prendre un email libre fonctionne', async () => {
    await modifier({ email: 'ens.a.nouveau@test.sn' }).expect(200);
    const u = await db('utilisateurs').where({ id: utilisateurId }).first('email');
    expect(u.email).toBe('ens.a.nouveau@test.sn');
  });
});
