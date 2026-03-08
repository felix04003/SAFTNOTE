'use strict';

const { execSync } = require('child_process');

/**
 * globalTeardown — Supprime la base de test via docker exec.
 */
module.exports = async function globalTeardown() {
  const DB_NAME = 'ecole_manager_test';
  const DB_USER = process.env.POSTGRES_USER || 'ecole_user';
  const CONTAINER = process.env.PG_CONTAINER || 'ecole_postgres';

  const opts = { stdio: 'pipe', timeout: 15000 };

  try {
    // Terminer les connexions actives
    execSync(
      `docker exec ${CONTAINER} psql -U ${DB_USER} -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();"`,
      opts
    );
    execSync(
      `docker exec ${CONTAINER} psql -U ${DB_USER} -d postgres -c "DROP DATABASE IF EXISTS ${DB_NAME};"`,
      opts
    );
    console.log(`✓ Base ${DB_NAME} supprimée`);
  } catch (err) {
    console.warn(`⚠ Impossible de supprimer ${DB_NAME} : ${err.message}`);
  }
};
