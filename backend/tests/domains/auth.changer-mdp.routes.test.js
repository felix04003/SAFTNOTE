'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(),
  getRedis: jest.fn(),
  getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(),
  healthCheck: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');

const { getDB }   = require('../../src/infrastructure/database/pool');
const { getRedis } = require('../../src/infrastructure/cache/redis');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');
const { createTestApp, defaultSession } = require('../helpers/testApp');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_min_ok';

const router = require('../../src/domains/02-acteurs/auth/auth.routes');
const app = createTestApp(router);

const ACTUEL  = 'Provisoire-Ab12';
const NOUVEAU = 'Nouveau-Mdp-77';

describe('POST /auth/changer-mot-de-passe', () => {
  let db, redisDel, hash, utilisateur;

  beforeAll(async () => { hash = await bcrypt.hash(ACTUEL, 4); });

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    redisDel = jest.fn().mockResolvedValue(1);
    getRedis.mockReturnValue({ del: redisDel });
    utilisateur = {
      id: defaultSession.utilisateur_id, nom: 'Cisse', prenom: 'Mame',
      email: null, telephone: '+221779990001', mot_de_passe_hash: hash,
    };
  });

  const envoyer = (corps) => request(app)
    .post('/auth/changer-mot-de-passe')
    .set('Authorization', 'Bearer jeton-de-test')
    .send(corps);

  test('changement réussi : hash mis à jour, drapeau levé, autres sessions révoquées, caches purgés', async () => {
    const majUtilisateur = mockQuery(1);
    const majSessions = mockQuery(1);
    db.mockReturnValueOnce(mockQuery(utilisateur));                 // SELECT utilisateur
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 8 }));     // politique_securite
    db.mockReturnValueOnce(mockQuery([{ id: 's2', token_hash: 'hash_s2' }])); // autres sessions
    db.mockReturnValueOnce(majUtilisateur);                         // UPDATE utilisateurs
    db.mockReturnValueOnce(majSessions);                            // UPDATE sessions

    const res = await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: NOUVEAU }).expect(200);

    expect(res.body.data.sessions_fermees).toBe(1);
    const maj = majUtilisateur.update.mock.calls[0][0];
    expect(maj.mdp_a_changer).toBe(false);
    expect(await bcrypt.compare(NOUVEAU, maj.mot_de_passe_hash)).toBe(true);
    expect(majSessions.update).toHaveBeenCalledWith(expect.objectContaining({ revoquee: true, motif_revocation: 'changement_mot_de_passe' }));
    expect(redisDel).toHaveBeenCalledWith('sess:hash_s2');
    expect(redisDel).toHaveBeenCalledWith(`profil:${defaultSession.utilisateur_id}`);
    expect(redisDel.mock.calls.some(([k]) => /^sess:[0-9a-f]{64}$/.test(k))).toBe(true); // session courante
  });

  test('mot de passe actuel incorrect → 401, rien n\'est modifié', async () => {
    db.mockReturnValueOnce(mockQuery(utilisateur));
    const res = await envoyer({ mot_de_passe_actuel: 'Faux-Mdp-123', nouveau_mot_de_passe: NOUVEAU }).expect(401);
    expect(res.body.erreur).toMatch(/actuel incorrect/);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  test('nouveau = actuel → 422', async () => {
    db.mockReturnValueOnce(mockQuery(utilisateur));
    const res = await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: ACTUEL }).expect(422);
    expect(res.body.erreur).toMatch(/différent/);
  });

  test('nouveau mot de passe faible → 422 (schéma, avant tout accès base)', async () => {
    await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: 'abc' }).expect(422);
    expect(db).not.toHaveBeenCalled();
  });

  test('nouveau mot de passe qui reprend le téléphone → 422', async () => {
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 8 }));
    const res = await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: 'Aa779990001' }).expect(422);
    expect(res.body.erreur).toMatch(/ne doit pas reprendre/);
  });

  test('la politique de l\'établissement peut durcir la longueur → 422', async () => {
    db.mockReturnValueOnce(mockQuery(utilisateur));
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 16 }));
    const res = await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: NOUVEAU }).expect(422);
    expect(res.body.erreur).toMatch(/au moins 16 caractères/);
  });

  test('compte sans mot de passe (parent, OTP) → 403', async () => {
    db.mockReturnValueOnce(mockQuery({ ...utilisateur, mot_de_passe_hash: null }));
    await envoyer({ mot_de_passe_actuel: ACTUEL, nouveau_mot_de_passe: NOUVEAU }).expect(403);
  });

  test('corps incomplet → 422', async () => {
    await envoyer({ nouveau_mot_de_passe: NOUVEAU }).expect(422);
  });
});
