'use strict';

// Base PostgreSQL réelle : connexion d'un parent sans code établissement,
// choix de l'école, bascule entre écoles (tâche 3.4).
// Budget limiteur d'auth : 9 appels sur 10 autorisés par fenêtre de 15 min.

jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerSMS: jest.fn(), envoyerOTP: jest.fn(), envoyerMotDePasseProvisoire: jest.fn(),
}));

const crypto = require('crypto');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, etabB, etabC, codeA, codeB, codeC, compteA, compteB;
const TEL = '+221772220501';          // parent dans A et B
const TEL_SEUL = '+221772220502';     // parent dans A seulement
const hash = (c) => crypto.createHash('sha256').update(c).digest('hex');

async function creerCompte(etabId, roleCode, { telephone, motDePasse, nom = 'Ndiaye' }) {
  const [u] = await db('utilisateurs').insert({
    etablissement_id: etabId, nom, prenom: 'Compte', telephone, actif: true,
    mot_de_passe_hash: motDePasse ? await bcrypt.hash(motDePasse, 4) : null,
  }).returning('*');
  const role = await db('roles').where({ code: roleCode }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: role.id, etablissement_id: etabId });
  return u;
}
const fixerCode = (utilisateurId, code) => db('otp_verifications')
  .where({ utilisateur_id: utilisateurId, utilise: false }).update({ code_hash: hash(code) });
const nouvelleEcole = async (nom, code) => (await db('etablissements').insert({
  nom, code_officiel: code, type: 'college', pays: 'Sénégal', ville: 'Thiès', actif: true,
}).returning('*'))[0];

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  codeA = seed.etablissement.code_officiel;
  etabB = await nouvelleEcole('Collège B', 'TEST_SEL_B'); codeB = etabB.code_officiel;
  etabC = await nouvelleEcole('Collège C', 'TEST_SEL_C'); codeC = etabC.code_officiel;
  compteA = await creerCompte(seed.etablissement.id, 'parent', { telephone: TEL });
  compteB = await creerCompte(etabB.id, 'parent', { telephone: TEL });
  await creerCompte(seed.etablissement.id, 'parent', { telephone: TEL_SEUL });
});
afterAll(async () => { await closeTestDB(); });

describe('parent présent dans deux écoles : connexion sans code établissement', () => {
  let ticket;

  test('un seul SMS, un code actif par compte', async () => {
    await request.post('/api/v1/auth/otp/demander').send({ telephone: '77 222 05 01' }).expect(200);
    const lignes = await db('otp_verifications').where({ telephone: TEL, utilise: false });
    expect(lignes.map(l => l.utilisateur_id).sort()).toEqual([compteA.id, compteB.id].sort());
    expect(new Set(lignes.map(l => l.code_hash)).size).toBe(1);   // même code pour les deux comptes

    await fixerCode(compteA.id, '123456');
    await fixerCode(compteB.id, '123456');
  });

  test('mauvais code → 401', async () => {
    await request.post('/api/v1/auth/otp/valider').send({ telephone: TEL, code: '000000' }).expect(401);
  });

  test('bon code → choix requis, avec la liste des écoles et un ticket', async () => {
    const res = await request.post('/api/v1/auth/otp/valider').send({ telephone: TEL, code: '123456' }).expect(200);
    expect(res.body.data.choix_requis).toBe(true);
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.etablissements.map(e => e.code).sort()).toEqual([codeA, codeB].sort());
    ticket = res.body.data.ticket;
    // Le code est consommé
    expect(await db('otp_verifications').where({ telephone: TEL, utilise: false })).toHaveLength(0);
  });

  test('ticket falsifié → 401', async () => {
    await request.post('/api/v1/auth/otp/choisir').send({ ticket: ticket + 'x', etablissement_code: codeA }).expect(401);
  });

  test('choisir l\'école A puis l\'école B avec le même ticket : sessions séparées', async () => {
    const a = await request.post('/api/v1/auth/otp/choisir').send({ ticket, etablissement_code: codeA }).expect(200);
    expect(a.body.data.utilisateur.etablissement_id).toBe(seed.etablissement.id);
    expect(a.body.data.utilisateur.id).toBe(compteA.id);

    const b = await request.post('/api/v1/auth/otp/choisir').send({ ticket, etablissement_code: codeB }).expect(200);
    expect(b.body.data.utilisateur.etablissement_id).toBe(etabB.id);
    expect(b.body.data.utilisateur.id).toBe(compteB.id);
  });

  test('une école absente du ticket est refusée (même si le code existe)', async () => {
    await request.post('/api/v1/auth/otp/choisir').send({ ticket, etablissement_code: codeC }).expect(401);
  });

  test('changer-etablissement : A → B accepté, A → C refusé, ancienne session toujours valable', async () => {
    const tokenA = await creerSession(compteA.id, seed.etablissement.id);

    const b = await request.post('/api/v1/auth/changer-etablissement')
      .set('Authorization', `Bearer ${tokenA}`).send({ etablissement_code: codeB }).expect(200);
    expect(b.body.data.utilisateur.etablissement_id).toBe(etabB.id);
    expect(b.body.data.utilisateur.id).toBe(compteB.id);

    await request.post('/api/v1/auth/changer-etablissement')
      .set('Authorization', `Bearer ${tokenA}`).send({ etablissement_code: codeC }).expect(403);

    await request.get('/api/v1/parents/moi/enfants').set('Authorization', `Bearer ${tokenA}`).expect(200);
  });

  test('un compte avec mot de passe ne peut pas basculer d\'école', async () => {
    const ens = await creerCompte(seed.etablissement.id, 'enseignant', { telephone: '+221772220599', motDePasse: 'Test1234!' });
    await creerCompte(etabB.id, 'enseignant', { telephone: '+221772220599', motDePasse: 'Test1234!' });
    const token = await creerSession(ens.id, seed.etablissement.id);
    await request.post('/api/v1/auth/changer-etablissement')
      .set('Authorization', `Bearer ${token}`).send({ etablissement_code: codeB }).expect(403);
  });
});

describe('parent d\'une seule école : connexion directe sans code établissement', () => {
  test('le bon code ouvre directement la session', async () => {
    await request.post('/api/v1/auth/otp/demander').send({ telephone: TEL_SEUL }).expect(200);
    const compte = await db('utilisateurs').where({ telephone: TEL_SEUL }).first('id');
    await fixerCode(compte.id, '654321');

    const res = await request.post('/api/v1/auth/otp/valider').send({ telephone: TEL_SEUL, code: '654321' }).expect(200);
    expect(res.body.data.choix_requis).toBeUndefined();
    expect(res.body.data.utilisateur.etablissement_id).toBe(seed.etablissement.id);
    expect(res.body.data.token).toBeDefined();
  });
});
