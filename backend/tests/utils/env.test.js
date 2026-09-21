'use strict';

// Tests de validateEnv() — lot E (finding E1, audit 2026-09) : AT_API_KEY et
// AT_USERNAME (Africa's Talking) doivent être obligatoires en production,
// avertissement seulement en dev.

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));

// Variables requises par les autres règles de validateEnv(), fournies ici
// pour isoler les assertions sur la règle _AT_GROUP.
const ENV_BASE = {
  JWT_SECRET:  'a'.repeat(32),
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
};

describe('validateEnv() — _AT_GROUP (Africa\'s Talking, lot E)', () => {
  const ENV_ORIGINAL = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ENV_ORIGINAL, ...ENV_BASE };
    delete process.env.AT_API_KEY;
    delete process.env.AT_USERNAME;
    delete process.env.MONITORING_TOKEN;
    delete process.env.S3_ENDPOINT;
  });

  afterAll(() => {
    process.env = ENV_ORIGINAL;
  });

  test('production sans AT_API_KEY/AT_USERNAME → validateEnv() lève', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONITORING_TOKEN = 'token-monitoring-valide';

    const { validateEnv } = require('../../src/utils/env');

    expect(() => validateEnv()).toThrow();
  });

  test('production avec AT_API_KEY et AT_USERNAME renseignées → ne lève pas', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONITORING_TOKEN = 'token-monitoring-valide';
    process.env.AT_API_KEY = 'cle-at-valide';
    process.env.AT_USERNAME = 'monetablissement';

    const { validateEnv } = require('../../src/utils/env');

    expect(() => validateEnv()).not.toThrow();
  });

  test('production avec seulement AT_API_KEY (AT_USERNAME absent) → lève', () => {
    process.env.NODE_ENV = 'production';
    process.env.MONITORING_TOKEN = 'token-monitoring-valide';
    process.env.AT_API_KEY = 'cle-at-valide';

    const { validateEnv } = require('../../src/utils/env');

    expect(() => validateEnv()).toThrow();
  });

  test('développement sans AT_API_KEY/AT_USERNAME → avertissement seulement, pas de crash', () => {
    process.env.NODE_ENV = 'development';

    const logger = require('../../src/utils/logger');
    const { validateEnv } = require('../../src/utils/env');

    expect(() => validateEnv()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('AT_API_KEY'));
  });

  test('test (NODE_ENV=test) sans AT_API_KEY/AT_USERNAME → avertissement seulement, pas de crash', () => {
    process.env.NODE_ENV = 'test';

    const { validateEnv } = require('../../src/utils/env');

    expect(() => validateEnv()).not.toThrow();
  });
});
