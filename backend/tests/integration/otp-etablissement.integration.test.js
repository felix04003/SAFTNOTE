'use strict';

// Base PostgreSQL réelle : un code OTP n'ouvre de session que dans
// l'établissement où le compte existe.

const crypto = require('crypto');
const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp,
} = require('./helpers');

let db, request, seed, codeA, codeB, parentA;
const TEL = '+221772220001';
const CODE_OTP = '123456';

beforeAll(async () => {
  db = getTestDB();
  request = supertest(createIntegrationApp());
  await truncateData();
  seed = await seedTestData();
  codeA = seed.etablissement.code_officiel;

  const [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_OTP_B', type: 'college', pays: 'SN', ville: 'Thiès', actif: true,
  }).returning('*');
  codeB = etabB.code_officiel;

  [parentA] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id, nom: 'Ndiaye', prenom: 'Père', telephone: TEL, actif: true,
  }).returning('*');
  const role = await db('roles').where({ code: 'parent' }).first();
  await db('utilisateur_roles').insert({
    utilisateur_id: parentA.id, role_id: role.id, etablissement_id: seed.etablissement.id,
  });
});

afterAll(async () => { await closeTestDB(); });

async function creerOtp() {
  await db('otp_verifications').insert({
    telephone: TEL,
    code_hash: crypto.createHash('sha256').update(CODE_OTP).digest('hex'),
    objectif: 'connexion',
    utilisateur_id: parentA.id,
  });
}

const valider = (code) => request.post('/api/v1/auth/otp/valider')
  .send({ telephone: TEL, code: CODE_OTP, etablissement_code: code });

describe('POST /auth/otp/valider — appartenance à l\'établissement', () => {
  test('code demandé pour l\'école A, validé avec le code de l\'école B → 401, aucune session', async () => {
    await creerOtp();
    const avant = await db('sessions').where({ utilisateur_id: parentA.id }).count('id as n').first();

    const res = await valider(codeB).expect(401);

    expect(res.body.code).toBe('OTP_INVALIDE');
    expect(res.body.data).toBeUndefined();
    const apres = await db('sessions').where({ utilisateur_id: parentA.id }).count('id as n').first();
    expect(apres.n).toBe(avant.n);
  });

  test('le même scénario avec le bon code d\'établissement ouvre bien la session A', async () => {
    await creerOtp();
    const res = await valider(codeA).expect(200);

    expect(res.body.data.utilisateur.etablissement_id).toBe(seed.etablissement.id);
    expect(res.body.data.utilisateur.role).toBe('parent');
    expect(res.body.data.utilisateur.doit_changer_mdp).toBe(false);
  });
});
