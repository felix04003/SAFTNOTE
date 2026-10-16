'use strict';

// Base PostgreSQL réelle : un parent peut avoir des enfants dans plusieurs
// établissements (migration 024 + tâches 3.1 à 3.3). Un compte par école, le
// même numéro de téléphone ; codes SMS et données strictement séparés.

const crypto = require('crypto');
const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');

let db, request, seed, etabB, classeB, tokenDirA, tokenDirB, codeA, codeB;
const TEL = '+221772220001';
const hash = (c) => crypto.createHash('sha256').update(c).digest('hex');

const creerEleve = (token, classeId, prenom, telParent = '77 222 00 01') => request
  .post('/api/v1/eleves').set('Authorization', `Bearer ${token}`)
  .send({
    nom: 'Ndiaye', prenom, classe_id: classeId,
    parent: { nom: 'Ndiaye', prenom: 'Papa', telephone: telParent, lien: 'pere' },
  });

const comptesParent = (etabId) => db('utilisateurs').where({ etablissement_id: etabId, telephone: TEL });

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  codeA = seed.etablissement.code_officiel;
  tokenDirA = await creerSession(seed.directeur.id, seed.etablissement.id);

  [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_MULTI_B', type: 'college', pays: 'Sénégal', ville: 'Thiès', actif: true,
  }).returning('*');
  codeB = etabB.code_officiel;
  const [anneeB] = await db('annees_scolaires').insert({
    etablissement_id: etabB.id, libelle: '2024-2025', date_debut: '2024-10-01', date_fin: '2025-07-15',
    nb_periodes: 3, type_periode: 'trimestre', est_courante: true,
  }).returning('*');
  const [niveauB] = await db('niveaux').insert({
    etablissement_id: etabB.id, nom: '3ème', nom_court: '3e', cycle: 'college', ordre: 9,
  }).returning('*');
  [classeB] = await db('classes').insert({
    niveau_id: niveauB.id, nom: '3e A', annee_scolaire_id: anneeB.id, effectif_max: 40,
  }).returning('*');

  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id, nom: 'Camara', prenom: 'Ibrahima', email: 'dir.multi.b@test.sn',
    telephone: '+221770000090', mot_de_passe_hash: await bcrypt.hash('Test1234!', 4), actif: true,
  }).returning('*');
  const roleDir = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: roleDir.id, etablissement_id: etabB.id });
  tokenDirB = await creerSession(dirB.id, etabB.id);
});

afterAll(async () => { await closeTestDB(); });

describe('création : le même parent dans deux établissements', () => {
  test('école A puis école B avec le MÊME numéro : deux comptes distincts, aucun refus', async () => {
    await creerEleve(tokenDirA, seed.classe.id, 'Moussa').expect(201);
    await creerEleve(tokenDirB, classeB.id, 'Aida').expect(201);     // refusé (422) avant la migration 024

    const [a] = await comptesParent(seed.etablissement.id);
    const [b] = await comptesParent(etabB.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a.id).not.toBe(b.id);

    // Chaque compte a son rôle parent, ses préférences et son enfant — dans SA école
    for (const [compte, etabId] of [[a, seed.etablissement.id], [b, etabB.id]]) {
      const role = await db('utilisateur_roles as ur').join('roles as r', 'r.id', 'ur.role_id')
        .where({ 'ur.utilisateur_id': compte.id, 'ur.etablissement_id': etabId, 'r.code': 'parent' }).first('ur.id');
      expect(role).toBeDefined();
      expect(await db('notifications_preferences').where({ utilisateur_id: compte.id }).first('id')).toBeDefined();
      expect(await db('parents_eleves').where({ parent_id: compte.id })).toHaveLength(1);
    }
  });

  test('fratrie : un 2e enfant dans la même école réutilise le compte (un seul compte par école)', async () => {
    await creerEleve(tokenDirA, seed.classe.id, 'Cheikh', '+221 77 222 00 01').expect(201);   // autre saisie du numéro

    const comptes = await comptesParent(seed.etablissement.id);
    expect(comptes).toHaveLength(1);
    expect(await db('parents_eleves').where({ parent_id: comptes[0].id })).toHaveLength(2);
  });

  test('la base refuse toujours deux comptes de même numéro DANS la même école', async () => {
    let erreur;
    try {
      await db('utilisateurs').insert({
        etablissement_id: seed.etablissement.id, nom: 'Doublon', prenom: 'Test', telephone: TEL, actif: true,
      });
    } catch (e) { erreur = e; }
    expect(erreur).toBeDefined();
    expect(erreur.code).toBe('23505');
    expect(erreur.constraint).toBe('utilisateurs_etab_telephone_key');
  });
});

describe('codes SMS : un code par compte (3.1)', () => {
  const demander = (code) => request.post('/api/v1/auth/otp/demander').send({ telephone: TEL, etablissement_code: code });
  const valider = (code, etab) => request.post('/api/v1/auth/otp/valider')
    .send({ telephone: TEL, code, etablissement_code: etab });

  test('demander un code pour B n\'annule pas celui de A ; chaque code n\'ouvre que SON école', async () => {
    await demander(codeA).expect(200);
    await demander(codeB).expect(200);

    const [a] = await comptesParent(seed.etablissement.id);
    const [b] = await comptesParent(etabB.id);
    const lignes = await db('otp_verifications').where({ telephone: TEL, utilise: false });
    expect(lignes.map(l => l.utilisateur_id).sort()).toEqual([a.id, b.id].sort());   // un code actif PAR compte

    // Codes connus pour la suite (les vrais ne sont pas lisibles : seul leur hash est stocké)
    await db('otp_verifications').where({ utilisateur_id: a.id, utilise: false }).update({ code_hash: hash('111111') });
    await db('otp_verifications').where({ utilisateur_id: b.id, utilise: false }).update({ code_hash: hash('222222') });

    await valider('111111', codeB).expect(401);   // le code de A ne passe pas dans l'école B
    await valider('000000', codeB).expect(401);   // des essais ratés sur B ne brûlent pas le code de A

    const sessionA = await valider('111111', codeA).expect(200);
    expect(sessionA.body.data.utilisateur.etablissement_id).toBe(seed.etablissement.id);

    const sessionB = await valider('222222', codeB).expect(200);
    expect(sessionB.body.data.utilisateur.etablissement_id).toBe(etabB.id);

    // Chaque session ne voit que SES enfants
    const enfantsA = await request.get('/api/v1/parents/moi/enfants').set('Authorization', `Bearer ${sessionA.body.data.token}`).expect(200);
    const enfantsB = await request.get('/api/v1/parents/moi/enfants').set('Authorization', `Bearer ${sessionB.body.data.token}`).expect(200);
    const prenoms = (res) => JSON.stringify(res.body.data);
    expect(prenoms(enfantsA)).toContain('Moussa');
    expect(prenoms(enfantsA)).not.toContain('Aida');
    expect(prenoms(enfantsB)).toContain('Aida');
    expect(prenoms(enfantsB)).not.toContain('Moussa');
  });
});

describe('réinitialisation de mot de passe : un code par compte (3.1)', () => {
  test('deux comptes de même numéro dans deux écoles : leurs codes de réinitialisation sont indépendants', async () => {
    // Un enseignant vacataire présent dans les deux écoles avec le même numéro
    const TEL_ENS = '+221773330001';
    const roleEns = await db('roles').where({ code: 'enseignant' }).first();
    const comptes = [];
    for (const etabId of [seed.etablissement.id, etabB.id]) {
      const [u] = await db('utilisateurs').insert({
        etablissement_id: etabId, nom: 'Gueye', prenom: 'Vacataire', telephone: TEL_ENS,
        mot_de_passe_hash: await bcrypt.hash('Test1234!', 4), actif: true,
      }).returning('*');
      await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: roleEns.id, etablissement_id: etabId });
      comptes.push(u);
    }

    for (const code of [codeA, codeB]) {
      await request.post('/api/v1/auth/mot-de-passe-oublie').send({ identifiant: TEL_ENS, etablissement_code: code }).expect(200);
    }

    const lignes = await db('otp_verifications').where({ telephone: TEL_ENS, objectif: 'reset_mdp', utilise: false });
    expect(lignes.map(l => l.utilisateur_id).sort()).toEqual(comptes.map(c => c.id).sort());
  });
});
