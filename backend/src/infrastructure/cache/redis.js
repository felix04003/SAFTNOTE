'use strict';

const Redis  = require('ioredis');
const logger = require('../../utils/logger');

let redisClient;

const REDIS_BASE_OPTIONS = {
  host:         process.env.REDIS_HOST     || 'localhost',
  port:         parseInt(process.env.REDIS_PORT) || 6379,
  password:     process.env.REDIS_PASSWORD || undefined,
  db:           parseInt(process.env.REDIS_DB) || 0,
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 100, 3000);
  },
};

function createClient() {
  return new Redis({
    ...REDIS_BASE_OPTIONS,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

/** Crée un client Redis compatible BullMQ (maxRetriesPerRequest: null requis). */
function createBullMQConnection() {
  return new Redis({
    ...REDIS_BASE_OPTIONS,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

async function connectRedis() {
  redisClient = createClient();

  redisClient.on('error', (err) => logger.error('Redis erreur', { error: err.message }));
  redisClient.on('reconnecting', () => logger.warn('Redis reconnexion…'));
  redisClient.on('connect', () => logger.info('Redis connecté'));

  await redisClient.connect();
  return redisClient;
}

function getRedis() {
  if (!redisClient) throw new Error('Redis non initialisé');
  return redisClient;
}

// ── Helpers cache ────────────────────────────────────────────────

/**
 * Récupère une valeur du cache ou l'initialise avec la fonction fournie.
 * @param {string} key - Clé Redis
 * @param {Function} fetchFn - async () => data
 * @param {number} ttlSec - Durée de vie en secondes (défaut: 300)
 */
async function getOrSet(key, fetchFn, ttlSec = 300) {
  const client = getRedis();
  const cached = await client.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  const data = await fetchFn();
  await client.setex(key, ttlSec, JSON.stringify(data));
  return data;
}

/**
 * Invalide les clés Redis correspondant à un pattern.
 * @param {string} pattern - Pattern Redis (ex: 'classes:etablissement_id:*')
 */
async function invalidatePattern(pattern) {
  const client = getRedis();
  const keys = await client.keys(pattern);
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

async function healthCheck() {
  try {
    await getRedis().ping();
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = { connectRedis, getRedis, createBullMQConnection, getOrSet, invalidatePattern, healthCheck };
