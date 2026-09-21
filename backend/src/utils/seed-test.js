'use strict';

/**
 * Injecte les jeux de données de test (backend/tests/seeds/*.sql).
 *
 * - Refuse catégoriquement de tourner avec NODE_ENV=production
 * - Applique les fichiers dans l'ordre lexicographique (01 → 05)
 * - Chaque fichier est joué dans sa propre transaction
 * - Aucune table de suivi : les seeds sont idempotents
 *   (ON CONFLICT DO NOTHING / UPDATE conditionné)
 *
 * Connexion : DATABASE_URL, sinon POSTGRES_HOST/PORT/DB/USER/PASSWORD
 * (mêmes règles que src/infrastructure/database/pool.js).
 *
 * Usage :
 *   npm run seed:test
 *   SEEDS_DIR=/chemin/abs node src/utils/seed-test.js
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const { configConnexion } = require('./migrate');

/**
 * Résout le dossier des seeds : SEEDS_DIR sinon <backend>/tests/seeds.
 *
 * @returns {string} chemin absolu du dossier de seeds
 */
function resoudreSeedsDir() {
  if (process.env.SEEDS_DIR) return process.env.SEEDS_DIR;
  return path.resolve(__dirname, '../../tests/seeds');
}

/**
 * Applique tous les seeds de test.
 *
 * @returns {Promise<number>} nombre de fichiers appliqués
 * @throws {Error} si NODE_ENV vaut 'production'
 */
async function run() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Les seeds de test ne peuvent pas être appliqués en production (NODE_ENV=production)'
    );
  }

  const seedsDir = resoudreSeedsDir();

  if (!fs.existsSync(seedsDir)) {
    console.log('[seed-test] Dossier de seeds introuvable :', seedsDir);
    return 0;
  }

  const fichiers = fs.readdirSync(seedsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (fichiers.length === 0) {
    console.log('[seed-test] Aucun fichier SQL trouvé dans', seedsDir);
    return 0;
  }

  const pool = new Pool(configConnexion());
  let appliques = 0;

  try {
    for (const fichier of fichiers) {
      const sql = fs.readFileSync(path.join(seedsDir, fichier), 'utf8');

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`[seed-test] ✅ appliqué : ${fichier}`);
        appliques++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[seed-test] ❌ Échec sur ${fichier} :`, err.message);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(`[seed-test] ${appliques} seed(s) appliqué(s)`);
    return appliques;

  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('[seed-test] Erreur fatale :', err.message);
    process.exit(1);
  });
}

module.exports = { run, resoudreSeedsDir };
