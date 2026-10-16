'use strict';

// Base PostgreSQL réelle : les sept types d'évaluation de l'API sont tous acceptés par la base
// (migration 025 ; « oral » et « projet » étaient refusés par la contrainte CHECK).

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, token, affectationId;
const TYPES = ['devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet'];

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  token = await creerSession(seed.directeur.id, seed.etablissement.id);
  const [matiere] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Physique', code: 'PHY' }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).returning('*');
  affectationId = aff.id;
});
afterAll(async () => { await closeTestDB(); });

describe('types d\'évaluation', () => {
  test.each(TYPES)('POST /evaluations type « %s » → 201', async (type) => {
    const res = await request.post('/api/v1/evaluations').set('Authorization', `Bearer ${token}`).send({
      affectation_id: affectationId, periode_id: seed.periodes[0].id, type, numero: 1, note_max: 20, titre: `Type ${type}`,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe(type);
  });

  test('un type inconnu reste refusé (422)', async () => {
    await request.post('/api/v1/evaluations').set('Authorization', `Bearer ${token}`).send({
      affectation_id: affectationId, periode_id: seed.periodes[0].id, type: 'quiz', numero: 1, note_max: 20,
    }).expect(422);
  });
});
