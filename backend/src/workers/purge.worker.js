'use strict';

/**
 * Worker de purge automatique des données expirées.
 * Tâches répétables via BullMQ :
 *   - sessions expirées
 *   - OTP expirés
 *   - tentatives de connexion anciennes
 *   - journal d'audit expiré (selon conservation_audit_jours)
 */

const { Queue, Worker } = require('bullmq');
const { createBullMQConnection } = require('../infrastructure/cache/redis');
const { getDB } = require('../infrastructure/database/pool');
const logger = require('../utils/logger');

const QUEUE_PURGE = 'purge-donnees';

let purgeQueue;
let purgeWorker;

async function purgerDonnees() {
  const db = getDB();
  const resultats = {};

  // 1. Sessions expirées
  try {
    const result = await db.raw('SELECT purger_sessions_expirees() as count');
    resultats.sessions = result.rows[0]?.count || 0;
  } catch (err) {
    logger.warn('Purge sessions échouée', { err: err.message });
    resultats.sessions = -1;
  }

  // 2. OTP expirés
  try {
    const result = await db.raw('SELECT purger_otp_expires() as count');
    resultats.otp = result.rows[0]?.count || 0;
  } catch (err) {
    logger.warn('Purge OTP échouée', { err: err.message });
    resultats.otp = -1;
  }

  // 3. Tentatives de connexion anciennes (> 30 jours)
  try {
    const deleted = await db('tentatives_connexion')
      .where('tentee_at', '<', db.raw("NOW() - INTERVAL '30 days'"))
      .delete();
    resultats.tentatives_connexion = deleted;
  } catch (err) {
    logger.warn('Purge tentatives connexion échouée', { err: err.message });
    resultats.tentatives_connexion = -1;
  }

  // 4. Journal d'audit expiré selon la politique de conservation
  try {
    const politique = await db('politique_securite')
      .min('conservation_audit_jours as min_jours')
      .first();
    const joursConservation = politique?.min_jours || 365;
    const deleted = await db('journal_audit')
      .where('created_at', '<', db.raw(`NOW() - INTERVAL '${joursConservation} days'`))
      .delete();
    resultats.journal_audit = deleted;
  } catch (err) {
    logger.warn('Purge journal audit échouée', { err: err.message });
    resultats.journal_audit = -1;
  }

  logger.info('Purge automatique terminée', resultats);
  return resultats;
}

function initPurgeWorker() {
  const connection = createBullMQConnection();

  purgeQueue = new Queue(QUEUE_PURGE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
    },
  });

  // Planifier une tâche répétable quotidienne à 3h00 UTC
  purgeQueue.add(
    'purge-quotidienne',
    {},
    {
      repeat: { cron: '0 3 * * *' }, // Chaque nuit à 3h00 UTC
      jobId: 'purge-quotidienne',    // ID fixe pour éviter les doublons
    }
  ).catch(err => logger.warn('Impossible de planifier la purge', { err: err.message }));

  purgeWorker = new Worker(
    QUEUE_PURGE,
    async (job) => {
      logger.info('Démarrage purge automatique', { jobId: job.id });
      return purgerDonnees();
    },
    { connection: createBullMQConnection() }
  );

  purgeWorker.on('completed', (job, result) => {
    logger.info('Purge terminée', { jobId: job.id, result });
  });

  purgeWorker.on('failed', (job, err) => {
    logger.error('Purge échouée', { jobId: job?.id, err: err.message });
  });

  logger.info('Worker de purge initialisé (cron: chaque nuit à 3h UTC)');
}

function stopPurgeWorker() {
  if (purgeWorker) purgeWorker.close();
  if (purgeQueue) purgeQueue.close();
}

module.exports = { initPurgeWorker, stopPurgeWorker, purgerDonnees };
