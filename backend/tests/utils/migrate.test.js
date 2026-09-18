'use strict';

/**
 * Tests du runner de migrations (src/utils/migrate.js).
 * `pg` et `fs` sont mockés : aucune base n'est touchée.
 */

jest.mock('pg', () => ({ Pool: jest.fn() }));

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { run, resoudreMigrationsDir, configConnexion } = require('../../src/utils/migrate');

// ── Faux pool pg ────────────────────────────────────────────────

/**
 * Construit un pool pg simulé dont les réponses dépendent de `etat`.
 *
 * @param {object} etat - { schemaMigrationsExiste, versions, migrationsSuivies, echouerSur }
 */
function creerPool(etat) {
  const repondre = (text, params) => {
    if (text.includes('CREATE TABLE IF NOT EXISTS _migrations')) return { rows: [] };

    if (text.includes('to_regclass')) {
      return { rows: [{ table_historique: etat.schemaMigrationsExiste ? 'schema_migrations' : null }] };
    }

    if (text.includes('COUNT(*)')) {
      return { rows: [{ n: etat.migrationsSuivies.length }] };
    }

    if (text.includes('FROM schema_migrations')) {
      return { rows: etat.versions.map(version => ({ version })) };
    }

    if (text.startsWith('INSERT INTO _migrations')) {
      etat.migrationsSuivies.push(params[0]);
      return { rows: [] };
    }

    if (text.includes('SELECT name FROM _migrations')) {
      return { rows: etat.migrationsSuivies.map(name => ({ name })) };
    }

    if (etat.echouerSur && text.includes(etat.echouerSur)) {
      throw new Error('erreur SQL simulée');
    }

    return { rows: [] };
  };

  const client = {
    query: jest.fn(async (text, params) => repondre(text, params)),
    release: jest.fn(),
  };

  const pool = {
    query: jest.fn(async (text, params) => repondre(text, params)),
    connect: jest.fn(async () => client),
    end: jest.fn(async () => {}),
    client,
  };

  Pool.mockImplementation(() => pool);
  return pool;
}

/**
 * Raccourci : état par défaut (base vierge, pas de schema_migrations).
 */
function etatVierge(surcharges = {}) {
  return {
    schemaMigrationsExiste: false,
    versions: [],
    migrationsSuivies: [],
    echouerSur: null,
    ...surcharges,
  };
}

// ── Environnement ───────────────────────────────────────────────

const ENV_INITIAL = { ...process.env };

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.MIGRATIONS_DIR = '/faux/migrations';
  process.env.DATABASE_URL   = 'postgresql://u:p@h:5432/db';
});

afterEach(() => {
  process.env = { ...ENV_INITIAL };
});

// ── resoudreMigrationsDir ───────────────────────────────────────

describe('resoudreMigrationsDir', () => {
  test('retourne MIGRATIONS_DIR quand la variable est définie', () => {
    process.env.MIGRATIONS_DIR = '/chemin/impose';
    expect(resoudreMigrationsDir()).toBe('/chemin/impose');
  });

  test('retourne <backend>/migrations quand ce dossier existe (conteneur)', () => {
    delete process.env.MIGRATIONS_DIR;
    const attendu = path.resolve(__dirname, '../../src/utils', '../../migrations');
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);

    expect(resoudreMigrationsDir()).toBe(attendu);
  });

  test('retourne <racine du dépôt>/migrations sinon', () => {
    delete process.env.MIGRATIONS_DIR;
    const attendu = path.resolve(__dirname, '../../src/utils', '../../../migrations');
    jest.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(resoudreMigrationsDir()).toBe(attendu);
  });
});

// ── configConnexion ─────────────────────────────────────────────

describe('configConnexion', () => {
  test('privilégie DATABASE_URL', () => {
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db';
    expect(configConnexion()).toEqual({ connectionString: 'postgresql://u:p@h:5432/db' });
  });

  test('retombe sur les variables POSTGRES_* comme pool.js', () => {
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST     = 'pg-host';
    process.env.POSTGRES_PORT     = '5433';
    process.env.POSTGRES_DB       = 'ecole_manager_test';
    process.env.POSTGRES_USER     = 'ecole_user';
    process.env.POSTGRES_PASSWORD = 'secret';

    expect(configConnexion()).toEqual({
      host: 'pg-host',
      port: 5433,
      database: 'ecole_manager_test',
      user: 'ecole_user',
      password: 'secret',
    });
  });
});

// ── run ─────────────────────────────────────────────────────────

describe('run', () => {
  test('applique les fichiers triés et ignore run_all_migrations.sql', async () => {
    const etat = etatVierge();
    const pool = creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue([
      '010_dix.sql', '002_deux.sql', 'run_all_migrations.sql', 'notes.txt',
    ]);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- sql de ${path.basename(p)}`);

    const appliquees = await run();

    expect(appliquees).toBe(2);
    expect(etat.migrationsSuivies).toEqual(['002_deux.sql', '010_dix.sql']);

    const sqlJoues = pool.client.query.mock.calls
      .map(([text]) => text)
      .filter(text => text.startsWith('-- sql de'));
    expect(sqlJoues).toEqual(['-- sql de 002_deux.sql', '-- sql de 010_dix.sql']);
    expect(pool.end).toHaveBeenCalled();
  });

  test('ne rejoue pas un fichier déjà présent dans _migrations', async () => {
    const etat = etatVierge({ migrationsSuivies: ['001_un.sql'] });
    const pool = creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue(['001_un.sql', '002_deux.sql']);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- sql de ${path.basename(p)}`);

    const appliquees = await run();

    expect(appliquees).toBe(1);
    const sqlJoues = pool.client.query.mock.calls
      .map(([text]) => text)
      .filter(text => text.startsWith('-- sql de'));
    expect(sqlJoues).toEqual(['-- sql de 002_deux.sql']);
  });

  test('reporte les versions de schema_migrations dans _migrations sans rejouer le schéma', async () => {
    const etat = etatVierge({ schemaMigrationsExiste: true, versions: ['000', '001'] });
    const pool = creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue([
      '000_extensions.sql', '000_extensions_types.sql', '001_identites.sql', '013_fix.sql',
    ]);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- sql de ${path.basename(p)}`);

    const appliquees = await run();

    // Seule 013 est réellement jouée : 000/001 sont marquées comme déjà appliquées
    expect(appliquees).toBe(1);
    const sqlJoues = pool.client.query.mock.calls
      .map(([text]) => text)
      .filter(text => text.startsWith('-- sql de'));
    expect(sqlJoues).toEqual(['-- sql de 013_fix.sql']);
    expect(etat.migrationsSuivies).toEqual([
      '000_extensions.sql', '000_extensions_types.sql', '001_identites.sql', '013_fix.sql',
    ]);
  });

  test('ne préremplit pas si _migrations contient déjà des lignes', async () => {
    const etat = etatVierge({
      schemaMigrationsExiste: true,
      versions: ['000'],
      migrationsSuivies: ['013_fix.sql'],
    });
    creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue(['000_extensions.sql', '013_fix.sql']);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- sql de ${path.basename(p)}`);

    const appliquees = await run();

    expect(appliquees).toBe(1);
    expect(etat.migrationsSuivies).toEqual(['013_fix.sql', '000_extensions.sql']);
  });

  test('effectue un ROLLBACK et propage l’erreur en cas d’échec SQL', async () => {
    const etat = etatVierge({ echouerSur: '-- sql de 002_deux.sql' });
    const pool = creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue(['002_deux.sql']);
    jest.spyOn(fs, 'readFileSync').mockImplementation(p => `-- sql de ${path.basename(p)}`);

    await expect(run()).rejects.toThrow('erreur SQL simulée');

    const commandes = pool.client.query.mock.calls.map(([text]) => text);
    expect(commandes).toContain('ROLLBACK');
    expect(commandes).not.toContain('COMMIT');
    expect(pool.client.release).toHaveBeenCalled();
    expect(pool.end).toHaveBeenCalled();
  });

  test('ne fait rien si le dossier ne contient aucun fichier SQL', async () => {
    const etat = etatVierge();
    const pool = creerPool(etat);

    jest.spyOn(fs, 'readdirSync').mockReturnValue(['README.md']);

    expect(await run()).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
