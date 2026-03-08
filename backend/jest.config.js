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
  ],
  coverageThreshold: {
    global: { branches: 50, functions: 60, lines: 60, statements: 60 },
  },
  testTimeout: 10000,
  // Chaque fichier de test mockera ses propres dépendances
  restoreMocks: true,
  clearMocks: true,
};
