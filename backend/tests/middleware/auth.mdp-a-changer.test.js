'use strict';

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  getRedis: jest.fn(() => { throw new Error('Redis indisponible'); }),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_min_ok';

const jwt = require('jsonwebtoken');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');
const {
  authentifier, routeAutoriseeAvecMdpAChanger,
} = require('../../src/middleware/auth.middleware');

function requete(url) {
  const token = jwt.sign({ sub: 'u1' }, process.env.JWT_SECRET, { expiresIn: '5m' });
  return { headers: { authorization: `Bearer ${token}` }, originalUrl: url, url };
}

async function appeler(url, mdpAChanger) {
  const db = createMockDB();
  getDB.mockReturnValue(db);
  db.mockReturnValueOnce(mockQuery({ id: 's1', utilisateur_id: 'u1', etablissement_id: 'e1' })); // session
  db.mockReturnValueOnce(mockQuery({ id: 'u1', nom: 'Cisse', prenom: 'Mame', mdp_a_changer: mdpAChanger })); // utilisateur
  db.mockReturnValueOnce(mockQuery([{ code: 'enseignant' }])); // rôles
  db.mockReturnValueOnce(mockQuery(1));                        // UPDATE derniere_activite
  const req = requete(url);
  const next = jest.fn();
  await authentifier(req, {}, next);
  return { req, err: next.mock.calls[0][0] };
}

describe('authentifier — mot de passe provisoire (mdp_a_changer)', () => {
  test('drapeau levé : une route métier est refusée en 403 MDP_CHANGEMENT_REQUIS', async () => {
    const { err } = await appeler('/api/v1/enseignants/moi/classes', true);
    expect(err).toMatchObject({ statusCode: 403, code: 'MDP_CHANGEMENT_REQUIS' });
  });

  test.each([
    '/api/v1/auth/changer-mot-de-passe',
    '/api/v1/auth/profil',
    '/api/v1/auth/profil?x=1',
    '/api/v1/auth/deconnexion',
  ])('drapeau levé : %s reste accessible', async (url) => {
    const { err, req } = await appeler(url, true);
    expect(err).toBeUndefined();
    expect(req.session.mdp_a_changer).toBe(true);
  });

  test('drapeau levé : une route qui ressemble à une route autorisée est refusée', async () => {
    const { err } = await appeler('/api/v1/eleves?q=/auth/profil', true);
    expect(err).toMatchObject({ code: 'MDP_CHANGEMENT_REQUIS' });
  });

  test('drapeau baissé : aucune restriction', async () => {
    const { err } = await appeler('/api/v1/enseignants/moi/classes', false);
    expect(err).toBeUndefined();
  });
});

describe('routeAutoriseeAvecMdpAChanger', () => {
  test.each([
    ['/api/v1/auth/profil/', true],
    ['/api/v1/auth/sessions', false],
    ['/api/v1/sync', false],
  ])('%s → %s', (url, attendu) => {
    expect(routeAutoriseeAvecMdpAChanger({ originalUrl: url })).toBe(attendu);
  });
});
