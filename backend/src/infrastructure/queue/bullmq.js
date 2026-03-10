'use strict';

const { Queue, Worker, QueueEvents } = require('bullmq');
const { createBullMQConnection } = require('../cache/redis');
const logger = require('../../utils/logger');

// ── Noms des queues ──────────────────────────────────────────────
const QUEUES = {
  NOTIFICATIONS:  'notifications',
  MOYENNES:       'calcul-moyennes',
  BULLETINS:      'generation-bulletins',
};

const queues = {};

function getConnection() {
  return createBullMQConnection();
}

/**
 * Initialise les queues BullMQ.
 * À appeler une seule fois au démarrage.
 */
function initQueues() {
  for (const [, name] of Object.entries(QUEUES)) {
    queues[name] = new Queue(name, {
      connection: getConnection(),
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail:     { count: 5000 },
        attempts:         3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    });
  }
  logger.info(`Queues BullMQ initialisées : ${Object.values(QUEUES).join(', ')}`);
}

function getQueue(name) {
  if (!queues[name]) throw new Error(`Queue '${name}' non initialisée`);
  return queues[name];
}

// ── Helpers pour enqueuer des jobs ──────────────────────────────

/**
 * Enqueuer une notification (SMS ou WhatsApp).
 * @param {object} payload - { type_notif, inscription_id, ... }
 * @param {number} priority - 1=urgent, 2=normal, 3=faible
 */
async function enqueuerNotification(payload, priority = 2) {
  const queue = getQueue(QUEUES.NOTIFICATIONS);
  return queue.add(payload.type_notif, payload, {
    priority,
    delay: priority === 1 ? 0 : 5000, // Urgences immédiates, autres dans 5s
  });
}

/**
 * Enqueuer un calcul de moyennes.
 * @param {object} payload - { classe_id, periode_id, etablissement_id }
 */
async function enqueuerCalculMoyennes(payload) {
  const queue = getQueue(QUEUES.MOYENNES);
  return queue.add('calculer', payload, { priority: 2 });
}

/**
 * Enqueuer la génération de bulletins PDF.
 * @param {object} payload - { classe_id, periode_id, etablissement_id }
 */
async function enqueuerGenerationBulletins(payload) {
  const queue = getQueue(QUEUES.BULLETINS);
  return queue.add('generer', payload, { priority: 3 });
}

module.exports = {
  QUEUES,
  initQueues,
  getQueue,
  enqueuerNotification,
  enqueuerCalculMoyennes,
  enqueuerGenerationBulletins,
};
