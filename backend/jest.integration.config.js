'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/integration/**/*.integration.test.js'],
  globalSetup: './tests/integration/globalSetup.js',
  globalTeardown: './tests/integration/globalTeardown.js',
  testTimeout: 30000,
  restoreMocks: true,
  clearMocks: true,
  // Exécution séquentielle — les tests partagent la même base
  maxWorkers: 1,
};
