'use strict';

const { Client } = require('pg');

/**
 * globalTeardown — Supprime la base de test via une connexion pg directe.
 *
 * Même correctif que globalSetup.js : docker exec sur un conteneur nommé
 * "ecole_postgres" ne fonctionne qu'en dev local, jamais dans le job CI
 * `backend-integration` (service postgres de la CI, sans ce nom de
 * conteneur). Ici l'échec était silencieux (try/catch → simple warning),
 * donc il ne faisait pas planter la CI, mais la base de test n'était
 * jamais réellement supprimée après le run — corrigé par la même
 * connexion TCP directe que globalSetup.js.
 */
module.exports = async function globalTeardown() {
  const DB_NAME  = 'ecole_manager_test';
  const DB_USER  = process.env.POSTGRES_USER     || 'ecole_user';
  const HOST     = process.env.POSTGRES_HOST     || 'localhost';
  const PORT     = parseInt(process.env.POSTGRES_PORT) || 5433;
  const PASSWORD = process.env.POSTGRES_PASSWORD || 'ecole_password_dev';

  const client = new Client({ host: HOST, port: PORT, user: DB_USER, password: PASSWORD, database: 'postgres' });

  try {
    await client.connect();
    // Terminer les connexions actives avant le DROP (sinon "database is being accessed by other users")
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid();",
      [DB_NAME]
    );
    await client.query(`DROP DATABASE IF EXISTS ${DB_NAME};`);
    console.log(`✓ Base ${DB_NAME} supprimée`);
  } catch (err) {
    console.warn(`⚠ Impossible de supprimer ${DB_NAME} : ${err.message}`);
  } finally {
    try { await client.end(); } catch { /* déjà fermée ou jamais connectée */ }
  }
};
