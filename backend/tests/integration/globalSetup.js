'use strict';

const { Client } = require('pg');
const path = require('path');

const { run: runMigrations } = require('../../src/utils/migrate');

/**
 * globalSetup — Crée la base de test et exécute les migrations.
 *
 * CI (lot J) : la création/suppression de la base passait par `docker exec
 * ecole_postgres psql ...`, qui suppose un conteneur Docker nommé
 * "ecole_postgres" — vrai en dev local (docker-compose), FAUX dans le job
 * GitHub Actions `backend-integration` (service `postgres:16-alpine` de la
 * CI, exposé en TCP sur localhost:5433, sans conteneur nommé
 * "ecole_postgres" ni accès docker exec depuis le job). Résultat : le job
 * échouait systématiquement avec "No such container: ecole_postgres"
 * (jamais détecté avant car les tests d'intégration n'avaient jamais tourné
 * en CI avant le lot J). Corrigé en se connectant directement en TCP via le
 * driver `pg` (déjà une dépendance du projet, utilisé par migrate.js) —
 * fonctionne identiquement en local (docker-compose expose 5433) et en CI
 * (le service postgres de la CI expose aussi 5433), sans dépendre du nom
 * ou de l'existence d'un conteneur Docker précis.
 *
 * Les migrations sont ensuite appliquées par le runner Node
 * `src/utils/migrate.js`, le même qu'en dev, sur Render et en production —
 * plus de liste de fichiers à maintenir ici.
 *
 * Les seeds `backend/tests/seeds/*.sql` ne sont volontairement PAS appliqués :
 * ils ciblent la base de développement (parcours E2E Playwright, établissement
 * TEST_LBD) et s'appuient sur des données créées par l'application. Les tests
 * d'intégration construisent leurs propres fixtures (tests/integration/helpers.js)
 * après un TRUNCATE complet, qui effacerait ces seeds de toute façon.
 */
module.exports = async function globalSetup() {
  const DB_NAME  = 'ecole_manager_test';
  const DB_USER  = process.env.POSTGRES_USER     || 'ecole_user';
  const HOST     = process.env.POSTGRES_HOST     || 'localhost';
  const PORT     = parseInt(process.env.POSTGRES_PORT) || 5433;
  const PASSWORD = process.env.POSTGRES_PASSWORD || 'ecole_password_dev';

  /**
   * Exécute une requête SQL sur `database` via une connexion pg dédiée,
   * fermée immédiatement après (DROP/CREATE DATABASE ne peuvent pas
   * s'exécuter dans une connexion pool/transaction réutilisée).
   */
  async function psql(database, sql) {
    const client = new Client({ host: HOST, port: PORT, user: DB_USER, password: PASSWORD, database });
    await client.connect();
    try {
      return await client.query(sql);
    } finally {
      await client.end();
    }
  }

  // 1. Drop + Create la base de test
  try {
    await psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME};`);
  } catch { /* ignore */ }

  await psql('postgres', `CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};`);
  console.log(`✓ Base ${DB_NAME} créée`);

  // 2. Appliquer les migrations avec le runner de production.
  //    globalSetup s'exécute avant setupFiles (setEnv.js) : on pose donc
  //    explicitement la connexion et le dossier de migrations, puis on
  //    restaure l'environnement pour ne pas polluer les workers Jest.
  const ancienneUrl = process.env.DATABASE_URL;
  const ancienDir   = process.env.MIGRATIONS_DIR;

  process.env.DATABASE_URL   = `postgresql://${DB_USER}:${PASSWORD}@${HOST}:${PORT}/${DB_NAME}`;
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
    await psql(DB_NAME, 'SELECT 1 FROM journal_audit LIMIT 0;');
  } catch {
    console.log('  ⚠ journal_audit partitionnée absente — création simple');
    await psql(DB_NAME, `
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
