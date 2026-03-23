'use strict';

// Variables d'environnement pour les tests d'intégration.
// Injectées dans chaque worker Jest avant le chargement des modules.
process.env.NODE_ENV          = 'test';
process.env.POSTGRES_HOST     = process.env.POSTGRES_HOST     || 'localhost';
process.env.POSTGRES_PORT     = process.env.POSTGRES_PORT     || '5433';
process.env.POSTGRES_USER     = process.env.POSTGRES_USER     || 'ecole_user';
process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'ecole_password_dev';
process.env.POSTGRES_DB       = 'ecole_manager_test';
process.env.DATABASE_URL      = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/ecole_manager_test`;
process.env.REDIS_URL         = process.env.REDIS_URL         || 'redis://localhost:6379';
process.env.JWT_SECRET        = 'test_jwt_secret_32_characters_min_ok';
process.env.PG_CONTAINER      = process.env.PG_CONTAINER      || 'ecole_postgres';
