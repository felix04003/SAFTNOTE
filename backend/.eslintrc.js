'use strict';

module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
  },
  extends: ['eslint:recommended'],
  rules: {
    // Erreurs potentielles
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
    'no-undef': 'error',
    'no-console': 'off',

    // Bonnes pratiques
    'eqeqeq': ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-throw-literal': 'error',
    'no-return-await': 'warn',

    // Style (minimum)
    'semi': ['warn', 'always'],
    'no-trailing-spaces': 'warn',
    'no-multiple-empty-lines': ['warn', { max: 2 }],
  },
  ignorePatterns: ['node_modules/', 'coverage/', 'migrations/'],
};
