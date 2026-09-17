'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/integration/'],
  collectCoverageFrom: [
    'src/domains/**/*.routes.js',
    'src/middleware/**/*.js',
    'src/utils/**/*.js',
    'src/workers/**/*.js',
  ],
  // Lot J (E5, audit 2026-09) : sync.routes.js, notifications.routes.js et
  // src/workers/** ont désormais des tests dédiés (tests/domains/sync.routes.test.js,
  // tests/workers/*.worker.test.js) et sont réintégrés à la couverture.
  // Seuils relevés par palier après ce lot (mesurés réellement avant/après,
  // pas recopiés de l'audit initial) — objectif final : 80/80/80/80.
  // Marge de quelques points sous la mesure réelle pour absorber les petites
  // variations entre environnements CI.
  coverageThreshold: {
    global: { branches: 44, functions: 55, lines: 60, statements: 58 },
  },
  testTimeout: 10000,
  // Chaque fichier de test mockera ses propres dépendances
  restoreMocks: true,
  clearMocks: true,
};
