'use strict';

/**
 * Runner de migrations SQL avec tracking dans _migrations.
 *
 * - Crée la table _migrations si elle n'existe pas
 * - Lit les fichiers *.sql dans migrations/ (tri lexicographique)
 * - Applique uniquement ceux non encore présents dans _migrations
 * - Idempotent : relancer ne réapplique pas les migrations déjà faites
 *
 * Usage :
 *   node src/utils/migrate.js
 *   MIGRATIONS_DIR=/chemin/abs node src/utils/migrate.js
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR
  || path.resolve(__dirname, '../../../migrations');

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // 1. Créer la table de tracking si absente
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name    TEXT        PRIMARY KEY,
        run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Lire les fichiers SQL disponibles (ordre lexicographique = ordre numérique)
    const fichiers = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && f !== 'run_all_migrations.sql')
      .sort();

    if (fichiers.length === 0) {
      console.log('[migrate] Aucun fichier SQL trouvé dans', MIGRATIONS_DIR);
      return;
    }

    // 3. Récupérer les migrations déjà appliquées
    const { rows } = await pool.query('SELECT name FROM _migrations');
    const dejaDone = new Set(rows.map(r => r.name));

    // 4. Appliquer les migrations manquantes dans l'ordre
    let appliquees = 0;

    for (const fichier of fichiers) {
      if (dejaDone.has(fichier)) {
        console.log(`[migrate] ✓ déjà appliquée : ${fichier}`);
        continue;
      }

      const sqlPath = path.join(MIGRATIONS_DIR, fichier);
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

  } finally {
    await pool.end();
  }
}

run().catch(err => {
  console.error('[migrate] Erreur fatale :', err.message);
  process.exit(1);
});
