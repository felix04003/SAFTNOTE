'use strict';

const { execSync } = require('child_process');
const path = require('path');

const { run: runMigrations } = require('../../src/utils/migrate');

/**
 * globalSetup — Crée la base de test et exécute les migrations.
 *
 * La création/suppression de la base passe par `docker exec` sur le conteneur
 * ecole_postgres (psql n'est pas installé localement) ; les migrations sont
 * ensuite appliquées par le runner Node `src/utils/migrate.js`, le même qu'en
 * dev, sur Render et en production — plus de liste de fichiers à maintenir ici.
 *
 * Les seeds `backend/tests/seeds/*.sql` ne sont volontairement PAS appliqués :
 * ils ciblent la base de développement (parcours E2E Playwright, établissement
 * TEST_LBD) et s'appuient sur des données créées par l'application. Les tests
 * d'intégration construisent leurs propres fixtures (tests/integration/helpers.js)
 * après un TRUNCATE complet, qui effacerait ces seeds de toute façon.
 */
module.exports = async function globalSetup() {
  const DB_NAME = 'ecole_manager_test';
  const DB_USER = process.env.POSTGRES_USER || 'ecole_user';
  const CONTAINER = process.env.PG_CONTAINER || 'ecole_postgres';

  const opts = { stdio: 'pipe', timeout: 60000 };

  /**
   * Exécute une commande SQL via docker exec psql.
   */
  function psql(database, sql) {
    return execSync(
      `docker exec ${CONTAINER} psql -U ${DB_USER} -d ${database} -c "${sql}"`,
      opts
    ).toString();
  }

  // 1. Drop + Create la base de test
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME};`);
  } catch { /* ignore */ }

  psql('postgres', `CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};`);
  console.log(`✓ Base ${DB_NAME} créée`);

  // 2. Appliquer les migrations avec le runner de production.
  //    globalSetup s'exécute avant setupFiles (setEnv.js) : on pose donc
  //    explicitement la connexion et le dossier de migrations, puis on
  //    restaure l'environnement pour ne pas polluer les workers Jest.
  const host     = process.env.POSTGRES_HOST     || 'localhost';
  const port     = process.env.POSTGRES_PORT     || '5433';
  const password = process.env.POSTGRES_PASSWORD || 'ecole_password_dev';

  const ancienneUrl = process.env.DATABASE_URL;
  const ancienDir   = process.env.MIGRATIONS_DIR;

  process.env.DATABASE_URL   = `postgresql://${DB_USER}:${password}@${host}:${port}/${DB_NAME}`;
  process.env.MIGRATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'migrations');

  try {
    await runMigrations();
  } finally {
    if (ancienneUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ancienneUrl;
    if (ancienDir === undefined) delete process.env.MIGRATIONS_DIR;
    else process.env.MIGRATIONS_DIR = ancienDir;
  }

  // 3. Corriger journal_audit si la table partitionnée n'a pas été créée
  try {
    psql(DB_NAME, "SELECT 1 FROM journal_audit LIMIT 0;");
  } catch {
    console.log('  ⚠ journal_audit partitionnée absente — création simple');
    psql(DB_NAME, `
      CREATE TABLE IF NOT EXISTS journal_audit (
        id BIGSERIAL PRIMARY KEY,
        etablissement_id UUID REFERENCES etablissements(id) ON DELETE SET NULL,
        utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
        session_id UUID,
        ip_address INET,
        action VARCHAR(80) NOT NULL,
        resultat VARCHAR(10) NOT NULL DEFAULT 'succes',
        table_cible VARCHAR(60),
        enregistrement_id UUID,
        valeur_avant JSONB,
        valeur_apres JSONB,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  console.log('✓ Migrations appliquées');
};
