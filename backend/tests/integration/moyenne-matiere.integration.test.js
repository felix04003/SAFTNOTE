'use strict';

// Base PostgreSQL réelle : calculer_moyenne_matiere() (migrations 003 et 027)

const { getTestDB, closeTestDB, truncateData, seedTestData } = require('./helpers');

let db, seed, matiereId, eleve;

async function note(type, numero, valeur) {
  const [aff] = await db('affectations_enseignants').where({ classe_id: seed.classe.id, matiere_id: matiereId });
  const [ev] = await db('evaluations').insert({
    affectation_id: aff.id, periode_id: seed.periodes[0].id, type, numero, note_max: 20, notes_publiees: true,
  }).returning('*');
  await db('notes').insert({
    evaluation_id: ev.id, eleve_id: eleve.eleve.id, inscription_id: eleve.inscription.id, valeur, saisie_par: seed.enseignantUser.id,
  });
}
const moyenne = async () => (await db.raw('SELECT * FROM calculer_moyenne_matiere(?, ?, ?)',
  [eleve.inscription.id, matiereId, seed.periodes[0].id])).rows[0];

beforeAll(async () => {
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  eleve = seed.eleves[0];
  const [m] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Maths', code: 'MATH' }).returning('*');
  matiereId = m.id;
  await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: m.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  });
});
afterAll(async () => { await closeTestDB(); });

describe('calculer_moyenne_matiere — école sans configuration matière × niveau', () => {
  test('une composition seule compte, avec le coefficient de l\'établissement (défaut 2)', async () => {
    await note('composition', 1, 16);
    const r = await moyenne();
    expect(Number(r.moyenne)).toBe(16);                     // 16 × 2 / 2 : avant le correctif, NULL
    expect(Number(r.denominateur)).toBe(2);
  });

  test('devoir + composition : (15 + 16 × 2) / 3', async () => {
    await note('devoir', 1, 15);
    const r = await moyenne();
    expect(Number(r.moyenne)).toBeCloseTo(15.67, 2);
    expect(Number(r.denominateur)).toBe(3);
  });

  test('le coefficient de composition de l\'établissement est respecté', async () => {
    const maj = await db('configs_systeme_notes').where({ etablissement_id: seed.etablissement.id }).update({ coef_composition: 3 });
    if (!maj) await db('configs_systeme_notes').insert({ etablissement_id: seed.etablissement.id, coef_composition: 3 });
    const r = await moyenne();
    expect(Number(r.moyenne)).toBeCloseTo((15 + 16 * 3) / 4, 2);
  });
});
