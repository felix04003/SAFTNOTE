'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, edtId;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Créer un créneau EDT pour pouvoir faire un appel
  const db = getTestDB();

  let matId;
  const matiere = await db('matieres')
    .where({ etablissement_id: seed.etablissement.id })
    .first('id')
    .catch(() => null);

  if (matiere) {
    matId = matiere.id;
  } else {
    const [m] = await db('matieres').insert({
      etablissement_id: seed.etablissement.id,
      nom: 'Histoire',
      code: 'HIST',
    }).returning('*');
    matId = m.id;
  }

  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id,
    matiere_id: matId,
    classe_id: seed.classe.id,
    annee_scolaire_id: seed.annee.id,
  }).onConflict(['classe_id', 'matiere_id', 'annee_scolaire_id']).merge().returning('*');

  const plage = await db('plages_horaires').first('id');
  if (!plage) return; // Skip si pas de plages

  const [edt] = await db('emplois_du_temps').insert({
    classe_id: seed.classe.id,
    affectation_id: aff.id,
    plage_id: plage.id,
    jour_semaine: 1, // Lundi
    salle: 'Salle 1',
    actif: true,
  }).returning('*');

  edtId = edt?.id;
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /appels ────────────────────────────────────────────────

describe('POST /api/v1/appels', () => {
  it('devrait créer un appel pour un créneau', async () => {
    if (!edtId) return; // Skip si pas de créneau

    const res = await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-18',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });

  it('devrait refuser de créer un doublon d\'appel (même créneau + date)', async () => {
    if (!edtId) return;

    await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-18', // même date
      })
      .expect(409); // Conflict
  });
});

// ── GET /appels/:id/presences ───────────────────────────────────

describe('GET /api/v1/appels/:id/presences', () => {
  let appelId;

  beforeAll(async () => {
    if (!edtId) return;
    const db = getTestDB();
    const appel = await db('appels')
      .where({ emploi_du_temps_id: edtId })
      .first('id');
    appelId = appel?.id;
  });

  it('devrait retourner la grille de présence', async () => {
    if (!appelId) return;

    const res = await request
      .get(`/api/v1/appels/${appelId}/presences`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // 3 élèves inscrits dans la classe de test
    expect(res.body.data.length).toBe(3);
  });

  it('devrait retourner 404 pour un appel inexistant', async () => {
    await request
      .get('/api/v1/appels/00000000-0000-0000-0000-000000000099/presences')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(404);
  });
});

// ── GET /appels/cours ───────────────────────────────────────────

describe('GET /api/v1/appels/cours', () => {
  it('devrait retourner null + élèves si aucun appel existant', async () => {
    if (!edtId) return;

    const res = await request
      .get('/api/v1/appels/cours')
      .query({ emploi_du_temps_id: edtId, date_cours: '2025-01-15' })
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.appel_id).toBeNull();
    expect(res.body.data.statut).toBeNull();
    expect(Array.isArray(res.body.data.eleves)).toBe(true);
  });

  it('devrait retourner appel_id + statut si un appel existe', async () => {
    if (!edtId) return;

    await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ emploi_du_temps_id: edtId, date_cours: '2025-02-10' });

    const res = await request
      .get('/api/v1/appels/cours')
      .query({ emploi_du_temps_id: edtId, date_cours: '2025-02-10' })
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.data.appel_id).not.toBeNull();
    expect(res.body.data.statut).toBe('ouvert');
  });

  it('devrait refuser si emploi_du_temps_id n\'appartient pas à l\'enseignant', async () => {
    await request
      .get('/api/v1/appels/cours')
      .query({ emploi_du_temps_id: '00000000-0000-0000-0000-000000000000', date_cours: '2025-01-15' })
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(403);
  });

  it('devrait refuser sans authentification', async () => {
    await request
      .get('/api/v1/appels/cours')
      .query({ emploi_du_temps_id: edtId || '00000000-0000-0000-0000-000000000000', date_cours: '2025-01-15' })
      .expect(401);
  });
});
