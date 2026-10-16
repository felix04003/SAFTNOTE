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

  // Plages créées avec l'établissement (migration 026)
  const plage = await db('plages_horaires').where({ etablissement_id: seed.etablissement.id }).orderBy('numero').first('id');

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
    expect(edtId).toBeDefined();

    const res = await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-18',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('appel_id');
    expect(res.body.data.nb_eleves).toBe(3);
  });

  it('un second appel pour le même créneau et la même date est idempotent (renvoie l\'appel existant)', async () => {
    expect(edtId).toBeDefined();

    const premier = await request.post('/api/v1/appels').set('Authorization', `Bearer ${tokenEns}`)
      .send({ emploi_du_temps_id: edtId, date_cours: '2024-11-18' }).expect(200);
    const db = getTestDB();
    expect(await db('appels').where({ emploi_du_temps_id: edtId, date_cours: '2024-11-18' })).toHaveLength(1);
    expect(premier.body.data.id).toBeDefined();
  });
});

describe('POST /api/v1/appels — réponse après validation de la transaction', () => {
  it('quand le COMMIT tarde, la réponse n\'est envoyée qu\'après lui : les présences sont déjà visibles', async () => {
    const db = getTestDB();
    // Un déclencheur de contrainte DIFFÉRÉ s'exécute au COMMIT : il le retarde de 400 ms alors que le code de la route a fini.
    // Répondre DANS la transaction laissait le client recevoir 201 puis lire un appel sans présences (course vue en CI)
    await db.raw('CREATE OR REPLACE FUNCTION test_commit_lent() RETURNS trigger AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NULL; END $$ LANGUAGE plpgsql');
    await db.raw('CREATE CONSTRAINT TRIGGER test_commit_lent AFTER INSERT ON presences DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_commit_lent()');
    try {
      const res = await request.post('/api/v1/appels').set('Authorization', `Bearer ${tokenEns}`)
        .send({ emploi_du_temps_id: edtId, date_cours: '2024-11-25' }).expect(201);
      const presences = await db('presences').where({ appel_id: res.body.data.appel_id });
      expect(presences.length).toBeGreaterThan(0);
      expect(presences).toHaveLength(res.body.data.nb_eleves);
    } finally {
      await db.raw('DROP TRIGGER IF EXISTS test_commit_lent ON presences');
      await db.raw('DROP FUNCTION IF EXISTS test_commit_lent()');
    }
  });
});

// ── Présences pré-remplies à l'ouverture de l'appel ─────────────

describe('présences d\'un appel ouvert', () => {
  it('une ligne « non_saisi » par élève inscrit dans la classe', async () => {
    const db = getTestDB();
    const appel = await db('appels').where({ emploi_du_temps_id: edtId }).first('id');
    expect(appel).toBeDefined();
    const presences = await db('presences').where({ appel_id: appel.id });
    expect(presences).toHaveLength(3);
    expect(presences.every((p) => p.statut === 'non_saisi')).toBe(true);
  });
});

// ── GET /appels/cours ───────────────────────────────────────────

describe('GET /api/v1/appels/cours', () => {
  it('devrait retourner null + élèves si aucun appel existant', async () => {
    expect(edtId).toBeDefined();

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
    expect(edtId).toBeDefined();

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
