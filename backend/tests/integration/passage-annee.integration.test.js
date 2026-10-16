'use strict';

// Base PostgreSQL réelle : fin d'année et réinscription (clôture, nouvelle année, classes reconduites, nouvelles inscriptions)

const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns, tokenB, cheminB;
let nv2nde, nv1ere, classe2nde, classe1ere, e2a, e2b, e1;     // élèves ajoutés : 2nde A (x2), 1ère A (x1)
let affectTerminale;
const avec = (methode, chemin, token) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);
const apercu = async (token = tokenDir) => (await avec('get', '/annees-scolaires/passage/apercu', token).expect(200)).body.data;
const trouver = (donnees, inscriptionId) => donnees.classes.flatMap((c) => c.eleves).find((e) => e.inscription_id === inscriptionId);

let compteur = 0;
async function ajouterEleve(classeId, nom, moyennes = []) {
  compteur++;
  const [u] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom, prenom: 'Test', actif: true }).returning('*');
  const [el] = await db('eleves').insert({ utilisateur_id: u.id, matricule: `PASS-${compteur}` }).returning('*');
  const [ins] = await db('inscriptions').insert({ eleve_id: el.id, classe_id: classeId, annee_scolaire_id: seed.annee.id, statut: 'actif' }).returning('*');
  moyennes.forEach(async () => {});
  return { u, el, ins };
}
async function moyenne(ins, periodeIndex, valeur, decision = null) {
  await db('moyennes_generales').insert({ inscription_id: ins.id, periode_id: seed.periodes[periodeIndex].id, moyenne_generale: valeur, decision_passage: decision });
}

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Niveaux : 2nde (10) < 1ère (11) < Terminale (12, celui du seed = dernier niveau)
  [nv2nde] = await db('niveaux').insert({ etablissement_id: seed.etablissement.id, nom: '2nde', nom_court: '2nde', cycle: 'lycee', ordre: 10 }).returning('*');
  [nv1ere] = await db('niveaux').insert({ etablissement_id: seed.etablissement.id, nom: '1ère', nom_court: '1ère', cycle: 'lycee', ordre: 11 }).returning('*');
  [classe2nde] = await db('classes').insert({ annee_scolaire_id: seed.annee.id, niveau_id: nv2nde.id, nom: 'A', salle_principale: 'Salle 2A', effectif_max: 45 }).returning('*');
  [classe1ere] = await db('classes').insert({ annee_scolaire_id: seed.annee.id, niveau_id: nv1ere.id, nom: 'A', salle_principale: 'Salle 1A', effectif_max: 40 }).returning('*');

  e2a = await ajouterEleve(classe2nde.id, 'Admis');
  e2b = await ajouterEleve(classe2nde.id, 'Faible');
  e1  = await ajouterEleve(classe1ere.id, 'Conseil');
  await moyenne(e2a.ins, 0, 14); await moyenne(e2a.ins, 1, 12);                       // 13 : admis
  await moyenne(e2b.ins, 0, 6);  await moyenne(e2b.ins, 1, 7);                        // 6,5 : redouble
  await moyenne(e1.ins, 0, 5);   await moyenne(e1.ins, 1, 5, 'admis');                // 5 mais le conseil dit « admis »
  await moyenne(seed.eleves[0].inscription, 0, 13);                                   // Terminale : 13 -> diplôme
  await moyenne(seed.eleves[1].inscription, 0, 8);                                    // Terminale : 8 -> redouble

  // Matières et affectations : une active (copiée), une archivée (non copiée)
  const [mat] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Philosophie', code: 'PHI', actif: true }).returning('*');
  const [matArchivee] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Latin', code: 'LAT', actif: false }).returning('*');
  [affectTerminale] = await db('affectations_enseignants').insert([
    { enseignant_id: seed.enseignant.id, matiere_id: mat.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id },
    { enseignant_id: seed.enseignant.id, matiere_id: matArchivee.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id },
    { enseignant_id: seed.enseignant.id, matiere_id: mat.id, classe_id: classe2nde.id, annee_scolaire_id: seed.annee.id },
  ]).returning('*');

  // Autre établissement
  const [etabB] = await db('etablissements').insert({ nom: 'Lycée B', code_officiel: 'PASS_B', type: 'lycee', pays: 'Sénégal', region: 'Thiès', ville: 'Thiès', actif: true }).returning('*');
  await db('annees_scolaires').insert({ etablissement_id: etabB.id, libelle: '2025-2026', date_debut: '2025-10-01', date_fin: '2026-07-15', nb_periodes: 3, type_periode: 'trimestre', est_courante: true });
  const [dirB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Camara', prenom: 'Ibra', email: 'dir@passb.sn', telephone: '+221770000790', mot_de_passe_hash: await bcrypt.hash('Test1234!', 10), actif: true }).returning('*');
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: (await db('roles').where({ code: 'directeur' }).first()).id, etablissement_id: etabB.id, actif: true });
  await db('politique_securite').insert({ etablissement_id: etabB.id }).onConflict('etablissement_id').ignore();
  tokenB = await creerSession(dirB.id, etabB.id);
  cheminB = '/annees-scolaires/passage';
});
afterAll(async () => { await closeTestDB(); });

const NOUVELLE = { libelle: '2026-2027', date_debut: '2026-10-01', date_fin: '2027-07-15' };
function decisionsPropositions(donnees, surcharges = {}) {
  return donnees.classes.flatMap((c) => c.eleves).map((e) => ({ inscription_id: e.inscription_id, decision: surcharges[e.inscription_id] || e.proposition }));
}
const etat = async () => ({
  courante: (await db('annees_scolaires').where({ etablissement_id: seed.etablissement.id, est_courante: true }).select('libelle')).map((a) => a.libelle),
  annees: (await db('annees_scolaires').where({ etablissement_id: seed.etablissement.id })).length,
  classes: (await db('classes').count('id as n').first()).n,
  inscriptions: (await db('inscriptions').count('id as n').first()).n,
  decisions: (await db('inscriptions').whereNotNull('decision_fin_annee').count('id as n').first()).n,
});

describe('aperçu du passage', () => {
  test('réservé à la direction (permission config.annee_scolaire)', async () => {
    await avec('get', '/annees-scolaires/passage/apercu', tokenEns).expect(403);
    await avec('post', '/annees-scolaires/passage', tokenEns).send({ ...NOUVELLE, decisions: [] }).expect(403);
  });

  test('propose les dates de l\'année suivante et une décision par élève (conseil > moyenne > dernier niveau)', async () => {
    const d = await apercu();
    const [a1, a2] = seed.annee.libelle.split('-').map(Number);
    expect(d.proposition_annee).toMatchObject({ libelle: `${a1 + 1}-${a2 + 1}`, nb_periodes: 3 });
    expect(d.proposition_annee.date_debut).toBe(`${parseInt(d.annee.date_debut, 10) + 1}${d.annee.date_debut.slice(4)}`);
    expect(d.total_eleves).toBe(6);

    expect(trouver(d, e2a.ins.id)).toMatchObject({ moyenne_annuelle: 13, proposition: 'admis', sans_moyenne: false });
    expect(trouver(d, e2b.ins.id)).toMatchObject({ moyenne_annuelle: 6.5, proposition: 'redouble' });
    expect(trouver(d, e1.ins.id)).toMatchObject({ moyenne_annuelle: 5, decision_conseil: 'admis', proposition: 'admis' });
    expect(trouver(d, seed.eleves[0].inscription.id)).toMatchObject({ proposition: 'diplome' });     // dernier niveau
    expect(trouver(d, seed.eleves[1].inscription.id)).toMatchObject({ proposition: 'redouble' });
    expect(trouver(d, seed.eleves[2].inscription.id)).toMatchObject({ sans_moyenne: true, proposition: 'diplome' });

    const g2nde = d.classes.find((c) => c.niveau === '2nde');
    expect(g2nde.dernier_niveau).toBe(false);
    expect(g2nde.cible_admis).toMatchObject({ niveau: '1ère', nom: 'A' });
    expect(d.classes.find((c) => c.classe_id === seed.classe.id).dernier_niveau).toBe(true);
  });

  test('le seuil se règle ; un seuil absurde est refusé', async () => {
    const d = await apercu();                                              // seuil par défaut 10
    expect(trouver(d, e2b.ins.id).proposition).toBe('redouble');
    const souple = (await avec('get', '/annees-scolaires/passage/apercu?seuil=6', tokenDir).expect(200)).body.data;
    expect(trouver(souple, e2b.ins.id).proposition).toBe('admis');         // 6,5 >= 6
    await avec('get', '/annees-scolaires/passage/apercu?seuil=25', tokenDir).expect(422);
  });
});

describe('refus : rien ne change', () => {
  test('décisions incomplètes, inconnues ou doubles', async () => {
    const avant = await etat();
    const d = await apercu();
    const toutes = decisionsPropositions(d);

    const incompletes = await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: toutes.slice(1) }).expect(422);
    expect(incompletes.body.erreur).toMatch(/pas de décision/);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: [...toutes, toutes[0]] }).expect(422);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: [...toutes.slice(1), { inscription_id: '11111111-1111-4111-8111-111111111111', decision: 'admis' }] }).expect(422);
    expect(await etat()).toEqual(avant);
  });

  test('règles métier : diplôme hors dernier niveau, admis au dernier niveau, dates, année déjà existante', async () => {
    const avant = await etat();
    const toutes = decisionsPropositions(await apercu());
    const avecDecision = (id, decision) => toutes.map((x) => (x.inscription_id === id ? { ...x, decision } : x));

    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: avecDecision(e2a.ins.id, 'diplome') }).expect(422);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: avecDecision(seed.eleves[0].inscription.id, 'admis') }).expect(422);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, date_debut: '2020-10-01', date_fin: '2021-07-15', decisions: toutes }).expect(422);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, date_fin: '2026-09-01', decisions: toutes }).expect(422);
    const existante = await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, libelle: seed.annee.libelle, decisions: toutes }).expect(409);
    expect(existante.body.erreur).toMatch(/existe déjà/);
    // un admis ne peut pas être placé dans un niveau inférieur
    await avec('post', '/annees-scolaires/passage', tokenDir)
      .send({ ...NOUVELLE, decisions: toutes.map((x) => (x.inscription_id === e1.ins.id ? { ...x, classe_cible: { niveau_id: nv2nde.id, nom: 'A' } } : x)) }).expect(422);
    expect(await etat()).toEqual(avant);
  });

  test('l\'ancienne création d\'année est refusée tant que des élèves sont inscrits', async () => {
    const res = await avec('post', '/annees-scolaires', tokenDir).send({ ...NOUVELLE, nb_periodes: 3 }).expect(409);
    expect(res.body.erreur).toMatch(/passage d'année/);
    expect(res.body.code).toBe('PASSAGE_REQUIS');
  });

  test('isolation : l\'autre école ne peut pas passer les élèves de celle-ci', async () => {
    const avant = await etat();
    const cible = decisionsPropositions(await apercu());
    await avec('post', cheminB, tokenB).send({ ...NOUVELLE, decisions: cible }).expect(422);
    const siens = (await avec('get', '/annees-scolaires/passage/apercu', tokenB).expect(200)).body.data;
    expect(siens.total_eleves).toBe(0);
    expect(siens.classes).toEqual([]);
    expect(await etat()).toEqual(avant);
  });

  test('atomicité : une panne en cours de route annule tout (année, classes, inscriptions, décisions)', async () => {
    const avant = await etat();
    await db.raw('CREATE OR REPLACE FUNCTION test_panne_affectations() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION \'panne simulée\'; END $$ LANGUAGE plpgsql');
    await db.raw('CREATE TRIGGER test_panne_affectations BEFORE INSERT ON affectations_enseignants FOR EACH ROW EXECUTE FUNCTION test_panne_affectations()');
    try {
      await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, copier_affectations: true, decisions: decisionsPropositions(await apercu()) }).expect(500);
    } finally {
      await db.raw('DROP TRIGGER IF EXISTS test_panne_affectations ON affectations_enseignants');
      await db.raw('DROP FUNCTION IF EXISTS test_panne_affectations()');
    }
    expect(await etat()).toEqual(avant);
    expect((await db('annees_scolaires').where({ id: seed.annee.id }).first()).cloturee_at).toBeNull();
  });
});

describe('le passage', () => {
  let compteRendu;
  const decisions = () => [
    { inscription_id: seed.eleves[0].inscription.id, decision: 'diplome' },
    { inscription_id: seed.eleves[1].inscription.id, decision: 'redouble' },
    { inscription_id: seed.eleves[2].inscription.id, decision: 'transfere' },
    { inscription_id: e2a.ins.id, decision: 'admis' },
    { inscription_id: e2b.ins.id, decision: 'redouble' },
    { inscription_id: e1.ins.id, decision: 'admis' },
  ];

  test('deux passages simultanés : un seul réussit', async () => {
    const corps = (libelle) => ({ ...NOUVELLE, libelle, copier_affectations: true, decisions: decisions() });
    const [a, b] = await Promise.all([
      avec('post', '/annees-scolaires/passage', tokenDir).send(corps('2026-2027')),
      avec('post', '/annees-scolaires/passage', tokenDir).send(corps('2026-2028')),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    compteRendu = (a.status === 201 ? a : b).body.data;
    expect((await etat()).courante).toHaveLength(1);
  });

  test('compte rendu', () => {
    expect(compteRendu).toMatchObject({ ancienne_annee: seed.annee.libelle, reinscrits: 4, admis: 2, redoublants: 2, diplomes: 1, transferts: 1, abandons: 0, exclus: 0 });
    expect(compteRendu.affectations_copiees).toBe(2);                    // la matière archivée n'est pas reconduite
  });

  test('année : clôturée / courante, trois trimestres contigus qui couvrent l\'année', async () => {
    const ancienne = await db('annees_scolaires').where({ id: seed.annee.id }).first();
    expect(ancienne.est_courante).toBe(false);
    expect(ancienne.cloturee_at).not.toBeNull();
    const nouvelle = await db('annees_scolaires').where({ id: compteRendu.annee_id }).first();
    expect(nouvelle).toMatchObject({ est_courante: true, cloturee_at: null, nb_periodes: 3, type_periode: 'trimestre' });
    const periodes = await db('periodes').where({ annee_scolaire_id: nouvelle.id }).orderBy('numero');
    expect(periodes).toHaveLength(3);
    const res = await avec('get', '/annees-scolaires/courante', tokenDir).expect(200);
    expect(res.body.data.libelle).toBe(compteRendu.libelle);
    expect(res.body.data.periodes).toHaveLength(3);
  });

  test('classes : reconduites avec salle et capacité, plus la classe d\'accueil manquante', async () => {
    const classes = await db('classes as c').join('niveaux as n', 'n.id', 'c.niveau_id').where({ 'c.annee_scolaire_id': compteRendu.annee_id }).select('n.nom as niveau', 'c.nom', 'c.salle_principale', 'c.effectif_max');
    const libelles = classes.map((c) => `${c.niveau} ${c.nom}`).sort();
    expect(libelles).toContain('2nde A');
    expect(libelles).toContain('1ère A');
    expect(classes.find((c) => c.niveau === '1ère')).toMatchObject({ salle_principale: 'Salle 1A', effectif_max: 40 });
    expect(classes.find((c) => c.niveau === '2nde')).toMatchObject({ salle_principale: 'Salle 2A', effectif_max: 45 });
    expect(libelles.filter((l) => l.startsWith('Terminale'))).toHaveLength(2);          // celle du seed + « Terminale A » créée pour l'élève de 1ère
    expect((await avec('get', '/classes', tokenDir).expect(200)).body.data.length).toBe(classes.length);
  });

  test('élèves : réinscrits dans les bonnes classes de la nouvelle année, listes de la nouvelle année', async () => {
    const liste = (await avec('get', '/eleves', tokenDir).expect(200)).body.data;
    expect(liste.map((e) => e.nom).sort()).toEqual(['Admis', 'Conseil', 'Faible', seed.eleves[1].user.nom].sort());
    const classeDe = (nom) => liste.find((e) => e.nom === nom).classe;
    expect(classeDe('Admis')).toBe('1ère A');                  // 2nde A -> 1ère A
    expect(classeDe('Faible')).toBe('2nde A');                 // redouble
    expect(classeDe('Conseil')).toMatch(/^Terminale/);         // 1ère A -> Terminale
    expect(liste.every((e) => e.statut === 'actif')).toBe(true);
    const redoublants = await db('eleves').where({ redoublant: true }).pluck('id');
    expect(redoublants.sort()).toEqual([e2b.el.id, seed.eleves[1].eleve.id].sort());
  });

  test('anciennes inscriptions : conservées, avec la décision de fin d\'année ; sorties fermées', async () => {
    const lire = (id) => db('inscriptions').where({ id }).first();
    expect(await lire(seed.eleves[0].inscription.id)).toMatchObject({ statut: 'diplome', decision_fin_annee: 'diplome' });
    expect((await lire(seed.eleves[0].inscription.id)).date_fin).not.toBeNull();
    expect(await lire(seed.eleves[2].inscription.id)).toMatchObject({ statut: 'transfere', decision_fin_annee: 'transfere' });
    expect(await lire(e2a.ins.id)).toMatchObject({ statut: 'actif', decision_fin_annee: 'admis', annee_scolaire_id: seed.annee.id });
    expect(await lire(e2b.ins.id)).toMatchObject({ decision_fin_annee: 'redouble' });
    // l'historique de l'ancienne année est intact
    expect(await db('moyennes_generales').where({ inscription_id: e2a.ins.id })).toHaveLength(2);
  });

  test('affectations reconduites sur les classes de la nouvelle année', async () => {
    const lignes = await db('affectations_enseignants as ae').join('classes as c', 'c.id', 'ae.classe_id').join('matieres as m', 'm.id', 'ae.matiere_id')
      .where({ 'ae.annee_scolaire_id': compteRendu.annee_id }).select('c.annee_scolaire_id as annee_classe', 'm.code');
    expect(lignes).toHaveLength(2);
    expect(lignes.every((l) => l.annee_classe === compteRendu.annee_id && l.code === 'PHI')).toBe(true);
    expect(affectTerminale.annee_scolaire_id).toBe(seed.annee.id);
  });

  test('journal d\'audit', async () => {
    const a = await db('journal_audit').where({ action: 'annee.passage' }).first();
    expect(a.utilisateur_id).toBe(seed.directeur.id);
    expect(JSON.stringify(a.details)).toContain('"reinscrits"'.replace('reinscrits', 'diplomes'));
  });

  test('le passage suivant part de la nouvelle année (une année ne se rejoue pas)', async () => {
    const d = await apercu();
    expect(d.annee.libelle).toBe('2026-2027');
    expect(d.proposition_annee.libelle).toBe('2027-2028');
    expect(d.total_eleves).toBe(4);
    await avec('post', '/annees-scolaires/passage', tokenDir).send({ ...NOUVELLE, decisions: decisionsPropositions(d) }).expect(422);   // « 2026-2027 » est l'année en cours : doit commencer après
  });
});
