'use strict';

/**
 * Runner de migrations SQL avec tracking dans _migrations.
 *
 * - Crée la table _migrations si elle n'existe pas
 * - Lit les fichiers *.sql du dossier de migrations (tri lexicographique)
 * - Applique uniquement ceux non encore présents dans _migrations
 * - Idempotent : relancer ne réapplique pas les migrations déjà faites
 * - Compatible avec les bases créées via `run_all_migrations.sql`
 *   (table de suivi historique `schema_migrations`) : dans ce cas les
 *   migrations déjà appliquées sont reportées dans `_migrations` avant
 *   toute exécution, pour ne pas rejouer le schéma.
 *
 * Connexion : DATABASE_URL, sinon POSTGRES_HOST/PORT/DB/USER/PASSWORD
 * (mêmes règles que src/infrastructure/database/pool.js).
 *
 * RÈGLE : tout fichier de migrations/ DOIT être idempotent
 * (IF NOT EXISTS / ON CONFLICT DO NOTHING / DROP ... IF EXISTS).
 * Le suivi se fait par NOM DE FICHIER : renommer, renuméroter ou déplacer
 * une migration déjà appliquée la fait rejouer sous son nouveau nom.
 *
 * Usage :
 *   node src/utils/migrate.js
 *   MIGRATIONS_DIR=/chemin/abs node src/utils/migrate.js
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

/**
 * Résout le dossier des migrations :
 *   1. MIGRATIONS_DIR si défini
 *   2. <backend>/migrations s'il existe (image Docker, cf. lot F)
 *   3. <racine du dépôt>/migrations
 *
 * @returns {string} chemin absolu du dossier de migrations
 */
function resoudreMigrationsDir() {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;

  const dansConteneur = path.resolve(__dirname, '../../migrations');
  if (fs.existsSync(dansConteneur)) return dansConteneur;

  return path.resolve(__dirname, '../../../migrations');
}

/**
 * Construit la configuration de connexion pg.
 * Même logique que pool.js : DATABASE_URL prioritaire, sinon variables POSTGRES_*.
 *
 * @returns {object} options acceptées par `new Pool(...)`
 */
function configConnexion() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB       || 'ecole_manager',
    user:     process.env.POSTGRES_USER     || 'ecole_user',
    password: process.env.POSTGRES_PASSWORD || '',
  };
}

/**
 * Reporte dans `_migrations` les migrations déjà appliquées via
 * `run_all_migrations.sql` (table `schema_migrations`, versions '000'→'008').
 * Ne fait rien si `_migrations` est déjà renseignée ou si la table
 * historique n'existe pas.
 *
 * @param {object} pool - pool pg
 * @param {string[]} fichiers - fichiers SQL disponibles, triés
 */
async function preremplirDepuisSchemaMigrations(pool, fichiers) {
  const { rows: existe } = await pool.query(
    "SELECT to_regclass('public.schema_migrations') AS table_historique"
  );
  if (!existe[0] || !existe[0].table_historique) return;

  const { rows: dejaSuivies } = await pool.query('SELECT COUNT(*)::int AS n FROM _migrations');
  if (dejaSuivies[0].n > 0) return;

  const { rows: versions } = await pool.query('SELECT version FROM schema_migrations');
  if (versions.length === 0) return;

  const versionsAppliquees = new Set(versions.map(r => String(r.version).trim()));

  // Une version ('001') peut correspondre à plusieurs fichiers ('000_extensions.sql'
  // et '000_extensions_types.sql' partagent le préfixe '000').
  const aReporter = fichiers.filter(f => versionsAppliquees.has(f.slice(0, 3)));
  if (aReporter.length === 0) return;

  for (const fichier of aReporter) {
    await pool.query(
      'INSERT INTO _migrations (name, run_at) VALUES ($1, NOW()) ON CONFLICT (name) DO NOTHING',
      [fichier]
    );
  }

  console.log(
    `[migrate] ${aReporter.length} migration(s) reportée(s) depuis schema_migrations (base créée via run_all_migrations.sql)`
  );
}

/**
 * Applique les migrations manquantes.
 *
 * @returns {Promise<number>} nombre de migrations appliquées
 */
async function run() {
  const migrationsDir = resoudreMigrationsDir();
  const pool = new Pool(configConnexion());

  try {
    // 1. Créer la table de tracking si absente
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name    TEXT        PRIMARY KEY,
        run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Lire les fichiers SQL disponibles (ordre lexicographique = ordre numérique)
    const fichiers = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql') && f !== 'run_all_migrations.sql')
      .sort();

    if (fichiers.length === 0) {
      console.log('[migrate] Aucun fichier SQL trouvé dans', migrationsDir);
      return 0;
    }

    // 3. Compatibilité avec les bases créées via run_all_migrations.sql
    await preremplirDepuisSchemaMigrations(pool, fichiers);

    // 4. Récupérer les migrations déjà appliquées
    const { rows } = await pool.query('SELECT name FROM _migrations');
    const dejaDone = new Set(rows.map(r => r.name));

    // 5. Appliquer les migrations manquantes dans l'ordre
    let appliquees = 0;

    for (const fichier of fichiers) {
      if (dejaDone.has(fichier)) {
        console.log(`[migrate] ✓ déjà appliquée : ${fichier}`);
        continue;
      }

      const sqlPath = path.join(migrationsDir, fichier);
      const sql     = fs.readFileSync(sqlPath, 'utf8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (name, run_at) VALUES ($1, NOW())',
          [fichier]
        );
        await client.query('COMMIT');
        console.log(`[migrate] ✅ appliquée : ${fichier}`);
        appliquees++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[migrate] ❌ Échec sur ${fichier} :`, err.message);
        throw err;
      } finally {
        client.release();
      }
    }

    if (appliquees === 0) {
      console.log('[migrate] Base de données à jour — aucune migration à appliquer');
    } else {
      console.log(`[migrate] ${appliquees} migration(s) appliquée(s) avec succès`);
    }

    return appliquees;

  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('[migrate] Erreur fatale :', err.message);
    process.exit(1);
  });
}

module.exports = { run, resoudreMigrationsDir, configConnexion };
