'use strict';

// Base PostgreSQL réelle : plages horaires par défaut (migration 026) et routes POST/PUT/DELETE /plages-horaires

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, tokenDir, tokenEns;
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

describe('plages horaires', () => {
  test('un établissement neuf reçoit des plages par défaut (avec récréation et pause déjeuner)', async () => {
    const [{ id }] = await db('etablissements').insert({ nom: 'Collège Neuf', code_officiel: `NEUF-${Date.now()}`, type: 'college', pays: 'Sénégal' }).returning('id');
    const plages = await db('plages_horaires').where({ etablissement_id: id }).orderBy('numero');
    expect(plages.length).toBeGreaterThanOrEqual(6);
    expect(plages.filter((p) => p.est_pause).map((p) => p.libelle)).toEqual(['Récréation', 'Pause déjeuner']);
    expect(plages.every((p) => p.heure_fin > p.heure_debut)).toBe(true);
  });

  test('GET liste les plages de l\'établissement', async () => {
    const res = await avec('get', '/plages-horaires', tokenDir).expect(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6);
  });

  test('POST crée une plage, refuse un numéro déjà pris et des heures incohérentes', async () => {
    const corps = { numero: 12, libelle: 'Étude', heure_debut: '17:00', heure_fin: '18:00' };
    const res = await avec('post', '/plages-horaires', tokenDir).send(corps).expect(201);
    expect(res.body.data).toMatchObject({ numero: 12, libelle: 'Étude', est_pause: false });
    await avec('post', '/plages-horaires', tokenDir).send(corps).expect(409);
    await avec('post', '/plages-horaires', tokenDir).send({ ...corps, numero: 13, heure_fin: '16:00' }).expect(422);
  });

  test('PUT modifie une plage ; un numéro déjà pris est refusé', async () => {
    const plage = await db('plages_horaires').where({ etablissement_id: seed.etablissement.id, numero: 12 }).first();
    const res = await avec('put', `/plages-horaires/${plage.id}`, tokenDir)
      .send({ numero: 12, libelle: 'Étude du soir', heure_debut: '17:00', heure_fin: '18:30' }).expect(200);
    expect(res.body.data.libelle).toBe('Étude du soir');
    await avec('put', `/plages-horaires/${plage.id}`, tokenDir)
      .send({ numero: 1, heure_debut: '17:00', heure_fin: '18:30' }).expect(409);
  });

  test('DELETE supprime une plage libre, refuse une plage utilisée par l\'emploi du temps', async () => {
    const libre = await db('plages_horaires').where({ etablissement_id: seed.etablissement.id, numero: 12 }).first();
    await avec('delete', `/plages-horaires/${libre.id}`, tokenDir).expect(204);

    const matiere = (await db('matieres').where({ etablissement_id: seed.etablissement.id }).first('id'))
      || (await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Histoire', code: 'HIST' }).returning('*'))[0];
    const [aff] = await db('affectations_enseignants').insert({
      enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
    }).onConflict(['classe_id', 'matiere_id', 'annee_scolaire_id']).merge().returning('*');
    const utilisee = await db('plages_horaires').where({ etablissement_id: seed.etablissement.id, numero: 1 }).first();
    await db('emplois_du_temps').insert({ classe_id: seed.classe.id, affectation_id: aff.id, plage_id: utilisee.id, jour_semaine: 2 });
    await avec('delete', `/plages-horaires/${utilisee.id}`, tokenDir).expect(409);
  });

  test('un enseignant ne peut pas modifier les horaires, et une plage d\'une autre école est introuvable', async () => {
    await avec('post', '/plages-horaires', tokenEns).send({ numero: 14, heure_debut: '06:00', heure_fin: '07:00' }).expect(403);
    const [{ id: autre }] = await db('etablissements').insert({ nom: 'Autre école', code_officiel: `AUTRE-${Date.now()}`, type: 'college', pays: 'Sénégal' }).returning('id');
    const etrangere = await db('plages_horaires').where({ etablissement_id: autre, numero: 1 }).first();
    await avec('delete', `/plages-horaires/${etrangere.id}`, tokenDir).expect(404);
  });
});
