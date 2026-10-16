'use strict';

// Base PostgreSQL réelle : exports CSV de la direction

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns, tokenParent, periode, periodeB, classeB, utilB;
const get = (chemin, token = tokenDir) => request.get(`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`).buffer(true).parse((res, cb) => {
  let d = ''; res.setEncoding('utf8'); res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, d));
});
const lignes = (res) => res.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).map((l) => l.split(';'));

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  periode = seed.periodes[0];
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  const [e0, e1, e2] = seed.eleves;
  // Nom piégé (formule) et contact principal
  await db('utilisateurs').where({ id: e1.user.id }).update({ nom: '=CMD()', genre: 'F', date_naissance: '2013-03-14' });
  const [parent] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom: 'Ndiaye', prenom: 'Papa', telephone: '+221770000701', actif: true }).returning('*');
  const roleParent = await db('roles').where({ code: 'parent' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: parent.id, role_id: roleParent.id, etablissement_id: seed.etablissement.id, actif: true });
  await db('parents_eleves').insert({ parent_id: parent.id, eleve_id: e0.eleve.id, lien: 'pere', est_contact_principal: true });
  tokenParent = await creerSession(parent.id, seed.etablissement.id);

  // Moyennes de la période
  await db('moyennes_generales').insert([
    { inscription_id: e0.inscription.id, periode_id: periode.id, moyenne_generale: 14.25, rang: 1, rang_sur: 3, mention: 'Bien', nb_absences_injustifiees: 2 },
    { inscription_id: e1.inscription.id, periode_id: periode.id, moyenne_generale: 9, rang: 2, rang_sur: 3 },
  ]);

  // Une séance avec deux perturbations (et une présence, qui ne doit pas sortir)
  const [mat] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Physique', code: 'PHY', actif: true }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({ enseignant_id: seed.enseignant.id, matiere_id: mat.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id }).returning('*');
  const plage = await db('plages_horaires').where({ etablissement_id: seed.etablissement.id }).orderBy('numero').first('id');
  const [edt] = await db('emplois_du_temps').insert({ classe_id: seed.classe.id, affectation_id: aff.id, plage_id: plage.id, jour_semaine: 2, salle: 'T1' }).returning('*');
  const [appel] = await db('appels').insert({ emploi_du_temps_id: edt.id, date_cours: '2024-11-05', effectue_par: seed.enseignantUser.id }).returning('*');
  await db('presences').insert([
    { appel_id: appel.id, inscription_id: e0.inscription.id, statut: 'absent', est_justifie: true, motif_justification: 'maladie' },
    { appel_id: appel.id, inscription_id: e1.inscription.id, statut: 'retard', minutes_retard: 10 },
    { appel_id: appel.id, inscription_id: e2.inscription.id, statut: 'present' },
  ]);
  const [appel2] = await db('appels').insert({ emploi_du_temps_id: edt.id, date_cours: '2024-12-03', effectue_par: seed.enseignantUser.id }).returning('*');
  await db('presences').insert({ appel_id: appel2.id, inscription_id: e0.inscription.id, statut: 'absent' });

  // Sanction
  await db('sanctions').insert({ inscription_id: e1.inscription.id, type: 'retenue', motif: 'Bavardages; répétés', date_prononcee: '2024-11-20', prononcee_par: seed.directeur.id, nb_jours: 2 });

  // Autre école : ses données ne doivent jamais sortir
  const [etabB] = await db('etablissements').insert({ nom: 'Lycée B', code_officiel: 'EXP_B', type: 'lycee', pays: 'Sénégal', region: 'Thiès', ville: 'Thiès', actif: true }).returning('*');
  const [anneeB] = await db('annees_scolaires').insert({ etablissement_id: etabB.id, libelle: '2024-2025', date_debut: '2024-10-01', date_fin: '2025-07-15', nb_periodes: 3, type_periode: 'trimestre', est_courante: true }).returning('*');
  [periodeB] = await db('periodes').insert({ annee_scolaire_id: anneeB.id, numero: 1, libelle: 'Trimestre 1', date_debut: '2024-10-01', date_fin: '2024-12-20' }).returning('*');
  const [nivB] = await db('niveaux').insert({ etablissement_id: etabB.id, nom: '6ème', nom_court: '6e', cycle: 'college', ordre: 1 }).returning('*');
  [classeB] = await db('classes').insert({ annee_scolaire_id: anneeB.id, niveau_id: nivB.id, nom: 'Z' }).returning('*');
  [utilB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Etranger', prenom: 'Zoe', actif: true }).returning('*');
  const [elB] = await db('eleves').insert({ utilisateur_id: utilB.id, matricule: 'EXPB-1' }).returning('*');
  await db('inscriptions').insert({ eleve_id: elB.id, classe_id: classeB.id, annee_scolaire_id: anneeB.id, statut: 'actif' });
});
afterAll(async () => { await closeTestDB(); });

describe('droits', () => {
  test.each(['eleves', 'moyennes', 'absences', 'sanctions'])('%s.csv : sans authentification 401, un enseignant (pas de rapports.exporter) 403', async (nom) => {
    await get(`/exports/${nom}.csv?periode_id=${periode.id}`, 'faux').expect(401);
    await get(`/exports/${nom}.csv?periode_id=${periode.id}`, tokenEns).expect(403);
  });
  test('un parent est refusé', async () => {
    await get('/exports/eleves.csv', tokenParent).expect(403);
  });
});

describe('GET /exports/eleves.csv', () => {
  test('en-têtes HTTP, BOM, une ligne par élève inscrit, contact principal, cellule piégée neutralisée, aucune autre école', async () => {
    const res = await get('/exports/eleves.csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="eleves-2024-2025.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.startsWith('\uFEFF')).toBe(true);
    const l = lignes(res);
    expect(l[0]).toEqual(['Matricule', 'Nom', 'Prénom', 'Genre', 'Date de naissance', 'Classe', 'Statut', 'Redoublant', 'Contact principal', 'Téléphone du contact']);
    expect(l).toHaveLength(1 + seed.eleves.length);
    const piege = l.find((x) => x[1].includes('CMD'));
    expect(piege[1]).toBe("'=CMD()");
    expect(piege.slice(3, 5)).toEqual(['F', '2013-03-14']);
    const avecContact = l.find((x) => x[8] === 'Papa Ndiaye');
    expect(avecContact[9]).toBe('+221770000701');
    expect(res.body).not.toContain('Etranger');
  });

  test('filtres : statut et classe ; valeurs invalides refusées', async () => {
    await db('inscriptions').where({ id: seed.eleves[2].inscription.id }).update({ statut: 'transfere' });
    expect(lignes(await get('/exports/eleves.csv').expect(200))).toHaveLength(1 + seed.eleves.length - 1);
    const retires = lignes(await get('/exports/eleves.csv?statut=retires').expect(200));
    expect(retires).toHaveLength(2);
    expect(retires[1][6]).toBe('Transféré');
    expect(lignes(await get('/exports/eleves.csv?statut=tous').expect(200))).toHaveLength(1 + seed.eleves.length);
    await db('inscriptions').where({ id: seed.eleves[2].inscription.id }).update({ statut: 'actif' });
    await get('/exports/eleves.csv?statut=nimportequoi').expect(422);
    await get('/exports/eleves.csv?classe_id=pas-un-uuid').expect(422);
    expect(lignes(await get(`/exports/eleves.csv?classe_id=${classeB.id}`).expect(200))).toHaveLength(1);   // classe d'une autre école : rien
  });
});

describe('GET /exports/moyennes.csv', () => {
  test('période obligatoire et de l\'école ; moyennes triées par rang, virgule décimale', async () => {
    await get('/exports/moyennes.csv').expect(422);
    await get('/exports/moyennes.csv?periode_id=11111111-1111-4111-8111-111111111111').expect(404);
    await get(`/exports/moyennes.csv?periode_id=${periodeB.id}`).expect(404);                 // période d'une autre école
    const res = await get(`/exports/moyennes.csv?periode_id=${periode.id}`).expect(200);
    expect(res.headers['content-disposition']).toContain('moyennes-Trimestre-1-2024-2025.csv');
    const l = lignes(res);
    expect(l).toHaveLength(3);
    expect(l[1][1]).toBe('1');
    expect(l[1][6]).toBe('14,25');
    expect(l[1].slice(7, 12)).toEqual(['Bien', '', '0', '2', '0']);
    expect(l[2][6]).toBe('9');
  });
});

describe('GET /exports/absences.csv', () => {
  test('absences et retards seulement, avec matière, justification et période', async () => {
    const l = lignes(await get('/exports/absences.csv').expect(200));
    expect(l).toHaveLength(4);                                                      // 3 perturbations, la présence est exclue
    expect(l[0][0]).toBe('Date');
    expect(l.map((x) => x[0]).slice(1)).toEqual(['2024-11-05', '2024-11-05', '2024-12-03']);
    const maladie = l.find((x) => x[9] === 'maladie');
    expect(maladie.slice(5, 7)).toEqual(['Physique', 'Absent']);
    expect(maladie[8]).toBe('Oui');
    expect(l.find((x) => x[6] === 'Retard')[7]).toBe('10');
    const fenetre = lignes(await get('/exports/absences.csv?du=2024-12-01&au=2024-12-31').expect(200));
    expect(fenetre).toHaveLength(2);
    await get('/exports/absences.csv?du=2024-12-31&au=2024-12-01').expect(422);
    await get('/exports/absences.csv?du=hier').expect(422);
  });
});

describe('GET /exports/sanctions.csv', () => {
  test('sanction avec libellé du type ; le point-virgule du motif ne casse pas la colonne', async () => {
    const res = await get('/exports/sanctions.csv').expect(200);
    const l = res.body.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean);
    expect(l).toHaveLength(2);
    expect(l[1]).toContain('Retenue;"Bavardages; répétés";2;');
    await get('/exports/sanctions.csv?type=inconnu').expect(422);
    expect(lignes(await get('/exports/sanctions.csv?type=exclusion_definitive').expect(200))).toHaveLength(1);
  });
});

describe('journal d\'audit', () => {
  test('chaque export est inscrit avec son nombre de lignes, sans contenu', async () => {
    const actions = await db('journal_audit').where({ utilisateur_id: seed.directeur.id }).whereIn('action', ['export.eleves', 'export.moyennes', 'export.absences', 'export.sanctions']).select('action', 'details');
    expect(new Set(actions.map((a) => a.action))).toEqual(new Set(['export.eleves', 'export.moyennes', 'export.absences', 'export.sanctions']));
    const texte = JSON.stringify(actions);
    expect(texte).toContain('"lignes"');
    expect(texte).not.toMatch(/Ndiaye|CMD|Bavardages|\+22177/);
  });
});
