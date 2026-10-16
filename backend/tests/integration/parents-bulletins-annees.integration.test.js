'use strict';

// Base PostgreSQL réelle : un parent retrouve les bulletins des années clôturées de son enfant (après la fin d'année)

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenP1, tokenP2, tokenP3;
let ancienneAnnee, nouvelleAnnee, autreAnnee;
const avec = (chemin, token) => request.get(`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);
const bulletins = (enfant, token, requete = '') => avec(`/parents/moi/enfants/${enfant.user.id}/bulletins${requete}`, token);

async function creerParent(tel, eleve, droits = {}) {
  const [u] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom: 'Parent', prenom: tel.slice(-2), telephone: tel, actif: true }).returning('*');
  const role = await db('roles').where({ code: 'parent' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: role.id, etablissement_id: seed.etablissement.id, actif: true });
  await db('parents_eleves').insert({ parent_id: u.id, eleve_id: eleve.eleve.id, lien: 'pere', est_contact_principal: true, peut_voir_bulletins: true, ...droits });
  return creerSession(u.id, seed.etablissement.id);
}

async function bulletinValide(ins, periode, moyenne, matiere) {
  await db('moyennes_generales').insert({
    inscription_id: ins.id, periode_id: periode.id, moyenne_generale: moyenne, rang: 1, rang_sur: 3, mention: 'Bien',
    bulletin_genere: true, bulletin_genere_at: db.fn.now(), valide_at: db.fn.now(),
  });
  await db('moyennes_matieres').insert({ inscription_id: ins.id, matiere_id: matiere.id, periode_id: periode.id, moyenne, coefficient: 2, est_complete: true });
}

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  ancienneAnnee = seed.annee;
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);

  const [maths] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Mathématiques', code: 'MAT', actif: true }).returning('*');
  const [e0, e1] = seed.eleves;
  await bulletinValide(e0.inscription, seed.periodes[0], 14, maths);
  await bulletinValide(e1.inscription, seed.periodes[0], 15, maths);
  tokenP1 = await creerParent('+221770000601', e0);                                   // enfant qui redouble : inscrit dans la nouvelle année
  tokenP2 = await creerParent('+221770000602', e1);                                   // enfant diplômé : plus aucune inscription courante
  tokenP3 = await creerParent('+221770000603', seed.eleves[2], { peut_voir_bulletins: false });

  // Fin d'année par l'API réelle : e0 redouble, e1 est diplômé
  const apercu = (await avec('/annees-scolaires/passage/apercu', tokenDir).expect(200)).body.data;
  const surcharges = { [e0.inscription.id]: 'redouble', [e1.inscription.id]: 'diplome' };
  const decisions = apercu.classes.flatMap((c) => c.eleves).map((e) => ({ inscription_id: e.inscription_id, decision: surcharges[e.inscription_id] || e.proposition }));
  const res = await request.post('/api/v1/annees-scolaires/passage').set('Authorization', `Bearer ${tokenDir}`)
    .send({ libelle: '2025-2026', date_debut: '2025-10-01', date_fin: '2026-07-15', decisions }).expect(201);
  nouvelleAnnee = { id: res.body.data.annee_id, libelle: res.body.data.libelle };

  // Une autre école, avec son année
  const [etabB] = await db('etablissements').insert({ nom: 'Lycée B', code_officiel: 'PBA_B', type: 'lycee', pays: 'Sénégal', region: 'Thiès', ville: 'Thiès', actif: true }).returning('*');
  [autreAnnee] = await db('annees_scolaires').insert({ etablissement_id: etabB.id, libelle: '2024-2025', date_debut: '2024-10-01', date_fin: '2025-07-15', nb_periodes: 3, type_periode: 'trimestre', est_courante: true }).returning('*');
});
afterAll(async () => { await closeTestDB(); });

describe('GET /parents/moi/enfants/:id/bulletins — années clôturées', () => {
  test('sans paramètre : l\'année courante, avec la liste des années de l\'enfant (la plus récente d\'abord)', async () => {
    const d = (await bulletins(seed.eleves[0], tokenP1).expect(200)).body.data;
    expect(d.annee).toBe(nouvelleAnnee.libelle);
    expect(d.annee_id).toBe(nouvelleAnnee.id);
    expect(d.bulletins).toEqual([]);                                                  // rien de validé dans la nouvelle année
    expect(d.annees.map((a) => [a.libelle, a.est_courante])).toEqual([[nouvelleAnnee.libelle, true], [ancienneAnnee.libelle, false]]);
  });

  test('annee_id d\'une année clôturée : ses bulletins validés, avec le détail des matières', async () => {
    const d = (await bulletins(seed.eleves[0], tokenP1, `?annee_id=${ancienneAnnee.id}`).expect(200)).body.data;
    expect(d.annee).toBe(ancienneAnnee.libelle);
    expect(d.bulletins).toHaveLength(1);
    expect(d.bulletins[0]).toMatchObject({ trimestre: 1, mention: 'Bien' });
    expect(Number(d.bulletins[0].moyenne_generale)).toBe(14);
    expect(d.bulletins[0].matieres.map((m) => m.matiere)).toEqual(['Mathématiques']);   // l'ancien filtre « année courante » les vidait
  });

  test('élève diplômé (plus d\'inscription courante) : le parent retrouve quand même les bulletins de la dernière année', async () => {
    const d = (await bulletins(seed.eleves[1], tokenP2).expect(200)).body.data;
    expect(d.annee).toBe(ancienneAnnee.libelle);
    expect(d.bulletins).toHaveLength(1);
    expect(Number(d.bulletins[0].moyenne_generale)).toBe(15);
    expect(d.annees.map((a) => a.libelle)).toEqual([ancienneAnnee.libelle]);
  });

  test('année inconnue, d\'une autre école ou sans inscription de l\'enfant : 404 ; identifiant mal formé : 422', async () => {
    await bulletins(seed.eleves[0], tokenP1, '?annee_id=11111111-1111-4111-8111-111111111111').expect(404);
    await bulletins(seed.eleves[0], tokenP1, `?annee_id=${autreAnnee.id}`).expect(404);
    await bulletins(seed.eleves[1], tokenP2, `?annee_id=${nouvelleAnnee.id}`).expect(404);       // diplômé : pas inscrit dans la nouvelle
    await bulletins(seed.eleves[0], tokenP1, '?annee_id=pas-un-uuid').expect(422);
  });

  test('les droits ne s\'élargissent pas : l\'enfant d\'un autre, ou sans droit « bulletins », reste refusé', async () => {
    await bulletins(seed.eleves[1], tokenP1, `?annee_id=${ancienneAnnee.id}`).expect(403);
    await bulletins(seed.eleves[2], tokenP3, `?annee_id=${ancienneAnnee.id}`).expect(403);
  });
});
