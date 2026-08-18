'use strict';

// ── Mocks de modules (AVANT tout require) ──────────────────────────
jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn(), enqueuerCalculMoyennes: jest.fn(),
  enqueuerGenerationBulletins: jest.fn().mockResolvedValue({ id: 'job-001' }),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerOTP: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');

// ── Chargement des routeurs APRÈS les mocks ────────────────────────
const authRouter      = require('../../src/domains/02-acteurs/auth/auth.routes');
const identitesRouter = require('../../src/domains/01-identites/identites.routes');
const elevesRouter    = require('../../src/domains/02-acteurs/eleves/eleves.routes');
const evaluationsRouter = require('../../src/domains/03-pedagogie/evaluations/evaluations.routes');

// ── Apps de test par domaine ─────────────────────────────────────────
const authApp      = createTestApp(authRouter);
const identitesApp = createTestApp(identitesRouter);
const elevesApp    = createTestApp(elevesRouter);
const evalsApp     = createTestApp(evaluationsRouter);

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW 1 : Inscription établissement
// ═══════════════════════════════════════════════════════════════════

describe('Workflow 1 — POST /etablissements/register', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('crée école + directeur + année scolaire + 7 niveaux et retourne le code officiel', async () => {
    // db.transaction mock : exécute la fonction avec db comme trx
    db.transaction.mockImplementation(async (fn) => {
      const trx = jest.fn();

      // 1. INSERT etablissements
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 2. INSERT annees_scolaires
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 3. INSERT utilisateurs (directeur)
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 4. SELECT roles WHERE code = 'directeur'
      trx.mockReturnValueOnce(mockQuery({ id: 'role-dir-001' }));
      // 5. INSERT utilisateur_roles
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 6. INSERT configs_systeme_notes (onConflict)
      const configChain = mockQuery(undefined);
      configChain.onConflict = jest.fn().mockReturnValue(configChain);
      configChain.ignore = jest.fn().mockReturnValue(configChain);
      trx.mockReturnValueOnce(configChain);
      // 7. INSERT niveaux (7 niveaux par défaut)
      trx.mockReturnValueOnce(mockQuery(undefined));

      await fn(trx);
    });

    const res = await request(authApp)
      .post('/etablissements/register')
      .send({
        nom: 'Lycée Blaise Diagne',
        type: 'lycee',
        pays: 'Sénégal',
        ville: 'Dakar',
        directeur_nom: 'Diallo',
        directeur_prenom: 'Moussa',
        directeur_telephone: '+221771234567',
        directeur_email: 'directeur@lbd.sn',
        directeur_mdp: 'Test1234',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('etablissement');
    expect(res.body.data.etablissement).toHaveProperty('id');
    expect(res.body.data.etablissement).toHaveProperty('code_officiel');
    expect(res.body.data).toHaveProperty('annee_scolaire');
    expect(res.body.data).toHaveProperty('message');
    expect(res.body.data.message).toMatch(/code/i);
  });

  test('retourne 422 si champs obligatoires manquants', async () => {
    const res = await request(authApp)
      .post('/etablissements/register')
      .send({
        nom: 'X', // trop court (min 3)
        ville: 'Dakar',
        directeur_nom: 'Diallo',
        directeur_prenom: 'Moussa',
        directeur_telephone: '+221771234567',
        directeur_mdp: 'Test1234',
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  test('retourne 422 si numéro de téléphone invalide', async () => {
    const res = await request(authApp)
      .post('/etablissements/register')
      .send({
        nom: 'Lycée Test',
        ville: 'Dakar',
        directeur_nom: 'Diallo',
        directeur_prenom: 'Moussa',
        directeur_telephone: 'pas-un-numero',
        directeur_mdp: 'Test1234',
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW 2 : Connexion
// ═══════════════════════════════════════════════════════════════════

describe('Workflow 2 — POST /auth/connexion', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('connexion avec identifiants valides retourne un token JWT', async () => {
    process.env.JWT_SECRET = 'test_secret_32_characters_minimum_ok';

    const mdpHash = await bcrypt.hash('Test1234!', 10);

    // 1. db.raw('SELECT est_compte_bloque(...)') → non bloqué
    db.raw.mockReturnValueOnce({ rows: [{ bloque: false }] });
    // 2. db('etablissements')...first() → établissement trouvé
    db.mockReturnValueOnce(mockQuery({ id: IDS.etablissement, nom: 'Lycée Blaise Diagne' }));
    // 3. db('utilisateurs')...first() → utilisateur trouvé
    db.mockReturnValueOnce(mockQuery({
      id: IDS.utilisateur,
      nom: 'Diallo',
      prenom: 'Moussa',
      mot_de_passe_hash: mdpHash,
      email: 'directeur@lbd.sn',
    }));
    // 4. db('sessions').insert() → session créée
    db.mockReturnValueOnce(mockQuery(undefined));
    // 5. db('utilisateur_roles')...first() → rôle
    db.mockReturnValueOnce(mockQuery({ code: 'directeur', libelle: 'Directeur' }));
    // 6. db('tentatives_connexion').insert() → tentative réussie loggée
    db.mockReturnValueOnce(mockQuery(undefined));

    const res = await request(authApp)
      .post('/auth/connexion')
      .send({
        identifiant: 'directeur@lbd.sn',
        mot_de_passe: 'Test1234!',
        etablissement_code: 'LBD-DAKAR-1234',
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('utilisateur');
    expect(res.body.data.utilisateur).toHaveProperty('nom', 'Diallo');
    expect(res.body.data.utilisateur).toHaveProperty('etablissement_nom', 'Lycée Blaise Diagne');
  });

  test('connexion avec mauvais mot de passe retourne 401', async () => {
    const mdpHash = await bcrypt.hash('BonMotDePasse', 10);

    // 1. db.raw → non bloqué
    db.raw.mockReturnValueOnce({ rows: [{ bloque: false }] });
    // 2. db('etablissements')...first() → établissement
    db.mockReturnValueOnce(mockQuery({ id: IDS.etablissement, nom: 'Lycée Test' }));
    // 3. db('utilisateurs')...first() → utilisateur (avec bon hash)
    db.mockReturnValueOnce(mockQuery({
      id: IDS.utilisateur,
      nom: 'Diallo',
      prenom: 'Moussa',
      mot_de_passe_hash: mdpHash,
      email: 'directeur@lbd.sn',
    }));
    // 4. db('tentatives_connexion').insert() → tentative échouée
    db.mockReturnValueOnce(mockQuery(undefined));

    const res = await request(authApp)
      .post('/auth/connexion')
      .send({
        identifiant: 'directeur@lbd.sn',
        mot_de_passe: 'MauvaisMotDePasse',
        etablissement_code: 'LBD-DAKAR-1234',
      })
      .expect(401);

    expect(res.body.succes).toBe(false);
  });

  test('connexion avec code établissement inconnu retourne 401', async () => {
    // 1. db.raw → non bloqué
    db.raw.mockReturnValueOnce({ rows: [{ bloque: false }] });
    // 2. db('etablissements')...first() → null (établissement inconnu)
    db.mockReturnValueOnce(mockQuery(null));
    // 3. db('tentatives_connexion').insert() → loggé
    db.mockReturnValueOnce(mockQuery(undefined));

    const res = await request(authApp)
      .post('/auth/connexion')
      .send({
        identifiant: 'directeur@lbd.sn',
        mot_de_passe: 'Test1234!',
        etablissement_code: 'CODE-INCONNU',
      })
      .expect(401);

    expect(res.body.succes).toBe(false);
  });

  test('retourne 422 si body incomplet', async () => {
    const res = await request(authApp)
      .post('/auth/connexion')
      .send({ identifiant: 'directeur@lbd.sn' })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW 3 : Création de classe
// ═══════════════════════════════════════════════════════════════════

describe('Workflow 3 — POST /classes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('crée une classe avec niveau_id valide', async () => {
    // 1. db('annees_scolaires')...first() → année courante
    db.mockReturnValueOnce(mockQuery({ id: IDS.annee }));
    // 2. db('niveaux')...first() → niveau trouvé
    db.mockReturnValueOnce(mockQuery({ id: IDS.classe, nom: 'Terminale' }));
    // 3. db('classes').insert()...returning() → classe créée
    db.mockReturnValueOnce(mockQuery([{
      id: IDS.classe,
      nom: 'A',
      niveau_id: IDS.classe,
      annee_scolaire_id: IDS.annee,
      salle_principale: 'Salle 12',
      effectif_max: 45,
    }]));

    const res = await request(identitesApp)
      .post('/classes')
      .send({
        niveau_id: IDS.classe,
        nom: 'A',
        salle_principale: 'Salle 12',
        effectif_max: 45,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('niveau', 'Terminale');
  });

  test('retourne 422 si aucune année scolaire courante', async () => {
    // 1. db('annees_scolaires')...first() → null (pas d'année courante)
    db.mockReturnValueOnce(mockQuery(null));

    const res = await request(identitesApp)
      .post('/classes')
      .send({
        niveau_id: IDS.classe,
        nom: 'B',
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ECHOUEE');
  });

  test('retourne 422 si niveau_id n\'est pas un UUID valide', async () => {
    const res = await request(identitesApp)
      .post('/classes')
      .send({
        niveau_id: 'pas-un-uuid',
        nom: 'A',
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  test('retourne 404 si niveau_id ne correspond à aucun niveau', async () => {
    // 1. db('annees_scolaires')...first() → année trouvée
    db.mockReturnValueOnce(mockQuery({ id: IDS.annee }));
    // 2. db('niveaux')...first() → null (niveau inexistant)
    db.mockReturnValueOnce(mockQuery(null));

    const res = await request(identitesApp)
      .post('/classes')
      .send({
        niveau_id: IDS.evaluation, // UUID valide mais inexistant
        nom: 'A',
      })
      .expect(404);

    expect(res.body.succes).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW 4 : Inscription élève
// ═══════════════════════════════════════════════════════════════════

describe('Workflow 4 — POST /eleves', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('crée l\'élève + inscription avec classe_id valide', async () => {
    db.transaction.mockImplementation(async (fn) => {
      const trx = jest.fn();
      trx.raw = jest.fn().mockReturnValue('NOW()');

      // 1. trx('annees_scolaires')...first() → année courante
      trx.mockReturnValueOnce(mockQuery({ id: IDS.annee }));
      // 2. trx('utilisateurs').insert()
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 3. trx('eleves').insert()...returning('id')
      trx.mockReturnValueOnce(mockQuery([{ id: IDS.eleve }]));
      // 4. trx('roles').where({ code: 'eleve' }).first()
      trx.mockReturnValueOnce(mockQuery({ id: 'role-eleve-001' }));
      // 5. trx('utilisateur_roles').insert()
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 6. trx('inscriptions').insert()
      trx.mockReturnValueOnce(mockQuery(undefined));

      return fn(trx);
    });

    const res = await request(elevesApp)
      .post('/eleves')
      .send({
        nom: 'Traoré',
        prenom: 'Aminata',
        genre: 'F',
        date_naissance: '2008-03-15',
        classe_id: IDS.classe,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
    expect(res.body.data).toHaveProperty('inscription_id');
  });

  test('retourne 422 si classe_id n\'est pas un UUID valide (lien invalide simulé via classe_id)', async () => {
    const res = await request(elevesApp)
      .post('/eleves')
      .send({
        nom: 'Diop',
        prenom: 'Mamadou',
        classe_id: 'pas-un-uuid',
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
    expect(res.body.code).toBe('VALIDATION_ECHOUEE');
  });

  test('retourne 422 si lien parent est invalide', async () => {
    const res = await request(elevesApp)
      .post('/eleves')
      .send({
        nom: 'Ba',
        prenom: 'Mariama',
        classe_id: IDS.classe,
        parent: {
          nom: 'Ba',
          prenom: 'Aissatou',
          telephone: '+221771234567',
          lien: 'voisin', // valeur hors enum
        },
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  test('retourne 422 si aucune année scolaire courante', async () => {
    db.transaction.mockImplementation(async (fn) => {
      const trx = jest.fn();
      // 1. trx('annees_scolaires')...first() → null
      trx.mockReturnValueOnce(mockQuery(null));
      return fn(trx);
    });

    const res = await request(elevesApp)
      .post('/eleves')
      .send({
        nom: 'Sow',
        prenom: 'Ibrahim',
        classe_id: IDS.classe,
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  test('crée l\'élève avec parent optionnel', async () => {
    db.transaction.mockImplementation(async (fn) => {
      const trx = jest.fn();
      trx.raw = jest.fn().mockReturnValue('NOW()');

      // 1. annee_scolaire
      trx.mockReturnValueOnce(mockQuery({ id: IDS.annee }));
      // 2. INSERT utilisateurs (élève)
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 3. INSERT eleves...returning('id')
      trx.mockReturnValueOnce(mockQuery([{ id: IDS.eleve }]));
      // 4. SELECT role 'eleve'
      trx.mockReturnValueOnce(mockQuery({ id: 'role-eleve-001' }));
      // 5. INSERT utilisateur_roles élève
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 6. INSERT inscriptions
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 7. SELECT utilisateurs WHERE telephone (parent existant ?) -> aucun
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 8. INSERT utilisateurs (parent)
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 9. SELECT role 'parent'
      trx.mockReturnValueOnce(mockQuery({ id: 'role-parent-001' }));
      // 10. INSERT utilisateur_roles parent
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 11. INSERT notifications_preferences
      trx.mockReturnValueOnce(mockQuery(undefined));
      // 12. INSERT parents_eleves
      trx.mockReturnValueOnce(mockQuery(undefined));

      return fn(trx);
    });

    const res = await request(elevesApp)
      .post('/eleves')
      .send({
        nom: 'Fall',
        prenom: 'Cheikh',
        classe_id: IDS.classe,
        parent: {
          nom: 'Fall',
          prenom: 'Bineta',
          telephone: '+221771234567',
          lien: 'mere',
        },
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
  });
});

// ═══════════════════════════════════════════════════════════════════
// WORKFLOW 5 : Notes — création évaluation + saisie + publication
// ═══════════════════════════════════════════════════════════════════

describe('Workflow 5 — Notes : POST /evaluations + PUT notes + PUT publier', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── POST /evaluations ──────────────────────────────────────────
  test('POST /evaluations crée une évaluation', async () => {
    db.mockReturnValueOnce(mockQuery([{
      id: IDS.evaluation,
      affectation_id: IDS.affectation,
      periode_id: IDS.periode,
      type: 'devoir',
      numero: 1,
      note_max: 20,
      notes_publiees: false,
    }]));

    const res = await request(evalsApp)
      .post('/evaluations')
      .send({
        affectation_id: IDS.affectation,
        periode_id: IDS.periode,
        type: 'devoir',
        numero: 1,
        note_max: 20,
        date_evaluation: '2025-01-15',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('type', 'devoir');
    expect(res.body.data.notes_publiees).toBe(false);
  });

  test('POST /evaluations retourne 422 si type invalide', async () => {
    const res = await request(evalsApp)
      .post('/evaluations')
      .send({
        affectation_id: IDS.affectation,
        periode_id: IDS.periode,
        type: 'examen_blanc', // type non supporté
        numero: 1,
      })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  // ── PUT /evaluations/:id/notes ────────────────────────────────
  test('PUT /evaluations/:id/notes enregistre les notes en batch', async () => {
    // 1. db('evaluations as ev')...first() → évaluation trouvée et non publiée
    db.mockReturnValueOnce(mockQuery({
      id: IDS.evaluation,
      matiere_id: IDS.matiere,
      classe_id: IDS.classe,
    }));

    // 2. db.transaction — trx('eleves').whereIn(...).select(...) résout
    // utilisateurs.id -> eleves.id (voir evaluations.routes.js) avant le
    // upsert ; sans ce mock, trx('eleves') renvoie undefined et l'appel
    // à .whereIn() plante en 500 (mock resté figé sur l'ancienne implé
    // qui n'interrogeait pas la table eleves).
    db.transaction.mockImplementation(async (fn) => {
      const trx = jest.fn(() => mockQuery([
        { id: 'eeeeeeee-1111-1111-1111-111111111111', utilisateur_id: IDS.eleve },
        { id: 'eeeeeeee-2222-2222-2222-222222222222', utilisateur_id: IDS.utilisateur },
      ]));
      trx.raw = jest.fn().mockResolvedValue(undefined); // UPSERT notes
      await fn(trx);
    });

    const res = await request(evalsApp)
      .put(`/evaluations/${IDS.evaluation}/notes`)
      .send({
        notes: [
          { eleve_id: IDS.eleve, inscription_id: IDS.inscription, valeur: 15.5, est_absent: false },
          { eleve_id: IDS.utilisateur, inscription_id: IDS.affectation, valeur: 12, est_absent: false },
        ],
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.message).toMatch(/2 notes/);
    expect(res.body.data.recalcul_en_cours).toBe(true);
  });

  test('PUT /evaluations/:id/notes retourne 404 si évaluation introuvable', async () => {
    db.mockReturnValueOnce(mockQuery(null));

    const res = await request(evalsApp)
      .put(`/evaluations/${IDS.evaluation}/notes`)
      .send({
        notes: [
          { eleve_id: IDS.eleve, inscription_id: IDS.inscription, valeur: 15, est_absent: false },
        ],
      })
      .expect(404);

    expect(res.body.succes).toBe(false);
  });

  test('PUT /evaluations/:id/notes retourne 422 si tableau notes vide', async () => {
    const res = await request(evalsApp)
      .put(`/evaluations/${IDS.evaluation}/notes`)
      .send({ notes: [] })
      .expect(422);

    expect(res.body.succes).toBe(false);
  });

  // ── PUT /evaluations/:id/publier ─────────────────────────────
  test('PUT /evaluations/:id/publier publie les notes', async () => {
    db.mockReturnValueOnce(mockQuery([{
      id: IDS.evaluation,
      notes_publiees: true,
      updated_at: '2025-01-20T10:00:00Z',
    }]));

    const res = await request(evalsApp)
      .put(`/evaluations/${IDS.evaluation}/publier`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.message).toMatch(/publiées/i);
  });

  test('PUT /evaluations/:id/publier retourne 404 si évaluation inexistante', async () => {
    db.mockReturnValueOnce(mockQuery([])); // returning([]) = pas de résultat

    const res = await request(evalsApp)
      .put(`/evaluations/${IDS.evaluation}/publier`)
      .expect(404);

    expect(res.body.succes).toBe(false);
  });
});
