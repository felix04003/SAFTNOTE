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

// ════════════════════════════════════════════════════════════════
// RLS phase 1 pilote (migration 019) — pool séparé, rôle non
// propriétaire `ecole_app_rls`, réellement soumis aux policies RLS
// (contrairement à `db` ci-dessus, dont le rôle est propriétaire des
// tables et donc totalement exempté du RLS par PostgreSQL).
//
// Coexiste avec `db` sans jamais le modifier : getDB() garde
// exactement le même comportement pour les ~40 routes non converties.
// ════════════════════════════════════════════════════════════════

let dbRls;

const configRls = {
  client: 'pg',
  connection: process.env.DATABASE_URL_RLS || {
    host:     process.env.POSTGRES_HOST         || 'localhost',
    port:     parseInt(process.env.POSTGRES_PORT) || 5432,
    database: process.env.POSTGRES_DB           || 'ecole_manager',
    user:     process.env.POSTGRES_RLS_USER     || 'ecole_app_rls',
    password: process.env.POSTGRES_RLS_PASSWORD || '',
  },
  pool: {
    // Pool volontairement petit : seule la route pilote GET /configs/matieres
    // l'utilise pour l'instant (voir avecContexteEtablissement dans
    // ./rls.js). À faire grossir au même rythme que les routes converties.
    min:                  parseInt(process.env.POSTGRES_RLS_POOL_MIN) || 1,
    max:                  parseInt(process.env.POSTGRES_RLS_POOL_MAX) || 5,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis:    600000,
    afterCreate: (conn, done) => {
      conn.query('SET timezone = "Africa/Dakar"', (err) => done(err, conn));
    },
  },
  acquireConnectionTimeout: 10000,
};

/**
 * Retourne (en la créant si besoin, lazy) l'instance knex connectée
 * avec le rôle `ecole_app_rls`, soumise aux policies RLS réelles.
 *
 * Lazy à dessein : ce pool n'est ouvert qu'à la première utilisation
 * réelle (par avecContexteEtablissement()), jamais au démarrage de
 * l'app. Une variable d'environnement RLS manquante ou incorrecte ne
 * peut donc jamais faire planter le démarrage ni consommer de
 * connexions pour les routes qui n'appellent jamais cette fonction.
 *
 * @returns {import('knex').Knex}
 */
function getDBRls() {
  if (!dbRls) dbRls = knex(configRls);
  return dbRls;
}

/**
 * Ferme le pool `ecole_app_rls` s'il a été ouvert (revue lot I — sans ce
 * garde, un arrêt propre du serveur ne fermait que `db`, laissant les
 * connexions ecole_app_rls fuir/bloquer l'extinction du process dès que
 * la route pilote GET /configs/matieres avait été appelée au moins une
 * fois). Ne rien faire si getDBRls() n'a jamais été appelée (lazy) —
 * évite d'ouvrir inutilement une connexion juste pour la refermer.
 *
 * @returns {Promise<void>}
 */
async function closeDBRls() {
  if (dbRls) {
    await dbRls.destroy();
    dbRls = null;
  }
}

module.exports = { connectDB, getDB, poserContexteAudit, withTransaction, healthCheck, getDBRls, closeDBRls };
