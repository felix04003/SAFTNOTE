'use strict';

// Base PostgreSQL réelle : GET /eleves/:id (fiche élève) — classe, parents, données médicales réservées

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns, eleve;
const fiche = (token, id = eleve.utilisateur.id) => request.get(`/api/v1/eleves/${id}`).set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  eleve = seed.eleves[0];
  eleve.utilisateur = await db('utilisateurs').where({ id: (await db('eleves').where({ id: eleve.eleve.id }).first()).utilisateur_id }).first();
  await db('eleves').where({ id: eleve.eleve.id }).update({ allergies: 'Arachides', groupe_sanguin: 'O+' });

  // Deux parents : le contact principal doit passer en premier
  const roleParent = await db('roles').where({ code: 'parent' }).first();
  for (const [i, p] of [{ prenom: 'Papa', nom: 'Traoré', lien: 'pere', principal: false }, { prenom: 'Mariama', nom: 'Traoré', lien: 'mere', principal: true }].entries()) {
    const [u] = await db('utilisateurs').insert({
      etablissement_id: seed.etablissement.id, nom: p.nom, prenom: p.prenom, telephone: `+22177000030${i}`, actif: true,
    }).returning('*');
    await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: roleParent.id, etablissement_id: seed.etablissement.id, actif: true });
    await db('parents_eleves').insert({ parent_id: u.id, eleve_id: eleve.eleve.id, lien: p.lien, est_contact_principal: p.principal });
  }
});
afterAll(async () => { await closeTestDB(); });

describe('GET /eleves/:id', () => {
  test('la direction voit identité, classe de l\'année, parents (principal d\'abord) et données médicales', async () => {
    const res = await fiche(tokenDir).expect(200);
    expect(res.body.data).toMatchObject({
      nom: eleve.utilisateur.nom, matricule: eleve.eleve.matricule, classe: expect.stringContaining(seed.classe.nom),
      allergies: 'Arachides', groupe_sanguin: 'O+', medical_masque: false,
    });
    expect(res.body.data.parents.map((p) => `${p.prenom}:${p.lien}`)).toEqual(['Mariama:mere', 'Papa:pere']);
    expect(res.body.data.parents[0]).toMatchObject({ telephone: '+221770000301', est_contact_principal: true });
    expect(res.body.data).not.toHaveProperty('eleve_pk');
  });

  test('un enseignant voit la fiche mais PAS les données médicales', async () => {
    const res = await fiche(tokenEns).expect(200);
    expect(res.body.data).toMatchObject({ nom: eleve.utilisateur.nom, medical_masque: true });
    for (const champ of ['allergies', 'groupe_sanguin', 'conditions_medicales', 'medecin_urgence']) expect(res.body.data).not.toHaveProperty(champ);
    expect(JSON.stringify(res.body)).not.toContain('Arachides');
  });

  test('élève d\'une autre école : introuvable', async () => {
    const [etabB] = await db('etablissements').insert({ nom: 'B', code_officiel: 'FICHE_B', type: 'college', pays: 'Sénégal', actif: true }).returning('*');
    const [uB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Autre', prenom: 'Eleve', actif: true }).returning('*');
    await db('eleves').insert({ utilisateur_id: uB.id, matricule: 'E26999999', date_inscription: db.raw('NOW()') });
    await fiche(tokenDir, uB.id).expect(404);
  });
});
