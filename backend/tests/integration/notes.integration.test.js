'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, affectationId;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Créer une affectation enseignant <-> matière <-> classe
  const db = getTestDB();
  const matiere = await db('matieres')
    .where({ etablissement_id: seed.etablissement.id })
    .first('id');

  if (!matiere) {
    const [m] = await db('matieres').insert({
      etablissement_id: seed.etablissement.id,
      nom: 'Mathématiques',
      code: 'MATH',
    }).returning('*');
    const [aff] = await db('affectations_enseignants').insert({
      enseignant_id: seed.enseignant.id,
      matiere_id: m.id,
      classe_id: seed.classe.id,
      annee_scolaire_id: seed.annee.id,
    }).returning('*');
    affectationId = aff.id;
  } else {
    const [aff] = await db('affectations_enseignants')
      .insert({
        enseignant_id: seed.enseignant.id,
        matiere_id: matiere.id,
        classe_id: seed.classe.id,
        annee_scolaire_id: seed.annee.id,
      })
      .onConflict(['enseignant_id', 'matiere_id', 'classe_id', 'annee_scolaire_id'])
      .merge()
      .returning('*');
    affectationId = aff.id;
  }
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /evaluations ──────────────────────────────────────────

describe('POST /api/v1/evaluations', () => {
  it('devrait créer une évaluation', async () => {
    const res = await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        affectation_id:  affectationId,
        periode_id:      seed.periodes[0].id,
        titre:           'Devoir 1',
        type:            'devoir',
        numero:          1,
        date_evaluation: '2024-11-15',
        note_max:        20,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });

  it('devrait refuser sans affectation_id', async () => {
    await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ titre: 'Test incomplet' })
      .expect(422);
  });
});

// ── GET /evaluations ───────────────────────────────────────────

describe('GET /api/v1/evaluations', () => {
  it('devrait lister les évaluations de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait refuser sans token', async () => {
    await request.get('/api/v1/evaluations').expect(401);
  });
});

// ── POST /evaluations/:id/notes ────────────────────────────────

describe('POST /api/v1/evaluations/:id/notes (saisie)', () => {
  let evalId;

  beforeAll(async () => {
    // Créer une évaluation
    const res = await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        affectation_id:  affectationId,
        periode_id:      seed.periodes[0].id,
        titre:           'Devoir pour saisie',
        type:            'devoir',
        numero:          2,
        date_evaluation: '2024-11-20',
        note_max:        20,
      });
    evalId = res.body.data?.id;
  });

  it('devrait saisir les notes des élèves', async () => {
    if (!evalId) return;

    const notes = seed.eleves.map(e => ({
      eleve_id: e.user.id,
      note:     Math.floor(Math.random() * 20),
    }));

    const res = await request
      .post(`/api/v1/evaluations/${evalId}/notes`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ notes })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('devrait retourner 404 pour une évaluation inexistante', async () => {
    await request
      .post('/api/v1/evaluations/00000000-0000-0000-0000-000000000099/notes')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ notes: [] })
      .expect(404);
  });
});
