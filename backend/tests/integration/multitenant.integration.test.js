'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request;
let seedA, tokenA, tokenB;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();

  // Établissement A
  seedA = await seedTestData();
  tokenA = await creerSession(seedA.directeur.id, seedA.etablissement.id);

  // Établissement B — injecter manuellement un 2e établissement
  const db = getTestDB();
  const bcrypt = require('bcryptjs');

  const [etabB] = await db('etablissements').insert({
    nom: 'Collège Test Privé B',
    code_officiel: 'TEST_CPB',
    type: 'college',
    pays: 'Sénégal',
    region: 'Thiès',
    ville: 'Thiès',
    actif: true,
  }).returning('*');

  const [anneeB] = await db('annees_scolaires').insert({
    etablissement_id: etabB.id,
    libelle: '2024-2025',
    date_debut: '2024-10-01',
    date_fin: '2025-07-15',
    nb_periodes: 3,
    type_periode: 'trimestre',
    est_courante: true,
  }).returning('*');

  const [niveauB] = await db('niveaux').insert({
    etablissement_id: etabB.id,
    nom: '3ème',
    nom_court: '3e',
    cycle: 'college',
    ordre: 9,
  }).returning('*');

  await db('classes').insert({
    niveau_id: niveauB.id,
    nom: '3e A',
    annee_scolaire_id: anneeB.id,
    effectif_max: 40,
  });

  const mdpHash = await bcrypt.hash('Test1234!', 10);
  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id,
    nom: 'Camara', prenom: 'Ibrahima',
    email: 'directeur@testb.sn',
    telephone: '+221770000090',
    mot_de_passe_hash: mdpHash,
    actif: true,
  }).returning('*');

  const roleDir = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({
    utilisateur_id: dirB.id,
    role_id: roleDir.id,
    etablissement_id: etabB.id,
    actif: true,
  });

  await db('politique_securite')
    .insert({ etablissement_id: etabB.id })
    .onConflict('etablissement_id').ignore();

  tokenB = await creerSession(dirB.id, etabB.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── Isolation multi-tenant ──────────────────────────────────────
// Ces tests vérifient que l'établissement A ne peut JAMAIS voir
// les données de l'établissement B et vice versa.

describe('Isolation multi-tenant — élèves', () => {
  it('GET /eleves — établissement A ne voit que ses élèves', async () => {
    const res = await request
      .get('/api/v1/eleves')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /eleves — établissement B retourne liste vide (aucun élève créé)', async () => {
    const res = await request
      .get('/api/v1/eleves')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('GET /eleves/:id — établissement B ne peut pas accéder à un élève de A', async () => {
    const eleveAId = seedA.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/eleves/${eleveAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404); // Doit être introuvable pour l'établissement B

    expect(res.body.succes).toBe(false);
  });
});

describe('Isolation multi-tenant — classes', () => {
  it('GET /classes — établissement A ne voit que sa classe', async () => {
    const res = await request
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const nomsClasses = res.body.data.map(c => c.nom_classe || c.nom);
    expect(nomsClasses).not.toContain('3e A');
  });

  it('GET /classes — établissement B ne voit que sa classe', async () => {
    const res = await request
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const nomsClasses = res.body.data.map(c => c.nom_classe || c.nom);
    expect(nomsClasses).not.toContain('Term S1');
  });
});

describe('Isolation multi-tenant — évaluations', () => {
  it('GET /evaluations — établissement B ne voit pas les évals de A', async () => {
    const res = await request
      .get('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});

describe('Isolation multi-tenant — sanctions', () => {
  it('GET /discipline/sanctions — établissement B ne voit pas les sanctions de A', async () => {
    const res = await request
      .get('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});

describe('Isolation multi-tenant — absences', () => {
  it('GET /presences/absences — établissement B ne voit pas les absences de A', async () => {
    const res = await request
      .get('/api/v1/presences/absences')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});
