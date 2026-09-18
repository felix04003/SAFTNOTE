'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenParent;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();

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
    expect(res.body.data).toHaveProperty('recapitulatif');
    expect(res.body.data).toHaveProperty('detail');
    expect(Array.isArray(res.body.data.detail)).toBe(true);
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

// ── Lot C (finding C4) — bulletins.voir retirée du rôle parent ───
//
// Un parent ne doit plus jamais pouvoir passer par les routes
// génériques /bulletins* (non filtrées par parents_eleves — IDOR).
// Il doit continuer à accéder aux bulletins de SES enfants via
// /parents/moi/enfants/:id/bulletins (filtré par verifierLienParentEnfant).

describe('GET /api/v1/bulletins (accès parent — doit être refusé)', () => {
  it('devrait refuser un parent sans la permission bulletins.voir', async () => {
    const res = await request
      .get('/api/v1/bulletins')
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);

    expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
  });
});

describe('GET /api/v1/bulletins/:id (accès parent — doit être refusé)', () => {
  it('devrait refuser un parent même pour le bulletin de son propre enfant', async () => {
    // La permission manque avant même la résolution de :id — peu importe
    // à qui appartient le bulletin, l'accès générique doit être coupé.
    const res = await request
      .get(`/api/v1/bulletins/${seed.eleves[0].eleve.id}`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);

    expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
  });

  it('devrait refuser un parent pour le bulletin d\'un élève qui n\'est pas son enfant', async () => {
    const res = await request
      .get(`/api/v1/bulletins/${seed.eleves[1].eleve.id}`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);

    expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
  });
});

describe('GET /api/v1/bulletins/:id/download (accès parent — doit être refusé)', () => {
  it('devrait refuser un parent, même pour un bulletin qui n\'est pas celui d\'un de ses enfants', async () => {
    const res = await request
      .get(`/api/v1/bulletins/${seed.eleves[1].eleve.id}/download`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);

    expect(res.body.code).toBe('PERMISSION_INSUFFISANTE');
  });
});

// ── Non-régression : la route dédiée continue de fonctionner ─────

describe('GET /api/v1/parents/moi/enfants/:id/bulletins (non-régression)', () => {
  it('devrait retourner 200 pour son propre enfant, sans dépendre de bulletins.voir', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/parents/moi/enfants/${eleveId}/bulletins`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('bulletins');
    expect(Array.isArray(res.body.data.bulletins)).toBe(true);
  });

  it('devrait refuser l\'accès aux bulletins d\'un élève non lié au parent', async () => {
    const autreEleveId = seed.eleves[1].user.id;

    await request
      .get(`/api/v1/parents/moi/enfants/${autreEleveId}/bulletins`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);
  });
});

// ── Audit 2026-09, finding 2 — GET /moyennes/eleve/:eleve_id ─────
//
// Cette route était gardée par exigerPermission('notes.voir_eleve')
// seul, sans vérifier que l'appelant est autorisé pour CET élève
// précis (IDOR). Corrigé avec autoriserAccesEleve('notes.voir_eleve'),
// même pattern que /parents/moi/enfants/:id/notes et /absences.

describe('GET /api/v1/moyennes/eleve/:eleve_id (accès parent)', () => {
  it('devrait refuser un parent pour un élève qui n\'est pas son enfant', async () => {
    const autreEleveId = seed.eleves[1].user.id; // non lié à ce parent

    await request
      .get(`/api/v1/moyennes/eleve/${autreEleveId}`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(403);
  });

  it('devrait autoriser un parent pour son propre enfant', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/moyennes/eleve/${eleveId}`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});
