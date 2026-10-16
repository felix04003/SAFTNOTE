'use strict';

// Base PostgreSQL réelle : le worker de calcul des moyennes (src/workers/calcul-moyennes.worker.js).
// Ses tests unitaires moquent la base : une requête sur une table inexistante (« affectations ») y passait.

const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp } = require('./helpers');

let db, seed, evaluationId, traiterCalcul;
const job = { data: {}, updateProgress: jest.fn().mockResolvedValue(undefined), id: 'test' };

beforeAll(async () => {
  createIntegrationApp();                                   // branche pool.getDB sur la base de test
  ({ traiterCalcul } = require('../../src/workers/calcul-moyennes.worker'));
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();

  const [matiere] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Maths', code: 'MATH' }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).returning('*');
  const [ev] = await db('evaluations').insert({
    affectation_id: aff.id, periode_id: seed.periodes[0].id, type: 'devoir', numero: 1, note_max: 20, notes_publiees: true,
  }).returning('*');
  evaluationId = ev.id;

  for (const [i, e] of seed.eleves.entries()) {
    await db('notes').insert({
      evaluation_id: ev.id, eleve_id: e.eleve.id, inscription_id: e.inscription.id, valeur: 10 + i, saisie_par: seed.enseignantUser.id,
    });
  }
});
afterAll(async () => { await closeTestDB(); });

describe('worker calcul-moyennes sur base réelle', () => {
  test('calcule la moyenne générale de chaque inscrit de la classe', async () => {
    const resultat = await traiterCalcul({
      ...job,
      data: { classe_id: seed.classe.id, periode_id: seed.periodes[0].id, etablissement_id: seed.etablissement.id },
    });
    expect(resultat).toMatchObject({ nb_inscriptions: seed.eleves.length, nb_matieres: 1 });

    const lignes = await db('moyennes_generales').where({ periode_id: seed.periodes[0].id });
    expect(lignes).toHaveLength(seed.eleves.length);
    expect(lignes.map((l) => Number(l.moyenne_generale)).sort((a, b) => a - b)).toEqual(
      seed.eleves.map((_, i) => 10 + i));
  });

  test('la période se déduit de l\'évaluation quand elle n\'est pas fournie', async () => {
    const resultat = await traiterCalcul({
      ...job,
      data: { classe_id: seed.classe.id, evaluation_id: evaluationId, etablissement_id: seed.etablissement.id },
    });
    expect(resultat.nb_inscriptions).toBe(seed.eleves.length);
  });

  test('le job d\'une autre école ne touche pas à cette classe', async () => {
    await db('moyennes_generales').del();
    const resultat = await traiterCalcul({
      ...job,
      data: { classe_id: seed.classe.id, periode_id: seed.periodes[0].id, etablissement_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(resultat).toMatchObject({ skipped: true, reason: 'classe_introuvable' });
    expect(await db('moyennes_generales')).toHaveLength(0);
  });
});
