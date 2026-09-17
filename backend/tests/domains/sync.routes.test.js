'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/infrastructure/storage/storage.service', () => ({
  getUrlSignee: jest.fn().mockResolvedValue('https://minio.local/signed-url'),
  DUREE_URL_SIGNEE_SECONDES: 3600,
}));

// Middleware d'authentification custom : permet de simuler un utilisateur non
// authentifié via l'en-tête `x-test-unauth`, et une session personnalisée via
// `x-test-session` (JSON), tout en restant fidèle au comportement réel
// (ApiError.nonAutorise() -> 401 via error.middleware.js).
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    if (req.headers['x-test-unauth'] === '1') {
      const ApiError = require('../../src/utils/ApiError');
      return next(ApiError.nonAutorise('Token manquant'));
    }
    const { defaultSession } = require('../helpers/testApp');
    const overrides = req.headers['x-test-session'] ? JSON.parse(req.headers['x-test-session']) : {};
    req.session = { ...defaultSession, ...overrides };
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
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');
const { getUrlSignee } = require('../../src/infrastructure/storage/storage.service');

const router = require('../../src/domains/sync.routes');
const app = createTestApp(router);

describe('Sync Routes', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  // ── GET /sync ────────────────────────────────────────────────────
  describe('GET /sync', () => {
    test('rejette une requête non authentifiée (401)', async () => {
      const res = await request(app)
        .get('/sync')
        .set('x-test-unauth', '1')
        .expect(401);

      expect(res.body.succes).toBe(false);
    });

    test('enseignant : renvoie le payload classes/eleves/evaluations/notes/edt', async () => {
      const session = JSON.stringify({ roles: ['enseignant'], utilisateur_id: IDS.enseignant, etablissement_id: IDS.etablissement });

      // 1. Résolution enseignant_id depuis utilisateur_id
      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      // 2-6. Promise.all : classes, eleves, evaluations, notes, edt
      const classesChain     = mockQuery([{ id: IDS.classe, libelle: 'Terminale S1', effectif_max: 45 }]);
      const elevesChain      = mockQuery([{ id: IDS.eleve, nom: 'Traoré', prenom: 'Aminata' }]);
      const evaluationsChain = mockQuery([{ id: IDS.evaluation, type: 'devoir', titre: 'DS1' }]);
      const notesChain       = mockQuery([{ id: 'note-1', evaluation_id: IDS.evaluation, eleve_id: IDS.eleve, valeur: 14 }]);
      const edtChain         = mockQuery([{ id: 'edt-1', jour_semaine: 1, matiere: 'Maths' }]);

      db.mockReturnValueOnce(classesChain)
        .mockReturnValueOnce(elevesChain)
        .mockReturnValueOnce(evaluationsChain)
        .mockReturnValueOnce(notesChain)
        .mockReturnValueOnce(edtChain);

      const depuis = '2025-09-01T06:00:00.000Z';
      const res = await request(app)
        .get(`/sync?depuis=${depuis}`)
        .set('x-test-session', session)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.payload.classes).toHaveLength(1);
      expect(res.body.data.payload.eleves).toHaveLength(1);
      expect(res.body.data.payload.evaluations).toHaveLength(1);
      expect(res.body.data.payload.notes).toHaveLength(1);
      expect(res.body.data.payload.edt).toHaveLength(1);

      // Le delta est bien filtré par la date `depuis` fournie (updated_at/saisie_at > syncDepuis)
      const elevesWhereDates = elevesChain.where.mock.calls.filter(c => c[0] === 'u.updated_at');
      expect(elevesWhereDates).toHaveLength(1);
      expect(elevesWhereDates[0][1]).toBe('>');
      expect(new Date(elevesWhereDates[0][2]).toISOString()).toBe(depuis);
    });

    test('enseignant : sans paramètre depuis, utilise une date epoch (renvoie tout l\'historique)', async () => {
      const session = JSON.stringify({ roles: ['enseignant'], utilisateur_id: IDS.enseignant, etablissement_id: IDS.etablissement });

      db.mockReturnValueOnce(mockQuery({ id: IDS.enseignant }));
      const elevesChain = mockQuery([]);
      db.mockReturnValueOnce(mockQuery([]))
        .mockReturnValueOnce(elevesChain)
        .mockReturnValueOnce(mockQuery([]))
        .mockReturnValueOnce(mockQuery([]))
        .mockReturnValueOnce(mockQuery([]));

      await request(app)
        .get('/sync')
        .set('x-test-session', session)
        .expect(200);

      const elevesWhereDates = elevesChain.where.mock.calls.filter(c => c[0] === 'u.updated_at');
      expect(elevesWhereDates).toHaveLength(1);
      expect(new Date(elevesWhereDates[0][2]).getTime()).toBe(new Date(0).getTime());
    });

    test('parent : renvoie enfants/notes/absences/bulletins/edt avec URL signée fraîche pour chaque bulletin', async () => {
      const session = JSON.stringify({ roles: ['parent'], utilisateur_id: IDS.parent, etablissement_id: IDS.etablissement });

      // Promise.all : enfants, notes, absences, bulletins, edt
      // mockKnex.js n'inclut pas whereNot() dans sa liste de méthodes chaînables
      // par défaut — on l'ajoute manuellement sur la chaîne "absences".
      const absencesChain = mockQuery([]);
      absencesChain.whereNot = jest.fn().mockReturnValue(absencesChain);

      db.mockReturnValueOnce(mockQuery([{ id: IDS.eleve, nom: 'Ba', prenom: 'Mariama' }]))
        .mockReturnValueOnce(mockQuery([]))
        .mockReturnValueOnce(absencesChain)
        .mockReturnValueOnce(mockQuery([{ eleve_id: IDS.eleve, bulletin_key: 'bulletins/etab/periode/b1.pdf', moyenne_generale: 14.2 }]))
        .mockReturnValueOnce(mockQuery([]));

      const res = await request(app)
        .get('/sync')
        .set('x-test-session', session)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.payload.enfants).toHaveLength(1);
      expect(res.body.data.payload.bulletins).toHaveLength(1);
      // Le champ bulletin_key (clé S3 interne) n'est jamais exposé tel quel
      expect(res.body.data.payload.bulletins[0]).not.toHaveProperty('bulletin_key');
      expect(res.body.data.payload.bulletins[0].bulletin_url).toBe('https://minio.local/signed-url');
      expect(getUrlSignee).toHaveBeenCalledWith('bulletins/etab/periode/b1.pdf', 3600);
    });

    test('rôle sans mapping connu (ex: directeur) : payload vide, ni requêtes enseignant ni parent', async () => {
      const session = JSON.stringify({ roles: ['directeur'], utilisateur_id: IDS.utilisateur, etablissement_id: IDS.etablissement });

      const res = await request(app)
        .get('/sync')
        .set('x-test-session', session)
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.payload).toEqual({});
    });
  });

  // ── POST /sync/operations ─────────────────────────────────────────
  describe('POST /sync/operations', () => {
    test('rejette une requête non authentifiée (401)', async () => {
      await request(app)
        .post('/sync/operations')
        .set('x-test-unauth', '1')
        .send({ operations: [{ id: 'op-1', type: 'notes.saisir', payload: {}, cree_at_local: new Date().toISOString() }] })
        .expect(401);
    });

    test('rejette un payload sans opérations (validation Zod)', async () => {
      await request(app)
        .post('/sync/operations')
        .send({ operations: [] })
        .expect(422);
    });

    // mockKnex.js ne fournit pas onConflict()/merge() par défaut (spécifique
    // aux upserts) — cette fabrique ajoute la chaîne nécessaire pour
    // db('notes').insert(...).onConflict([...]).merge([...]).
    function mockInsertAvecUpsert() {
      const insertChain = mockQuery(undefined);
      const mergeFn = jest.fn().mockResolvedValue(undefined);
      insertChain.onConflict = jest.fn().mockReturnValue({ merge: mergeFn });
      insertChain._mergeFn = mergeFn;
      return insertChain;
    }

    test('notes.saisir : résout eleve_id (utilisateurs.id) vers eleves.id puis insère/merge la note', async () => {
      db.mockReturnValueOnce(mockQuery({ id: IDS.eleve })); // eleves.where(...).first('id')
      const insertChain = mockInsertAvecUpsert();
      db.mockReturnValueOnce(insertChain);

      const op = {
        id: '11111111-aaaa-bbbb-cccc-111111111111',
        type: 'notes.saisir',
        payload: { evaluation_id: IDS.evaluation, eleve_id: IDS.utilisateur, inscription_id: IDS.inscription, valeur: 15, est_absent: false, absence_justifiee: null },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app)
        .post('/sync/operations')
        .send({ operations: [op] })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.resultats).toEqual([{ op_id: op.id, statut: 'ok' }]);
      expect(insertChain.onConflict).toHaveBeenCalledWith(['evaluation_id', 'eleve_id']);
      expect(insertChain._mergeFn).toHaveBeenCalled();
    });

    test('notes.saisir : élève introuvable renvoie un échec partiel ELEVE_INTROUVABLE sans planter la requête', async () => {
      db.mockReturnValueOnce(mockQuery(undefined)); // eleves introuvable

      const op = {
        id: '22222222-aaaa-bbbb-cccc-222222222222',
        type: 'notes.saisir',
        payload: { evaluation_id: IDS.evaluation, eleve_id: 'inconnu-uuid-0000-0000-000000000000', inscription_id: IDS.inscription, valeur: 10 },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app)
        .post('/sync/operations')
        .send({ operations: [op] })
        .expect(200);

      expect(res.body.succes).toBe(true);
      expect(res.body.data.resultats).toEqual([{ op_id: op.id, statut: 'erreur', code: 'ELEVE_INTROUVABLE' }]);
    });

    test('notes.saisir envoyée deux fois avec le même id (rejeu) : idempotent grâce à onConflict/merge, pas d\'erreur ni de doublon', async () => {
      const op = {
        id: '33333333-aaaa-bbbb-cccc-333333333333',
        type: 'notes.saisir',
        payload: { evaluation_id: IDS.evaluation, eleve_id: IDS.utilisateur, inscription_id: IDS.inscription, valeur: 12 },
        cree_at_local: new Date().toISOString(),
      };

      // Premier envoi
      db.mockReturnValueOnce(mockQuery({ id: IDS.eleve }));
      db.mockReturnValueOnce(mockInsertAvecUpsert());
      const res1 = await request(app).post('/sync/operations').send({ operations: [op] }).expect(200);
      expect(res1.body.data.resultats).toEqual([{ op_id: op.id, statut: 'ok' }]);

      // Rejeu du même op_id (ex: retry mobile après timeout réseau) — nouvelle requête HTTP,
      // le serveur ne conserve pas d'état d'opérations déjà traitées (pas de journal des op_id) ;
      // c'est l'UPSERT (onConflict sur evaluation_id+eleve_id) qui rend le rejeu sans effet de bord.
      db.mockReturnValueOnce(mockQuery({ id: IDS.eleve }));
      db.mockReturnValueOnce(mockInsertAvecUpsert());
      const res2 = await request(app).post('/sync/operations').send({ operations: [op] }).expect(200);
      expect(res2.body.data.resultats).toEqual([{ op_id: op.id, statut: 'ok' }]);
    });

    test('presences.saisir : appel ouvert -> met à jour le statut de présence', async () => {
      db.mockReturnValueOnce(mockQuery({ id: 'appel-1' })); // appels ouvert trouvé
      const updateChain = mockQuery(1);
      db.mockReturnValueOnce(updateChain);

      const op = {
        id: '44444444-aaaa-bbbb-cccc-444444444444',
        type: 'presences.saisir',
        payload: { appel_id: 'appel-1', inscription_id: IDS.inscription, statut: 'absent', minutes_retard: 0 },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app).post('/sync/operations').send({ operations: [op] }).expect(200);

      expect(res.body.data.resultats).toEqual([{ op_id: op.id, statut: 'ok' }]);
      expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({ statut: 'absent' }));
    });

    test('presences.saisir : appel clôturé ou introuvable -> échec APPEL_CLOTURE', async () => {
      db.mockReturnValueOnce(mockQuery(undefined)); // appel non trouvé (clôturé ou inexistant)

      const op = {
        id: '55555555-aaaa-bbbb-cccc-555555555555',
        type: 'presences.saisir',
        payload: { appel_id: 'appel-clos', inscription_id: IDS.inscription, statut: 'present' },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app).post('/sync/operations').send({ operations: [op] }).expect(200);

      expect(res.body.data.resultats).toEqual([{ op_id: op.id, statut: 'erreur', code: 'APPEL_CLOTURE' }]);
    });

    test('type d\'opération inconnu -> échec TYPE_INCONNU', async () => {
      const op = {
        id: '66666666-aaaa-bbbb-cccc-666666666666',
        type: 'type.jamais.gere',
        payload: {},
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app).post('/sync/operations').send({ operations: [op] }).expect(200);

      expect(res.body.data.resultats).toEqual([
        { op_id: op.id, statut: 'erreur', code: 'TYPE_INCONNU', detail: 'Type type.jamais.gere non géré' },
      ]);
    });

    test('erreur serveur inattendue sur une opération -> ERREUR_SERVEUR, sans faire échouer les autres opérations du lot', async () => {
      // op1 : notes.saisir qui plante à l'insert
      db.mockReturnValueOnce(mockQuery({ id: IDS.eleve }));
      const failingInsert = mockQuery(undefined);
      failingInsert.onConflict = jest.fn().mockReturnValue({ merge: jest.fn().mockRejectedValue(new Error('DB down')) });
      db.mockReturnValueOnce(failingInsert);
      // op2 : presences.saisir qui réussit
      db.mockReturnValueOnce(mockQuery({ id: 'appel-2' }));
      db.mockReturnValueOnce(mockQuery(1));

      const op1 = {
        id: '77777777-aaaa-bbbb-cccc-777777777777',
        type: 'notes.saisir',
        payload: { evaluation_id: IDS.evaluation, eleve_id: IDS.utilisateur, inscription_id: IDS.inscription, valeur: 8 },
        cree_at_local: new Date().toISOString(),
      };
      const op2 = {
        id: '88888888-aaaa-bbbb-cccc-888888888888',
        type: 'presences.saisir',
        payload: { appel_id: 'appel-2', inscription_id: IDS.inscription, statut: 'present' },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app).post('/sync/operations').send({ operations: [op1, op2] }).expect(200);

      expect(res.body.data.resultats).toEqual([
        { op_id: op1.id, statut: 'erreur', code: 'ERREUR_SERVEUR', detail: 'DB down' },
        { op_id: op2.id, statut: 'ok' },
      ]);
    });

    // Constat de sécurité (audit 2026-09) : le code actuel de POST /sync/operations
    // ne vérifie à AUCUN moment que les entités référencées dans op.payload
    // (eleve_id, appel_id, inscription_id...) appartiennent bien à
    // req.etablissement_id — contrairement à ce qui a été corrigé sur les
    // routes bulletins (lots C/D). Ce test documente le comportement RÉEL
    // observé (l'opération est traitée sans filtre d'établissement), afin de
    // matérialiser ce risque potentiel d'IDOR inter-établissements pour un
    // futur lot de correction — il n'est PAS du périmètre du lot J de le
    // corriger. Voir rapport final de l'agent pour l'escalade.
    test('constat : une opération référençant un appel d\'un autre établissement n\'est pas filtrée par etablissement_id', async () => {
      const sessionEtabA = JSON.stringify({ roles: ['enseignant'], utilisateur_id: IDS.enseignant, etablissement_id: IDS.etablissement });

      db.mockReturnValueOnce(mockQuery({ id: 'appel-etab-B' })); // aucun filtre etablissement_id observé dans la requête
      const updateChain = mockQuery(1);
      db.mockReturnValueOnce(updateChain);

      const op = {
        id: '99999999-aaaa-bbbb-cccc-999999999999',
        type: 'presences.saisir',
        payload: { appel_id: 'appel-etab-B', inscription_id: IDS.inscription, statut: 'absent' },
        cree_at_local: new Date().toISOString(),
      };

      const res = await request(app)
        .post('/sync/operations')
        .set('x-test-session', sessionEtabA)
        .send({ operations: [op] })
        .expect(200);

      // Comportement actuel : traité comme un succès, aucune vérification d'appartenance.
      expect(res.body.data.resultats).toEqual([{ op_id: op.id, statut: 'ok' }]);
    });
  });
});
