'use strict';

// Base PostgreSQL réelle : ajouter, corriger et retirer un parent ou tuteur après l'inscription

const supertest = require('supertest');
const bcrypt = require('bcryptjs');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenDir, tokenEns, tokenB, fille, frere;       // deux enfants du seed (fratrie)
const avec = (methode, chemin, token) => request[methode](`/api/v1${chemin}`).set('Authorization', `Bearer ${token}`);
const parentsDe = (enfant) => db('parents_eleves as pe').join('utilisateurs as u', 'u.id', 'pe.parent_id').where({ 'pe.eleve_id': enfant.eleve.id })
  .orderBy('pe.created_at').select('u.id', 'u.nom', 'u.telephone', 'pe.lien', 'pe.est_contact_principal', 'pe.peut_voir_notes', 'pe.peut_voir_bulletins');
const principaux = async (enfant) => (await parentsDe(enfant)).filter((p) => p.est_contact_principal);
const compteParTelephone = (tel) => db('utilisateurs').where({ telephone: tel }).first();

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  [fille, frere] = seed.eleves;
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  const [etabB] = await db('etablissements').insert({ nom: 'Lycée B', code_officiel: 'PAR_B', type: 'lycee', pays: 'Sénégal', region: 'Thiès', ville: 'Thiès', actif: true }).returning('*');
  const [dirB] = await db('utilisateurs').insert({ etablissement_id: etabB.id, nom: 'Camara', prenom: 'Ibra', email: 'dir@parb.sn', telephone: '+221770000890', mot_de_passe_hash: await bcrypt.hash('Test1234!', 10), actif: true }).returning('*');
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: (await db('roles').where({ code: 'directeur' }).first()).id, etablissement_id: etabB.id, actif: true });
  await db('politique_securite').insert({ etablissement_id: etabB.id }).onConflict('etablissement_id').ignore();
  tokenB = await creerSession(dirB.id, etabB.id);
});
afterAll(async () => { await closeTestDB(); });

const MAMAN = { nom: 'Sy', prenom: 'Mariama', telephone: '77 000 07 01', lien: 'mere' };

describe('droits et isolation', () => {
  test('un enseignant ne peut ni ajouter, ni modifier, ni retirer un parent', async () => {
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenEns).send(MAMAN).expect(403);
    await avec('put', `/eleves/${fille.user.id}/parents/${seed.directeur.id}`, tokenEns).send({ lien: 'pere' }).expect(403);
    await avec('delete', `/eleves/${fille.user.id}/parents/${seed.directeur.id}`, tokenEns).expect(403);
    expect(await parentsDe(fille)).toHaveLength(0);
  });
});

describe('POST /eleves/:id/parents', () => {
  test('crée le compte (numéro normalisé, rôle parent, préférences SMS) ; premier parent = contact principal d\'office', async () => {
    const res = await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send(MAMAN).expect(201);
    expect(res.body.data).toMatchObject({ compte_cree: true, est_contact_principal: true, compte_existant: null });
    const compte = await compteParTelephone('+221770000701');
    expect(compte).toMatchObject({ nom: 'Sy', prenom: 'Mariama', etablissement_id: seed.etablissement.id, actif: true });
    const role = await db('utilisateur_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where({ 'ur.utilisateur_id': compte.id }).pluck('r.code');
    expect(role).toEqual(['parent']);
    expect(await db('notifications_preferences').where({ utilisateur_id: compte.id }).first()).toMatchObject({ canal_prefere: 'sms' });
    expect(await parentsDe(fille)).toEqual([expect.objectContaining({ id: compte.id, lien: 'mere', est_contact_principal: true })]);
  });

  test('un second parent n\'est principal que si on le demande ; il n\'y a jamais deux contacts principaux', async () => {
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send({ nom: 'Sy', prenom: 'Oumar', telephone: '77 000 07 02', lien: 'pere' }).expect(201);
    expect((await principaux(fille)).map((p) => p.telephone)).toEqual(['+221770000701']);
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send({ nom: 'Ba', prenom: 'Tante', telephone: '77 000 07 03', lien: 'oncle_tante', est_contact_principal: true }).expect(201);
    expect((await principaux(fille)).map((p) => p.telephone)).toEqual(['+221770000703']);
    expect(await parentsDe(fille)).toHaveLength(3);
  });

  test('un numéro déjà connu est RÉUTILISÉ (fratrie) : pas de second compte, les noms saisis sont ignorés', async () => {
    const avant = (await db('utilisateurs').count('id as n').first()).n;
    const res = await avec('post', `/eleves/${frere.user.id}/parents`, tokenDir)
      .send({ nom: 'Autre', prenom: 'Nom', telephone: '+221 77 000 07 01', lien: 'mere' }).expect(201);
    expect(res.body.data).toMatchObject({ compte_cree: false, compte_existant: { nom: 'Sy', prenom: 'Mariama' } });
    expect((await db('utilisateurs').count('id as n').first()).n).toBe(avant);
    expect((await parentsDe(frere)).map((p) => p.telephone)).toEqual(['+221770000701']);
  });

  test('refus : déjà rattaché, numéro de l\'élève lui-même, numéro invalide', async () => {
    const doublon = await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send(MAMAN).expect(409);
    expect(doublon.body.erreur).toMatch(/déjà rattaché/);
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send({ ...MAMAN, telephone: fille.user.telephone }).expect(422);
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenDir).send({ ...MAMAN, telephone: '123' }).expect(422);
    expect(await parentsDe(fille)).toHaveLength(3);
  });
});

describe('PUT /eleves/:id/parents/:parent_id', () => {
  let maman;
  beforeAll(async () => { maman = await compteParTelephone('+221770000701'); });

  test('lien, droits et contact principal : un seul principal à tout moment', async () => {
    await avec('put', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).send({ est_contact_principal: true, peut_voir_bulletins: false, lien: 'tuteur' }).expect(200);
    expect((await principaux(fille)).map((p) => p.id)).toEqual([maman.id]);
    const ligne = (await parentsDe(fille)).find((p) => p.id === maman.id);
    expect(ligne).toMatchObject({ lien: 'tuteur', peut_voir_bulletins: false, peut_voir_notes: true });
    await avec('put', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).send({}).expect(422);
  });

  test('le droit de voir les bulletins se règle PAR enfant (le frère garde le sien)', async () => {
    expect((await parentsDe(frere)).find((p) => p.id === maman.id).peut_voir_bulletins).toBe(true);
  });

  test('un numéro qui change : le compte est mis à jour pour TOUS ses enfants, l\'ancien numéro ne désigne plus personne', async () => {
    await avec('put', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).send({ telephone: '78 111 22 33', nom: 'Sy-Diop' }).expect(200);
    const apres = await db('utilisateurs').where({ id: maman.id }).first();
    expect(apres).toMatchObject({ telephone: '+221781112233', nom: 'Sy-Diop' });
    expect(await compteParTelephone('+221770000701')).toBeUndefined();
    expect((await parentsDe(frere)).find((p) => p.id === maman.id).telephone).toBe('+221781112233');     // même personne chez le frère
  });

  test('un numéro déjà pris par quelqu\'un d\'autre est refusé, en nommant son détenteur', async () => {
    const res = await avec('put', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).send({ telephone: '77 000 07 02' }).expect(422);
    expect(res.body.erreur).toMatch(/Oumar Sy/);
    expect((await db('utilisateurs').where({ id: maman.id }).first()).telephone).toBe('+221781112233');
  });

  test('compte du personnel : lien et droits modifiables, mais PAS son nom ni son numéro d\'ici', async () => {
    // L'enseignante est aussi la tante de l'élève : on réutilise son compte (rôle parent ajouté)
    const ajout = await avec('post', `/eleves/${frere.user.id}/parents`, tokenDir)
      .send({ nom: 'Xx', prenom: 'Yy', telephone: seed.enseignantUser.telephone, lien: 'oncle_tante' }).expect(201);
    expect(ajout.body.data.compte_cree).toBe(false);
    const avant = await db('utilisateurs').where({ id: seed.enseignantUser.id }).first();
    const refus = await avec('put', `/eleves/${frere.user.id}/parents/${seed.enseignantUser.id}`, tokenDir).send({ telephone: '77 000 07 09' }).expect(409);
    expect(refus.body.code).toBe('COMPTE_PERSONNEL');
    await avec('put', `/eleves/${frere.user.id}/parents/${seed.enseignantUser.id}`, tokenDir).send({ nom: 'Pirate' }).expect(409);
    await avec('put', `/eleves/${frere.user.id}/parents/${seed.enseignantUser.id}`, tokenDir).send({ lien: 'autre', peut_voir_notes: false }).expect(200);
    const apres = await db('utilisateurs').where({ id: seed.enseignantUser.id }).first();
    expect({ nom: apres.nom, telephone: apres.telephone }).toEqual({ nom: avant.nom, telephone: avant.telephone });
  });

  test('un parent non rattaché à cet élève : 404', async () => {
    const oumar = await compteParTelephone('+221770000702');
    await avec('put', `/eleves/${frere.user.id}/parents/${oumar.id}`, tokenDir).send({ lien: 'pere' }).expect(404);
  });
});

describe('DELETE /eleves/:id/parents/:parent_id', () => {
  test('détache le parent : son compte reste, le contact principal passe au plus ancien restant, l\'accès à l\'enfant est coupé aussitôt', async () => {
    const maman = await db('utilisateurs').where({ prenom: 'Mariama', nom: 'Sy-Diop' }).first();
    const tokenMaman = await creerSession(maman.id, seed.etablissement.id);
    const enfantsAvant = (await avec('get', '/parents/moi/enfants', tokenMaman).expect(200)).body.data;
    expect(enfantsAvant).toHaveLength(2);                                            // fille et frère

    const res = await avec('delete', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).expect(200);
    const restants = await parentsDe(fille);
    expect(restants.map((p) => p.id)).not.toContain(maman.id);
    expect(res.body.data.nouveau_contact_principal).toBeTruthy();
    expect((await principaux(fille)).map((p) => p.id)).toEqual([res.body.data.nouveau_contact_principal]);
    expect(await db('utilisateurs').where({ id: maman.id }).first()).toBeDefined();              // le compte reste

    const enfantsApres = (await avec('get', '/parents/moi/enfants', tokenMaman).expect(200)).body.data;
    expect(enfantsApres).toHaveLength(1);                                            // plus que le frère
    await avec('get', `/parents/moi/enfants/${fille.user.id}/notes`, tokenMaman).expect(403);
    await avec('delete', `/eleves/${fille.user.id}/parents/${maman.id}`, tokenDir).expect(404);   // déjà détaché
  });

  test('retirer un parent qui n\'est pas le contact principal ne change pas le principal', async () => {
    const avant = (await principaux(fille)).map((p) => p.id);
    const autre = (await parentsDe(fille)).find((p) => !avant.includes(p.id));
    const res = await avec('delete', `/eleves/${fille.user.id}/parents/${autre.id}`, tokenDir).expect(200);
    expect(res.body.data.nouveau_contact_principal).toBeNull();
    expect((await principaux(fille)).map((p) => p.id)).toEqual(avant);
  });
});

describe('isolation entre écoles et journal', () => {
  test('l\'autre école ne peut ni voir, ni ajouter, ni modifier, ni retirer', async () => {
    const [premier] = await parentsDe(fille);
    const avant = await parentsDe(fille);
    await avec('post', `/eleves/${fille.user.id}/parents`, tokenB).send({ ...MAMAN, telephone: '77 000 07 55' }).expect(404);
    await avec('put', `/eleves/${fille.user.id}/parents/${premier.id}`, tokenB).send({ lien: 'autre' }).expect(404);
    await avec('delete', `/eleves/${fille.user.id}/parents/${premier.id}`, tokenB).expect(404);
    expect(await parentsDe(fille)).toEqual(avant);
    expect(await compteParTelephone('+221770000755')).toBeUndefined();
  });

  test('journal d\'audit : une entrée par action, sans numéro ni nom', async () => {
    const actions = (await db('journal_audit').whereIn('action', ['parents.ajouter', 'parents.modifier', 'parents.retirer']).select('action', 'details')).map((a) => a.action);
    expect(actions.filter((a) => a === 'parents.ajouter').length).toBeGreaterThanOrEqual(4);
    expect(actions).toContain('parents.modifier');
    expect(actions).toContain('parents.retirer');
    const tout = JSON.stringify(await db('journal_audit').whereIn('action', ['parents.ajouter', 'parents.modifier', 'parents.retirer']).pluck('details'));
    expect(tout).not.toMatch(/7700007|781112233|Sy-Diop|Mariama/);
  });

  test('la fiche élève expose les parents avec leurs droits', async () => {
    const fiche = (await avec('get', `/eleves/${frere.user.id}`, tokenDir).expect(200)).body.data;
    expect(fiche.parents.length).toBeGreaterThan(0);
    expect(fiche.parents[0]).toHaveProperty('peut_voir_bulletins');
    expect(fiche.parents[0]).toHaveProperty('est_contact_principal');
  });
});
