'use strict';

/**
 * Tests de l'injecteur de seeds de test (src/utils/seed-test.js).
 * `pg` et `fs` sont mockés : aucune base n'est touchée.
 */

jest.mock('pg', () => ({ Pool: jest.fn() }));

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { run, resoudreSeedsDir } = require('../../src/utils/seed-test');

/**
 * Construit un pool pg simulé. `echouerSur` déclenche une erreur sur le SQL donné.
 */
function creerPool(echouerSur = null) {
  const client = {
    query: jest.fn(async (text) => {
      if (echouerSur && text.includes(echouerSur)) throw new Error('erreur SQL simulée');
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(async () => ({ rows: [] })),
    connect: jest.fn(async () => client),
    end: jest.fn(async () => {}),
    client,
  };

  Pool.mockImplementation(() => pool);
  return pool;
}

const ENV_INITIAL = { ...process.env };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.NODE_ENV  = 'test';
  process.env.SEEDS_DIR = '/faux/seeds';
});

afterEach(() => {
  process.env = { ...ENV_INITIAL };
});

// ── Garde-fou production ────────────────────────────────────────

describe('garde-fou production', () => {
  test('refuse de tourner avec NODE_ENV=production', async () => {
    process.env.NODE_ENV = 'production';
    const pool = creerPool();

    await expect(run()).rejects.toThrow(/production/);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(Pool).not.toHaveBeenCalled();
  });
});

// ── resoudreSeedsDir ────────────────────────────────────────────

describe('resoudreSeedsDir', () => {
  test('retourne SEEDS_DIR quand la variable est définie', () => {
    process.env.SEEDS_DIR = '/chemin/impose';
    expect(resoudreSeedsDir()).toBe('/chemin/impose');
  });

  test('retourne <backend>/tests/seeds par défaut', () => {
    delete process.env.SEEDS_DIR;
    const attendu = path.resolve(__dirname, '../../src/utils', '../../tests/seeds');
    expect(resoudreSeedsDir()).toBe(attendu);
  });
});

// ── run ─────────────────────────────────────────────────────────

describe('run', () => {
  test('applique les seeds triés, un par transaction', async () => {
    const pool = creerPool();

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['02_b.sql', '01_a.sql', 'README.md']);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- seed ${path.basename(p)}`);

    expect(await run()).toBe(2);

    const commandes = pool.client.query.mock.calls.map(([text]) => text);
    expect(commandes).toEqual([
      'BEGIN', '-- seed 01_a.sql', 'COMMIT',
      'BEGIN', '-- seed 02_b.sql', 'COMMIT',
    ]);
    expect(pool.end).toHaveBeenCalled();
  });

  test('effectue un ROLLBACK et propage l’erreur en cas d’échec SQL', async () => {
    const pool = creerPool('-- seed 01_a.sql');

    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['01_a.sql', '02_b.sql']);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- seed ${path.basename(p)}`);

    await expect(run()).rejects.toThrow('erreur SQL simulée');

    const commandes = pool.client.query.mock.calls.map(([text]) => text);
    expect(commandes).toContain('ROLLBACK');
    expect(commandes).not.toContain('-- seed 02_b.sql');
    expect(pool.client.release).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
  });

  test('ne fait rien si le dossier de seeds est absent', async () => {
    const pool = creerPool();
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(await run()).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('ne fait rien si le dossier ne contient aucun fichier SQL', async () => {
    const pool = creerPool();
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
    jest.spyOn(fs, 'readdirSync').mockReturnValue(['README.md']);

    expect(await run()).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
