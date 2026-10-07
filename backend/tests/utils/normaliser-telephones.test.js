'use strict';

const { normaliserTelephones } = require('../../src/utils/normaliser-telephones');

function fakePool(rows) {
  const query = jest.fn().mockImplementation(async (sql) => (/^\s*SELECT/i.test(sql) ? { rows } : { rows: [] }));
  return { query };
}
const log = jest.fn();

describe('normaliserTelephones', () => {
  beforeEach(() => jest.clearAllMocks());

  test('simulation : calcule les changements sans rien écrire', async () => {
    const pool = fakePool([
      { id: 'u1', telephone: '772220003', telephone_2: null, pays: 'SN' },
      { id: 'u2', telephone: '+221771110001', telephone_2: null, pays: 'SN' },
    ]);
    const res = await normaliserTelephones(pool, { log });
    expect(res).toMatchObject({ modifies: 1, inchanges: 1, invalides: [], conflits: [] });
    expect(pool.query).toHaveBeenCalledTimes(1); // SELECT seul
  });

  test('--appliquer : UPDATE paramétré avec le numéro E.164', async () => {
    const pool = fakePool([{ id: 'u1', telephone: '+221 77 222 00 02', telephone_2: '77 111 22 33', pays: 'SN' }]);
    await normaliserTelephones(pool, { appliquer: true, log });
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE utilisateurs SET telephone = \$2, telephone_2 = \$3 WHERE id = \$1/);
    expect(params).toEqual(['u1', '+221772220002', '+221771112233']);
  });

  test('numéro inexploitable : listé, jamais modifié', async () => {
    const pool = fakePool([{ id: 'u1', telephone: 'abc', telephone_2: null, pays: 'SN' }]);
    const res = await normaliserTelephones(pool, { appliquer: true, log });
    expect(res.invalides).toEqual([{ id: 'u1', colonne: 'telephone', valeur: 'abc' }]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('conflit avec un numéro déjà pris : listé, ignoré', async () => {
    const pool = fakePool([
      { id: 'u1', telephone: '+221772220003', telephone_2: null, pays: 'SN' },
      { id: 'u2', telephone: '772220003', telephone_2: null, pays: 'SN' },
    ]);
    const res = await normaliserTelephones(pool, { appliquer: true, log });
    expect(res.conflits).toEqual([{ id: 'u2', valeur: '772220003', normalise: '+221772220003' }]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('le même numéro dans DEUX établissements n\'est pas un conflit (unicité par école, migration 024)', async () => {
    const pool = fakePool([
      { id: 'u1', etablissement_id: 'ecole-A', telephone: '+221772220003', telephone_2: null, pays: 'SN' },
      { id: 'u2', etablissement_id: 'ecole-B', telephone: '772220003', telephone_2: null, pays: 'SN' },
    ]);
    const res = await normaliserTelephones(pool, { appliquer: true, log });
    expect(res.conflits).toEqual([]);
    expect(res.modifies).toBe(1);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(/UPDATE utilisateurs SET telephone = \$2 WHERE id = \$1/);
    expect(params).toEqual(['u2', '+221772220003']);
  });

  test('dans le MÊME établissement, le conflit est toujours détecté', async () => {
    const pool = fakePool([
      { id: 'u1', etablissement_id: 'ecole-A', telephone: '+221772220003', telephone_2: null, pays: 'SN' },
      { id: 'u2', etablissement_id: 'ecole-A', telephone: '772220003', telephone_2: null, pays: 'SN' },
    ]);
    const res = await normaliserTelephones(pool, { appliquer: false, log });
    expect(res.conflits).toHaveLength(1);
  });
});
