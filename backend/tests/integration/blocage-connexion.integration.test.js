'use strict';

// Base PostgreSQL réelle : le blocage après échecs de connexion suit la
// politique de CHAQUE établissement (migration 022), jamais celle d'un autre.

const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp,
} = require('./helpers');

let db, request, seed, codeA, codeB;
const MDP = 'Test1234!';

const connexion = (identifiant, mdp, code) => request.post('/api/v1/auth/connexion')
  .send({ identifiant, mot_de_passe: mdp, etablissement_code: code });

beforeAll(async () => {
  db = getTestDB();
  request = supertest(createIntegrationApp());
  await truncateData();
  seed = await seedTestData();
  codeA = seed.etablissement.code_officiel;

  const [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_BLOC_B', type: 'college', pays: 'SN', ville: 'Thiès', actif: true,
  }).returning('*');
  codeB = etabB.code_officiel;

  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id, nom: 'Sy', prenom: 'Ali', email: 'dir.b@test.sn', actif: true,
    mot_de_passe_hash: await bcrypt.hash(MDP, 4),
  }).returning('*');
  const role = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: role.id, etablissement_id: etabB.id });

  // A : très strict (2 échecs) ; B : très laxiste (50). La politique de B ne
  // doit en aucun cas desserrer celle de A (ancienne fonction : MAX de toutes).
  await db('politique_securite').where({ etablissement_id: seed.etablissement.id }).update({ blocage_nb_tentatives: 2 });
  await db('politique_securite').where({ etablissement_id: etabB.id }).update({ blocage_nb_tentatives: 50 });
  await db('tentatives_connexion').del();
});

afterAll(async () => { await closeTestDB(); });

describe('blocage de connexion par établissement', () => {
  test('l\'école A (2 échecs) bloque après 2 échecs malgré l\'école B à 50', async () => {
    await connexion('directeur@test.sn', 'faux-1', codeA).expect(401);
    await connexion('directeur@test.sn', 'faux-2', codeA).expect(401);

    const res = await connexion('directeur@test.sn', MDP, codeA).expect(429);
    expect(res.body.code).toBe('COMPTE_BLOQUE');
  });

  test('l\'école B (50) n\'est pas bloquée par les échecs de l\'école A', async () => {
    const res = await connexion('dir.b@test.sn', MDP, codeB).expect(200);
    expect(res.body.data.utilisateur.etablissement_id).toBeDefined();
  });

  test('code établissement inconnu : valeurs par défaut strictes, pas de tentatives illimitées', async () => {
    let bloque = false;
    for (let i = 0; i < 4 && !bloque; i++) {
      const res = await connexion(`inconnu${i}@test.sn`, 'x-faux', 'CODE_INEXISTANT');
      bloque = res.status === 429 && res.body.code === 'COMPTE_BLOQUE';
    }
    expect(bloque).toBe(true);
  });
});
