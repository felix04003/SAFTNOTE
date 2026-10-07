'use strict';

/**
 * Worker de notifications SMS/WhatsApp.
 * Traite les tâches de la queue 'notifications'.
 *
 * Démarrage : npm run worker:notif
 * En production : PM2 ou service systemd distinct du processus API
 */

require('dotenv').config();

const { Worker, DelayedError } = require('bullmq');
const { createBullMQConnection } = require('../infrastructure/cache/redis');
const { connectDB }              = require('../infrastructure/database/pool');
const { connectRedis }           = require('../infrastructure/cache/redis');
const { traiterNotification } = require('./notification.processor');
const logger                = require('../utils/logger');

// ── Démarrage connexions ─────────────────────────────────────────
async function init() {
  await connectDB();
  await connectRedis();
  logger.info('Worker notifications démarré');
}

/**
 * Processeur BullMQ : délègue à traiterNotification, puis applique le report
 * éventuel. Avec BullMQ 5, reporter un job en cours demande son jeton
 * (`moveToDelayed(date, token)`) ET de lever DelayedError ; sinon le worker
 * tente de terminer un job qui n'est plus actif (« Missing lock » /
 * « not in the active state »).
 */
async function processeur(job, token) {
  const resultat = await traiterNotification(job);
  if (resultat && resultat.statut === 'delayed') {
    await job.moveToDelayed(resultat.reprendre_a, token);
    throw new DelayedError();
  }
  return resultat;
}

// ── Démarrage du worker ──────────────────────────────────────────
init().then(() => {
  const worker = new Worker(
    'notifications',
    processeur,
    {
      connection: createBullMQConnection(),
      concurrency: parseInt(process.env.WORKER_NOTIF_CONCURRENCY) || 5,
    }
  );

  worker.on('completed', (job, result) => {
    logger.debug('Notification complétée', { job_id: job.id, ...result });
  });

  worker.on('failed', (job, err) => {
    logger.error('Notification échouée', {
      job_id: job?.id,
      tentatives: job?.attemptsMade,
      error: err.message,
    });
  });

  logger.info('Worker notifications en écoute');
}).catch(err => {
  logger.error('Démarrage worker échoué', { error: err.message });
  process.exit(1);
});

// ── Exports (lot J, E5) ──────────────────────────────────────────
// Réexport de la logique de traitement (déplacée dans notification.processor.js)
// pour que les tests unitaires existants continuent d'importer depuis le worker.
module.exports = { ...require('./notification.processor'), processeur };
