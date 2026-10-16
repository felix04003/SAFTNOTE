'use strict';

// Base PostgreSQL réelle : tout établissement obtient sa politique de sécurité
// (migration 021), quel que soit le chemin de création.

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp } = require('./helpers');

let db, request;

beforeAll(async () => {
  db = getTestDB();
  request = supertest(createIntegrationApp());
  await truncateData();
  await seedTestData(); // rôles et référentiels nécessaires à /inscription
});

afterAll(async () => { await closeTestDB(); });

const politiqueDe = (etablissementId) =>
  db('politique_securite').where({ etablissement_id: etablissementId }).select('*');

describe('politique_securite par défaut (migration 021)', () => {
  test('un établissement inséré directement reçoit une politique aux valeurs par défaut', async () => {
    const [etab] = await db('etablissements').insert({
      nom: 'Lycée Trigger', code_officiel: 'TRIG_01', type: 'lycee', pays: 'SN', ville: 'Dakar', actif: true,
    }).returning('id');

    const lignes = await politiqueDe(etab.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ mdp_longueur_min: 8, session_max_simultanees: 3 });
  });

  test('POST /inscription : l\'établissement créé a sa politique', async () => {
    const res = await request.post('/api/v1/inscription').send({
      etablissement: { nom: 'Ecole Inscrite', ville: 'Thiès' },
      directeur: {
        nom: 'Diop', prenom: 'Awa', email: 'awa.politique@test.sn',
        telephone: '+221700001234', mot_de_passe: 'Abcdef12',
      },
    }).expect(201);

    const lignes = await politiqueDe(res.body.data.etablissement.id);
    expect(lignes).toHaveLength(1);
  });

  test('une politique déjà créée (seed) n\'est pas écrasée ni dupliquée', async () => {
    const [etab] = await db('etablissements').insert({
      nom: 'Lycée Seed', code_officiel: 'TRIG_02', type: 'lycee', pays: 'SN', ville: 'Dakar', actif: true,
    }).returning('id');
    await db('politique_securite').where({ etablissement_id: etab.id }).update({ mdp_longueur_min: 12 });

    await db.raw(
      'INSERT INTO politique_securite (etablissement_id) VALUES (?) ON CONFLICT (etablissement_id) DO NOTHING',
      [etab.id]
    );

    const lignes = await politiqueDe(etab.id);
    expect(lignes).toHaveLength(1);
    expect(lignes[0].mdp_longueur_min).toBe(12);
  });

  test('le rattrapage de la migration crée la politique d\'un établissement qui n\'en a pas', async () => {
    const [etab] = await db('etablissements').insert({
      nom: 'Lycée Ancien', code_officiel: 'TRIG_03', type: 'lycee', pays: 'SN', ville: 'Dakar', actif: true,
    }).returning('id');
    await db('politique_securite').where({ etablissement_id: etab.id }).del(); // état d'avant la migration

    await db.raw(`
      INSERT INTO politique_securite (etablissement_id)
      SELECT e.id FROM etablissements e
       WHERE NOT EXISTS (SELECT 1 FROM politique_securite p WHERE p.etablissement_id = e.id)
      ON CONFLICT (etablissement_id) DO NOTHING`);

    expect(await politiqueDe(etab.id)).toHaveLength(1);
  });
});
