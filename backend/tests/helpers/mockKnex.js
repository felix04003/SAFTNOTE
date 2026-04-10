'use strict';

/**
 * Crée une chaîne Knex mockée qui se résout à `result` quand elle est awaited.
 * Tous les méthodes chaînables (where, join, select, first…) retournent la chaîne.
 * La chaîne est thenable : `await db('table').where({}).first()` → result.
 *
 * @param {*} result - Le résultat retourné quand la chaîne est awaited
 * @param {*} [cloneResult] - Résultat pour query.clone().count() (optionnel)
 * @returns {object} chaîne Knex mockée
 */
function mockQuery(result, cloneResult) {
  const chain = {};

  const methods = [
    'where', 'andWhere', 'orWhere', 'orWhereNull',
    'whereNull', 'whereNotNull', 'whereNot', 'whereIn', 'whereRaw',
    'join', 'leftJoin', 'rightJoin',
    'on', 'andOn', 'orOn',
    'orderBy', 'groupBy', 'having',
    'limit', 'offset', 'distinct',
    'select', 'first', 'count', 'sum', 'avg', 'min', 'max',
    'insert', 'update', 'del', 'delete',
    'returning', 'pluck',
    'clearSelect', 'clearOrder',
  ];

  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }

  // clone() retourne une NOUVELLE chaîne résolvant à cloneResult
  // Supporte le pattern : const [{ count }] = await query.clone().count('id as count');
  if (cloneResult !== undefined) {
    chain.clone = jest.fn().mockReturnValue(mockQuery(cloneResult));
  } else {
    chain.clone = jest.fn().mockReturnValue(chain);
  }

  // Rend la chaîne thenable (permet await)
  chain.then = (resolve) => resolve(result);
  chain.catch = () => ({ then: chain.then });

  return chain;
}

/**
 * Crée un mock complet de l'instance Knex retournée par getDB().
 *
 * @returns {jest.Mock} mock Knex
 */
function createMockDB() {
  const db = jest.fn(() => mockQuery([]));

  // db.raw() — utilisé pour NOW(), CONCAT(), verifier_permission(), etc.
  db.raw = jest.fn().mockImplementation((sql) => {
    if (typeof sql === 'string' && !sql.includes('SELECT')) {
      return sql;
    }
    return { rows: [{ autorise: true }] };
  });

  // db.transaction(async trx => { ... })
  db.transaction = jest.fn(async (fn) => fn(db));

  return db;
}

/**
 * Fixtures d'UUIDs réutilisables dans tous les tests.
 */
const IDS = {
  etablissement:    '11111111-1111-1111-1111-111111111111',
  utilisateur:      '22222222-2222-2222-2222-222222222222',
  enseignant:       '33333333-3333-3333-3333-333333333333',
  eleve:            '44444444-4444-4444-4444-444444444444',
  parent:           '55555555-5555-5555-5555-555555555555',
  classe:           '66666666-6666-6666-6666-666666666666',
  annee:            '77777777-7777-7777-7777-777777777777',
  session:          '88888888-8888-8888-8888-888888888888',
  matiere:          '99999999-9999-9999-9999-999999999999',
  affectation:      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  inscription:      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  periode:          'cccccccc-cccc-cccc-cccc-cccccccccccc',
  evaluation:       'dddddddd-dddd-dddd-dddd-dddddddddddd',
  autreUtilisateur: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  plage:            'ffffffff-ffff-ffff-ffff-ffffffffffff',
  conversation:     '00000000-0000-4000-a000-000000000055',
  enseignantRow:    '00000000-0000-4000-a000-000000000033',
};

module.exports = { mockQuery, createMockDB, IDS };
