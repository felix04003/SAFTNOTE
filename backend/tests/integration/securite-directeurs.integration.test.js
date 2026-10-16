'use strict';

// Base PostgreSQL réelle : nomination d'un second directeur (porte de sortie du garde-fou « dernier directeur »)

const supertest = require('supertest');
const { getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession } = require('./helpers');

let db, request, seed, tokenD1, tokenAdmin;
const poster = (token, corps) => request.post('/api/v1/securite/directeurs').set('Authorization', `Bearer ${token}`).send(corps);
const base = { nom: 'Ndiaye', prenom: 'Mariama', telephone: '77 000 05 01' };

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  await db.raw("SELECT affecter_permissions('admin', ARRAY['admin.utilisateurs','admin.audit'])");
  tokenD1 = await creerSession(seed.directeur.id, seed.etablissement.id);
  const [u] = await db('utilisateurs').insert({ etablissement_id: seed.etablissement.id, nom: 'Gestion', prenom: 'admin', telephone: '+221770000499', actif: true }).returning('*');
  const r = await db('roles').where({ code: 'admin' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: u.id, role_id: r.id, etablissement_id: seed.etablissement.id, actif: true });
  tokenAdmin = await creerSession(u.id, seed.etablissement.id);
});
afterAll(async () => { await closeTestDB(); });

describe('POST /securite/directeurs', () => {
  test('un porteur de la permission qui n\'est pas directeur est refusé', async () => {
    await poster(tokenAdmin, base).expect(403);
    expect(await db('utilisateurs').where({ telephone: '+221770000501' }).first()).toBeUndefined();
  });

  test('le directeur crée un second directeur : rôle, mot de passe à changer, audit, numéro E.164', async () => {
    const res = await poster(tokenD1, base).expect(201);
    expect(res.body.data.sms_envoye).toBe(false);                        // pas de clé SMS en test : le mot de passe est rendu
    expect(res.body.data.message).toMatch(/Mot de passe provisoire/);

    const u = await db('utilisateurs').where({ id: res.body.data.utilisateur_id }).first();
    expect(u).toMatchObject({ telephone: '+221770000501', mdp_a_changer: true, actif: true, etablissement_id: seed.etablissement.id });
    const role = await db('utilisateur_roles as ur').join('roles as r', 'r.id', 'ur.role_id').where({ 'ur.utilisateur_id': u.id }).first('r.code');
    expect(role.code).toBe('directeur');
    const audit = await db('journal_audit').where({ action: 'utilisateurs.creer_directeur', enregistrement_id: u.id }).first();
    expect(audit.utilisateur_id).toBe(seed.directeur.id);
  });

  test('doublon de téléphone refusé ; email déjà pris refusé', async () => {
    await poster(tokenD1, base).expect(422);
    await poster(tokenD1, { ...base, telephone: '77 000 05 02', email: 'x@ecole.sn' }).expect(201);
    await poster(tokenD1, { ...base, telephone: '77 000 05 03', email: 'x@ecole.sn' }).expect(422);
  });

  test('le garde-fou est levé : avec deux directeurs, le premier peut quitter', async () => {
    const tokenD1b = await creerSession(seed.directeur.id, seed.etablissement.id).catch(() => tokenD1);
    await request.delete('/api/v1/utilisateurs/moi').set('Authorization', `Bearer ${tokenD1b}`).expect(200);
  });
});
