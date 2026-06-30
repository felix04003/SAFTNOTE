'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/integration/'],
  collectCoverageFrom: [
    'src/domains/**/*.routes.js',
    'src/middleware/**/*.js',
    'src/utils/**/*.js',
    '!src/workers/**',
    '!src/domains/notifications.routes.js',
    '!src/domains/sync.routes.js',
  ],
  coverageThreshold: {
    global: { branches: 36, functions: 50, lines: 56, statements: 54 },
  },
  testTimeout: 10000,
  // Chaque fichier de test mockera ses propres dépendances
  restoreMocks: true,
  clearMocks: true,
};
