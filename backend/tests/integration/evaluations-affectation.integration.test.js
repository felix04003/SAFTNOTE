'use strict';

// Base PostgreSQL réelle : qui peut créer une évaluation sur quelle affectation (POST /evaluations)

const supertest = require('supertest');
const { randomUUID } = require('crypto');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, affectationId, tokenDirA, tokenEns, tokenDirB;
const creer = (token, corps) => request.post('/api/v1/evaluations').set('Authorization', `Bearer ${token}`).send(corps);
const corps = () => ({ affectation_id: affectationId, periode_id: seed.periodes[0].id, type: 'devoir', numero: 1, note_max: 20 });

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDirA = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  const matiere = (await db('matieres').where({ etablissement_id: seed.etablissement.id }).first('id'))
    || (await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Histoire', code: 'HIST' }).returning('*'))[0];
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).onConflict(['classe_id', 'matiere_id', 'annee_scolaire_id']).merge().returning('*');
  affectationId = aff.id;

  // Directeur d'une AUTRE école
  const [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_B_AFF', type: 'college', pays: 'Sénégal', actif: true,
  }).returning('*');
  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id, nom: 'Camara', prenom: 'Ibrahima', email: 'dir@b-aff.sn',
    telephone: '+221770000191', mot_de_passe_hash: 'x', actif: true,
  }).returning('*');
  const roleDir = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: roleDir.id, etablissement_id: etabB.id, actif: true });
  tokenDirB = await creerSession(dirB.id, etabB.id);
});
afterAll(async () => { await closeTestDB(); });

describe('POST /evaluations — contrôle de l\'affectation', () => {
  test('le directeur d\'une autre école ne peut pas créer d\'évaluation sur cette affectation (404)', async () => {
    await creer(tokenDirB, corps()).expect(404);
    expect(await db('evaluations').where({ affectation_id: affectationId })).toHaveLength(0);
  });

  test('une affectation inexistante est introuvable (404)', async () => {
    await creer(tokenDirA, { ...corps(), affectation_id: randomUUID() }).expect(404);
  });

  test('l\'enseignant titulaire de l\'affectation, et la direction de l\'école, peuvent créer', async () => {
    await creer(tokenEns, corps()).expect(201);
    await creer(tokenDirA, { ...corps(), numero: 2 }).expect(201);
  });

  test('un id fourni par le mobile est conservé, et le rejeu est idempotent', async () => {
    const id = randomUUID();
    const res = await creer(tokenEns, { ...corps(), numero: 3, id }).expect(201);
    expect(res.body.data.id).toBe(id);
    const rejeu = await creer(tokenEns, { ...corps(), numero: 3, id }).expect(200);
    expect(rejeu.body.data.id).toBe(id);
    expect(await db('evaluations').where({ id })).toHaveLength(1);
  });

  test('un enseignant n\'a pas accès à l\'affectation d\'un collègue (404)', async () => {
    const [autreUser] = await db('utilisateurs').insert({
      etablissement_id: seed.etablissement.id, nom: 'Autre', prenom: 'Prof', telephone: '+221770000192', actif: true,
    }).returning('*');
    const [autreEns] = await db('enseignants').insert({ utilisateur_id: autreUser.id }).returning('*');
    const roleEns = await db('roles').where({ code: 'enseignant' }).first();
    await db('utilisateur_roles').insert({ utilisateur_id: autreUser.id, role_id: roleEns.id, etablissement_id: seed.etablissement.id, actif: true });
    const tokenAutre = await creerSession(autreUser.id, seed.etablissement.id);
    expect(autreEns.id).toBeDefined();
    await creer(tokenAutre, { ...corps(), numero: 4 }).expect(404);
  });
});
