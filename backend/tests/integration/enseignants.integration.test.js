'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /enseignants ────────────────────────────────────────────

describe('GET /api/v1/enseignants', () => {
  it('devrait lister les enseignants de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // seedTestData crée 1 enseignant
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('nom');
    expect(res.body.data[0]).toHaveProperty('specialite');
  });

  it('devrait refuser sans authentification', async () => {
    await request.get('/api/v1/enseignants').expect(401);
  });
});

// ── GET /enseignants/moi/classes ────────────────────────────────

describe('GET /api/v1/enseignants/moi/classes', () => {
  beforeAll(async () => {
    // Créer une affectation pour l'enseignant de test
    const db = getTestDB();
    const matiere = await db('matieres')
      .where({ etablissement_id: seed.etablissement.id })
      .first('id');

    if (matiere) {
      await db('affectations_enseignants').insert({
        enseignant_id: seed.enseignant.id,
        matiere_id: matiere.id,
        classe_id: seed.classe.id,
        annee_scolaire_id: seed.annee.id,
      }).onConflict().ignore();
    }
  });

  it('devrait retourner les classes affectées à l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait accepter un directeur ou refuser selon la politique', async () => {
    await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect((res) => {
        expect([200, 403]).toContain(res.status);
      });
  });
});

// ── GET /enseignants/moi/edt ────────────────────────────────────

describe('GET /api/v1/enseignants/moi/edt', () => {
  it('devrait retourner l\'EDT de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/edt')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ── PUT /enseignants/moi/edt/:creneau_id/salle ─────────────────

describe('PUT /api/v1/enseignants/moi/edt/:creneau_id/salle', () => {
  let creneauId;

  beforeAll(async () => {
    const db = getTestDB();

    // S'assurer qu'il existe une matière et une affectation
    let matId;
    const matiere = await db('matieres')
      .where({ etablissement_id: seed.etablissement.id })
      .first('id').catch(() => null);

    if (matiere) {
      matId = matiere.id;
    } else {
      const [m] = await db('matieres').insert({
        etablissement_id: seed.etablissement.id,
        nom: 'Maths',
        code: 'MATH',
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
    if (!plage) return;

    const [edt] = await db('emplois_du_temps').insert({
      classe_id: seed.classe.id,
      affectation_id: aff.id,
      plage_id: plage.id,
      jour_semaine: 2,
      salle: 'Salle A',
      actif: true,
    }).returning('*');

    creneauId = edt?.id;
  });

  it('devrait mettre à jour la salle d\'un créneau appartenant à l\'enseignant', async () => {
    if (!creneauId) return;

    const res = await request
      .put(`/api/v1/enseignants/moi/edt/${creneauId}/salle`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ salle: 'Salle B' })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.salle).toBe('Salle B');
  });

  it('devrait retourner 404 pour un créneau non propriétaire', async () => {
    await request
      .put('/api/v1/enseignants/moi/edt/00000000-0000-0000-0000-000000000099/salle')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ salle: 'Salle X' })
      .expect(404);
  });

  it('devrait refuser une salle trop longue (> 50 caractères)', async () => {
    if (!creneauId) return;

    await request
      .put(`/api/v1/enseignants/moi/edt/${creneauId}/salle`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ salle: 'A'.repeat(51) })
      .expect(422);
  });
});

// ── GET /enseignants/moi/affectations ──────────────────────────

describe('GET /api/v1/enseignants/moi/affectations', () => {
  it('devrait retourner les affectations de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/affectations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── POST /enseignants ───────────────────────────────────────────

describe('POST /api/v1/enseignants', () => {
  it('devrait créer un nouvel enseignant', async () => {
    const res = await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:          'Sène',
        prenom:       'Oumar',
        telephone:    '+221770000099',
        specialite:   'Physique',
        type_contrat: 'vacataire',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
  });

  it('devrait refuser un doublon de téléphone', async () => {
    await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:       'Dupont',
        prenom:    'Jean',
        telephone: '+221770000099', // déjà utilisé ci-dessus
      })
      .expect(422);
  });

  it('devrait refuser sans authentification', async () => {
    await request.post('/api/v1/enseignants').send({}).expect(401);
  });
});
