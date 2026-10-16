'use strict';

// Base PostgreSQL réelle : corriger / retirer un élève, modifier / archiver une classe et une matière

const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns, tokenGestion, tokenB, classeB, matiereB, eleveB;
const avec = (methode, chemin, token) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);
const eleveA = () => seed.eleves[0];
const inscription = (eleve) => db('inscriptions').where({ id: eleve.inscription.id }).first();

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  await db.raw("SELECT affecter_permissions('admin', ARRAY['eleves.voir','eleves.modifier','eleves.archiver'])");
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Gestionnaire : droits de modification, mais PAS la permission médicale
  const [g] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom: 'Gestion', prenom: 'Admin', telephone: '+221770000601', actif: true }).returning('*');
  await db('utilisateur_roles').insert({ utilisateur_id: g.id, role_id: (await db('roles').where({ code: 'admin' }).first()).id, etablissement_id: seed.etablissement.id, actif: true });
  tokenGestion = await creerSession(g.id, seed.etablissement.id);

  // Établissement B : directeur, classe, élève, matière
  const [etabB] = await db('etablissements').insert({ nom: 'Collège B', code_officiel: 'GEST_B', type: 'college', pays: 'Sénégal', region: 'Thiès', ville: 'Thiès', actif: true }).returning('*');
  const [anneeB] = await db('annees_scolaires').insert({ etablissement_id: etabB.id, libelle: '2024-2025', date_debut: '2024-10-01', date_fin: '2025-07-15', nb_periodes: 3, type_periode: 'trimestre', est_courante: true }).returning('*');
  const [niveauB] = await db('niveaux').insert({ etablissement_id: etabB.id, nom: '3ème', nom_court: '3e', cycle: 'college', ordre: 9 }).returning('*');
  [classeB] = await db('classes').insert({ niveau_id: niveauB.id, nom: 'A', annee_scolaire_id: anneeB.id, effectif_max: 40 }).returning('*');
  const [dirB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Camara', prenom: 'Ibrahima', email: 'dir@gestb.sn', telephone: '+221770000690', mot_de_passe_hash: await bcrypt.hash('Test1234!', 10), actif: true }).returning('*');
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: (await db('roles').where({ code: 'directeur' }).first()).id, etablissement_id: etabB.id, actif: true });
  await db('politique_securite').insert({ etablissement_id: etabB.id }).onConflict('etablissement_id').ignore();
  tokenB = await creerSession(dirB.id, etabB.id);
  const [uEleveB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Eleve', prenom: 'B', actif: true }).returning('*');
  [eleveB] = await db('eleves').insert({ utilisateur_id: uEleveB.id, matricule: 'MAT-B-1' }).returning('*');
  await db('inscriptions').insert({ eleve_id: eleveB.id, classe_id: classeB.id, annee_scolaire_id: anneeB.id, statut: 'actif' });
  [matiereB] = await db('matieres').insert({ etablissement_id: etabB.id, nom: 'Matière B', code: 'MB', actif: true }).returning('*');
});
afterAll(async () => { await closeTestDB(); });

describe('PUT /eleves/:id — corriger une fiche', () => {
  test('un enseignant ne peut pas modifier un élève', async () => {
    await avec('put', `/eleves/${eleveA().user.id}`, tokenEns).send({ nom: 'Pirate' }).expect(403);
  });

  test('le directeur corrige l\'identité ; le numéro est normalisé ; le journal garde les champs, pas les valeurs', async () => {
    const res = await avec('put', `/eleves/${eleveA().user.id}`, tokenDir)
      .send({ nom: 'Corrigé', prenom: 'Awa', telephone: '77 000 06 02', redoublant: true }).expect(200);
    expect(res.body.data.classe_modifiee).toBe(false);
    const u = await db('utilisateurs').where({ id: eleveA().user.id }).first();
    expect(u).toMatchObject({ nom: 'Corrigé', prenom: 'Awa', telephone: '+221770000602' });
    expect((await db('eleves').where({ id: eleveA().eleve.id }).first()).redoublant).toBe(true);
    const audit = await db('journal_audit').where({ action: 'eleves.modifier', enregistrement_id: u.id }).first();
    expect(audit.utilisateur_id).toBe(seed.directeur.id);
    expect(JSON.stringify(audit.details)).toContain('telephone');
    expect(JSON.stringify(audit.details)).not.toContain('770000602');
  });

  test('doublons refusés : téléphone d\'un autre compte, matricule d\'un autre élève', async () => {
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ telephone: seed.directeur.telephone }).expect(422);
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ matricule: seed.eleves[1].eleve.matricule }).expect(422);
  });

  test('corps vide refusé ; données médicales réservées à la permission eleves.medicale', async () => {
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({}).expect(422);
    await avec('put', `/eleves/${eleveA().user.id}`, tokenGestion).send({ allergies: 'Arachides' }).expect(403);
    await avec('put', `/eleves/${eleveA().user.id}`, tokenGestion).send({ prenom: 'Aïcha' }).expect(200);   // sans médical : permis
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ allergies: 'Arachides' }).expect(200);
    const fiche = await avec('get', `/eleves/${eleveA().user.id}`, tokenDir).expect(200);
    expect(JSON.stringify(fiche.body.data)).toContain('Arachides');
  });

  test('changement de classe : la classe de l\'année courante suit ; une classe d\'une autre école est refusée', async () => {
    const nouvelle = await avec('post', '/classes', tokenDir).send({ niveau_id: seed.niveau.id, nom: 'Z' }).expect(201);
    const res = await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ classe_id: nouvelle.body.data.id }).expect(200);
    expect(res.body.data.classe_modifiee).toBe(true);
    expect((await inscription(eleveA())).classe_id).toBe(nouvelle.body.data.id);
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ classe_id: classeB.id }).expect(404);
    expect((await inscription(eleveA())).classe_id).toBe(nouvelle.body.data.id);
    // retour dans la classe d'origine pour la suite
    await avec('put', `/eleves/${eleveA().user.id}`, tokenDir).send({ classe_id: seed.classe.id }).expect(200);
  });

  test('isolation : l\'autre école ne voit ni ne modifie cet élève', async () => {
    await avec('put', `/eleves/${eleveA().user.id}`, tokenB).send({ nom: 'Intrus' }).expect(404);
    await avec('put', `/eleves/${eleveA().user.id}/statut`, tokenB).send({ statut: 'exclu', motif: 'Intrusion' }).expect(404);
    expect((await db('utilisateurs').where({ id: eleveA().user.id }).first()).nom).toBe('Corrigé');
  });

  test('POST /eleves refuse la classe d\'une autre école', async () => {
    await avec('post', '/eleves', tokenDir).send({ nom: 'Fantome', prenom: 'Eleve', classe_id: classeB.id }).expect(404);
    expect(await db('utilisateurs').where({ nom: 'Fantome' }).first()).toBeUndefined();
  });
});

describe('PUT /eleves/:id/statut — retirer / réintégrer', () => {
  test('droits : un enseignant est refusé ; un motif est obligatoire pour retirer', async () => {
    const id = seed.eleves[1].user.id;
    await avec('put', `/eleves/${id}/statut`, tokenEns).send({ statut: 'transfere', motif: 'Déménagement' }).expect(403);
    await avec('put', `/eleves/${id}/statut`, tokenDir).send({ statut: 'transfere' }).expect(422);
  });

  test('transfert : l\'inscription est fermée (date_fin), l\'effectif baisse, la fiche reste ; puis réintégration', async () => {
    const e = seed.eleves[1];
    const avant = (await avec('get', '/classes', tokenDir)).body.data.find(c => c.id === seed.classe.id);
    await avec('put', `/eleves/${e.user.id}/statut`, tokenDir).send({ statut: 'transfere', motif: 'Déménagement à Dakar' }).expect(200);
    const insc = await inscription(e);
    expect(insc.statut).toBe('transfere');
    expect(insc.date_fin).not.toBeNull();
    const apres = (await avec('get', '/classes', tokenDir)).body.data.find(c => c.id === seed.classe.id);
    expect(parseInt(apres.effectif, 10)).toBe(parseInt(avant.effectif, 10) - 1);
    await avec('get', `/eleves/${e.user.id}`, tokenDir).expect(200);                       // jamais supprimé
    const audit = await db('journal_audit').where({ action: 'eleves.retirer', enregistrement_id: e.user.id }).first();
    expect(JSON.stringify(audit.details)).toContain('Déménagement');

    await avec('put', `/eleves/${e.user.id}/statut`, tokenDir).send({ statut: 'transfere', motif: 'Encore' }).expect(422);   // déjà transféré
    await avec('put', `/eleves/${e.user.id}`, tokenDir).send({ classe_id: seed.classe.id }).expect(422);                      // plus inscrit : pas de changement de classe
    await avec('put', `/eleves/${e.user.id}/statut`, tokenDir).send({ statut: 'actif' }).expect(200);
    const rouvert = await inscription(e);
    expect(rouvert.statut).toBe('actif');
    expect(rouvert.date_fin).toBeNull();
  });
});

describe('Classes — modifier et archiver', () => {
  let vide;
  test('modification : lettre, salle ; doublon refusé ; capacité inférieure à l\'effectif refusée ; isolation', async () => {
    vide = (await avec('post', '/classes', tokenDir).send({ niveau_id: seed.niveau.id, nom: 'Q' }).expect(201)).body.data;
    await avec('put', `/classes/${vide.id}`, tokenDir).send({ nom: 'r', salle_principale: 'Salle 9' }).expect(200);
    const c = await db('classes').where({ id: vide.id }).first();
    expect(c).toMatchObject({ nom: 'R', salle_principale: 'Salle 9' });

    await avec('put', `/classes/${vide.id}`, tokenDir).send({ nom: seed.classe.nom }).expect(409);
    const effectif = (await avec('get', '/classes', tokenDir)).body.data.find(x => x.id === seed.classe.id).effectif;
    await avec('put', `/classes/${seed.classe.id}`, tokenDir).send({ effectif_max: parseInt(effectif, 10) - 1 }).expect(409);
    await avec('put', `/classes/${vide.id}`, tokenEns).send({ nom: 'S' }).expect(403);
    await avec('put', `/classes/${vide.id}`, tokenB).send({ nom: 'S' }).expect(404);
    await avec('put', `/classes/${vide.id}`, tokenDir).send({}).expect(422);
  });

  test('archivage refusé avec des élèves ou des affectations ; accepté sinon ; isolation', async () => {
    const eleves = await avec('delete', `/classes/${seed.classe.id}`, tokenDir).expect(409);
    expect(eleves.body.erreur).toMatch(/élève/);

    await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Matière Q', code: 'MQ', actif: true });
    const mat = await db('matieres').where({ code: 'MQ' }).first();
    await db('affectations_enseignants').insert({ enseignant_id: seed.enseignant.id, classe_id: vide.id, matiere_id: mat.id, annee_scolaire_id: seed.annee.id });
    expect((await avec('delete', `/classes/${vide.id}`, tokenDir).expect(409)).body.erreur).toMatch(/affectation/);
    await db('affectations_enseignants').where({ classe_id: vide.id }).del();

    await avec('delete', `/classes/${vide.id}`, tokenB).expect(404);
    await avec('delete', `/classes/${vide.id}`, tokenDir).expect(204);
    const liste = (await avec('get', '/classes', tokenDir)).body.data;
    expect(liste.some(c => c.id === vide.id)).toBe(false);
    expect((await db('classes').where({ id: vide.id }).first()).actif).toBe(false);          // archivée, pas supprimée
    await avec('delete', `/classes/${vide.id}`, tokenDir).expect(404);
  });
});

describe('Matières — modifier et archiver', () => {
  let m;
  test('modification : nom, code ; code en doublon refusé ; isolation', async () => {
    m = (await avec('post', '/configs/matieres', tokenDir).send({ nom: 'Histoire', code: 'HIST' }).expect(201)).body.data;
    await avec('post', '/configs/matieres', tokenDir).send({ nom: 'Géographie', code: 'GEO' }).expect(201);
    await avec('put', `/configs/matieres/${m.id}`, tokenDir).send({ nom: 'Histoire-Géo', est_optionnelle: true }).expect(200);
    expect(await db('matieres').where({ id: m.id }).first()).toMatchObject({ nom: 'Histoire-Géo', est_optionnelle: true });
    await avec('put', `/configs/matieres/${m.id}`, tokenDir).send({ code: 'GEO' }).expect(422);
    await avec('put', `/configs/matieres/${m.id}`, tokenEns).send({ nom: 'Xy' }).expect(403);
    await avec('put', `/configs/matieres/${m.id}`, tokenB).send({ nom: 'Xy' }).expect(404);
    await avec('put', `/configs/matieres/${matiereB.id}`, tokenDir).send({ nom: 'Volée' }).expect(404);
    expect((await db('matieres').where({ id: matiereB.id }).first()).nom).toBe('Matière B');
  });

  test('archivage refusé si un enseignant y est affecté cette année ; sinon archivée (conservée en base), puis réactivable', async () => {
    await db('affectations_enseignants').insert({ enseignant_id: seed.enseignant.id, classe_id: seed.classe.id, matiere_id: m.id, annee_scolaire_id: seed.annee.id });
    expect((await avec('delete', `/configs/matieres/${m.id}`, tokenDir).expect(409)).body.erreur).toMatch(/affectation/);
    await avec('put', `/configs/matieres/${m.id}`, tokenDir).send({ actif: false }).expect(409);
    await db('affectations_enseignants').where({ matiere_id: m.id }).del();

    await avec('delete', `/configs/matieres/${m.id}`, tokenB).expect(404);
    await avec('delete', `/configs/matieres/${m.id}`, tokenDir).expect(204);
    expect(await db('matieres').where({ id: m.id }).first()).toMatchObject({ actif: false });   // conservée pour l'historique

    await avec('put', `/configs/matieres/${m.id}`, tokenDir).send({ actif: true }).expect(200);
    expect((await db('matieres').where({ id: m.id }).first()).actif).toBe(true);
  });
});

describe('GET /eleves?statut=retires', () => {
  test('liste les élèves retirés (avec leur statut), absents de la liste par défaut', async () => {
    const e = seed.eleves[2];
    await avec('put', `/eleves/${e.user.id}/statut`, tokenDir).send({ statut: 'abandonne', motif: 'Abandon scolaire' }).expect(200);
    const defaut = (await avec('get', '/eleves', tokenDir).expect(200)).body.data;
    expect(defaut.some(x => x.id === e.user.id)).toBe(false);
    const retires = (await avec('get', '/eleves?statut=retires', tokenDir).expect(200)).body.data;
    expect(retires.map(x => x.id)).toEqual([e.user.id]);
    expect(retires[0].statut).toBe('abandonne');
    expect((await avec('get', '/eleves?statut=retires', tokenB).expect(200)).body.data).toEqual([]);   // l'autre école ne les voit pas
  });
});
