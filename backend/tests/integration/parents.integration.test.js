'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenParent, tokenDir;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);

  // Créer un utilisateur parent lié à l'élève[0]
  const db = getTestDB();
  const bcrypt = require('bcryptjs');
  const mdpHash = await bcrypt.hash('Test1234!', 10);

  const [parentUser] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id,
    nom: 'Traoré',
    prenom: 'Kadiatou',
    telephone: '+221770000050',
    mot_de_passe_hash: mdpHash,
    actif: true,
  }).returning('*');

  const roleParent = await db('roles').where({ code: 'parent' }).first();
  await db('utilisateur_roles').insert({
    utilisateur_id: parentUser.id,
    role_id: roleParent.id,
    etablissement_id: seed.etablissement.id,
    actif: true,
  });

  // Lier le parent à l'élève[0]
  await db('parents_eleves').insert({
    parent_id: parentUser.id,
    eleve_id:  seed.eleves[0].eleve.id,
    lien:      'mere',
    peut_voir_notes: true,
    peut_voir_absences: true,
    est_contact_principal: true,
  });

  tokenParent = await creerSession(parentUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /parents/moi/enfants ───────────────────────────────────

describe('GET /api/v1/parents/moi/enfants', () => {
  it('devrait retourner les enfants du parent connecté', async () => {
    const res = await request
      .get('/api/v1/parents/moi/enfants')
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nom).toBe('Traoré');
  });

  it('devrait retourner liste vide si parent sans enfants liés', async () => {
    const db = getTestDB();
    const bcrypt = require('bcryptjs');
    const [u] = await db('utilisateurs').insert({
      etablissement_id: seed.etablissement.id,
      nom: 'Sans',
      prenom: 'Enfant',
      telephone: '+221770000051',
      mot_de_passe_hash: await bcrypt.hash('Test1234!', 10),
      actif: true,
    }).returning('*');
    const roleParent = await db('roles').where({ code: 'parent' }).first();
    await db('utilisateur_roles').insert({
      utilisateur_id: u.id, role_id: roleParent.id,
      etablissement_id: seed.etablissement.id, actif: true,
    });
    // parents_eleves.parent_id references utilisateurs.id directly (no separate parents table)
    const tok = await creerSession(u.id, seed.etablissement.id);

    const res = await request
      .get('/api/v1/parents/moi/enfants')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(res.body.data.length).toBe(0);
  });
});

// ── GET /parents/moi/tableau-de-bord ──────────────────────────

describe('GET /api/v1/parents/moi/tableau-de-bord', () => {
  it('devrait retourner le tableau de bord du parent', async () => {
    const res = await request
      .get('/api/v1/parents/moi/tableau-de-bord')
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ── GET /parents/moi/enfants/:id/absences ─────────────────────

describe('GET /api/v1/parents/moi/enfants/:id/absences', () => {
  it('devrait retourner les absences de l\'enfant', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/parents/moi/enfants/${eleveId}/absences`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait refuser l\'accès à un élève non lié au parent', async () => {
    const autreEleveId = seed.eleves[1].user.id; // non lié à ce parent

    await request
      .get(`/api/v1/parents/moi/enfants/${autreEleveId}/absences`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect((r) => {
        // 403 Forbidden ou 404 selon l'implémentation
        expect([403, 404]).toContain(r.status);
      });
  });
});
