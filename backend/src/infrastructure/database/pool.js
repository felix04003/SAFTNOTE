'use strict';

const knex   = require('knex');
const logger = require('../../utils/logger');

let db;

const config = {
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host:     process.env.POSTGRES_HOST     || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB       || 'ecole_manager',
    user:     process.env.POSTGRES_USER     || 'ecole_user',
    password: process.env.POSTGRES_PASSWORD || '',
  },
  pool: {
    min:              parseInt(process.env.POSTGRES_POOL_MIN) || 2,
    max:              parseInt(process.env.POSTGRES_POOL_MAX) || 10,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis:    600000,
    // Pose le contexte d'audit sur chaque connexion acquise
    afterCreate: (conn, done) => {
      conn.query('SET timezone = "Africa/Dakar"', (err) => done(err, conn));
    },
  },
  acquireConnectionTimeout: 10000,
};

/**
 * Initialise la connexion à la base de données.
 * Vérifie que la connexion fonctionne avec une requête test.
 */
async function connectDB() {
  db = knex(config);

  // Test de connexion
  await db.raw('SELECT 1');
  return db;
}

/**
 * Retourne l'instance knex (ou lève une erreur si non initialisée).
 */
function getDB() {
  if (!db) throw new Error("Base de données non initialisée — appeler connectDB() d'abord");
  return db;
}

/**
 * Pose le contexte utilisateur pour les triggers d'audit PostgreSQL.
 * À appeler au début de chaque transaction sensible.
 *
 * @param {object} trx - Transaction knex en cours
 * @param {string} utilisateurId - UUID de l'utilisateur connecté
 * @param {string} etablissementId - UUID de l'établissement
 */
async function poserContexteAudit(trx, utilisateurId, etablissementId) {
  await trx.raw(
    `SELECT
       set_config('app.utilisateur_id',    ?, TRUE),
       set_config('app.etablissement_id',  ?, TRUE)`,
    [utilisateurId, etablissementId]
  );
}

/**
 * Exécute une fonction dans une transaction.
 * Rollback automatique en cas d'erreur.
 *
 * @param {Function} fn - async (trx) => { ... }
 * @returns {*} résultat de fn
 */
async function withTransaction(fn) {
  const database = getDB();
  return database.transaction(fn);
}

/**
 * Vérifie la santé de la connexion BD.
 */
async function healthCheck() {
  try {
    await getDB().raw('SELECT 1');
    return { status: 'ok' };
  } catch (err) {
    logger.error('DB health check échoué', { error: err.message });
    return { status: 'error', message: err.message };
  }
}

module.exports = { connectDB, getDB, poserContexteAudit, withTransaction, healthCheck };
