'use strict';

require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const compression = require('compression');
const morgan     = require('morgan');

const swaggerUi        = require('swagger-ui-express');
const swaggerSpec      = require('./swagger');

const { connectDB }    = require('./infrastructure/database/pool');
const { connectRedis } = require('./infrastructure/cache/redis');
const logger           = require('./utils/logger');
const errorHandler     = require('./middleware/error.middleware');
const { notFound }     = require('./middleware/notFound.middleware');

// ── Domaines ────────────────────────────────────────────────────
const setupRouter       = require('./domains/setup/setup.routes');
const identitesRouter   = require('./domains/01-identites/identites.routes');
const authRouter        = require('./domains/02-acteurs/auth/auth.routes');
const elevesRouter      = require('./domains/02-acteurs/eleves/eleves.routes');
const parentsRouter     = require('./domains/02-acteurs/parents/parents.routes');
const enseignantsRouter = require('./domains/02-acteurs/enseignants/enseignants.routes');
const pedagogieRouter   = require('./domains/03-pedagogie/pedagogie.routes');
const vieScolaireRouter = require('./domains/04-vie-scolaire/vie-scolaire.routes');
const securiteRouter    = require('./domains/05-securite/securite.routes');
const syncRouter           = require('./domains/sync.routes');
const notificationsRouter  = require('./domains/notifications.routes');
const rgpdRouter           = require('./domains/02-acteurs/auth/rgpd.routes');
const { initPurgeWorker, stopPurgeWorker } = require('./workers/purge.worker');

// ── App ──────────────────────────────────────────────────────────
const app = express();

// ── Sécurité & parsing ──────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',')
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'],
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logs HTTP ───────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
  }));
}

// ── Alerte requêtes lentes ──────────────────────────────────────
const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_MS) || 2000;
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > SLOW_REQUEST_MS) {
      logger.warn('Requête lente', {
        method: req.method,
        url: req.originalUrl,
        duration_ms: duration,
        statusCode: res.statusCode,
        utilisateur_id: req.session?.utilisateur_id,
      });
    }
  });
  next();
});

// ── Documentation API (Swagger) — désactivée en production ──────
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'EcoleManager API — Documentation',
  }));
  app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));
} else {
  app.get('/api/docs', (req, res) => res.status(404).json({ succes: false, erreur: 'Not found' }));
  app.get('/api/docs.json', (req, res) => res.status(404).json({ succes: false, erreur: 'Not found' }));
}

// ── Health check (léger, pour load balancer) ────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    env: process.env.NODE_ENV,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── Middleware protection monitoring ────────────────────────────
function requireMonitoringToken(req, res, next) {
  const token = process.env.MONITORING_TOKEN;
  if (!token) {
    return res.status(403).json({
      succes: false,
      erreur: 'MONITORING_TOKEN non configuré — accès refusé',
      code: 'MONITORING_NOT_CONFIGURED',
    });
  }

  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${token}`) return next();

  return res.status(401).json({
    succes: false,
    erreur: 'Token monitoring requis',
    code: 'MONITORING_UNAUTHORIZED',
  });
}

// ── Health check profond (vérifie toutes les dépendances) ───────
app.get('/health/deep', requireMonitoringToken, async (req, res) => {
  const checks = {};
  let globalStatus = 'ok';

  // PostgreSQL
  try {
    const { getDB } = require('./infrastructure/database/pool');
    const start = Date.now();
    await getDB().raw('SELECT 1');
    checks.postgres = { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    checks.postgres = { status: 'error', message: err.message };
    globalStatus = 'degraded';
  }

  // Redis
  try {
    const { healthCheck: redisHealth } = require('./infrastructure/cache/redis');
    const start = Date.now();
    const result = await redisHealth();
    checks.redis = { ...result, latency_ms: Date.now() - start };
    if (result.status !== 'ok') globalStatus = 'degraded';
  } catch (err) {
    checks.redis = { status: 'error', message: err.message };
    globalStatus = 'degraded';
  }

  const statusCode = globalStatus === 'ok' ? 200 : 503;
  res.status(statusCode).json({
    status: globalStatus,
    version: process.env.npm_package_version || '1.0.0',
    uptime: Math.floor(process.uptime()),
    checks,
    timestamp: new Date().toISOString(),
  });
});

// ── Métriques applicatives ──────────────────────────────────────
app.get('/metrics', requireMonitoringToken, async (req, res) => {
  try {
    const { getDB } = require('./infrastructure/database/pool');
    const db = getDB();

    const [
      dbPool,
      sessionsActives,
      elevesActifs,
      etablissementsActifs,
    ] = await Promise.all([
      // Pool de connexions
      db.client.pool ? Promise.resolve({
        used: db.client.pool.numUsed(),
        free: db.client.pool.numFree(),
        pending: db.client.pool.numPendingAcquires(),
      }) : Promise.resolve(null),
      // Sessions actives
      db('sessions').where({ revoquee: false }).where('expire_at', '>', db.raw('NOW()')).count('id as count').first(),
      // Élèves inscrits actifs
      db('inscriptions').where({ statut: 'actif' }).count('id as count').first(),
      // Établissements actifs
      db('etablissements').where({ actif: true }).count('id as count').first(),
    ]);

    res.json({
      process: {
        uptime: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        memory_total_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      database: {
        pool: dbPool,
        sessions_actives: parseInt(sessionsActives?.count || 0),
        eleves_actifs: parseInt(elevesActifs?.count || 0),
        etablissements_actifs: parseInt(etablissementsActifs?.count || 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ── Routes API ──────────────────────────────────────────────────
const PREFIX = process.env.API_PREFIX || '/api/v1';

// ── Rate limiting global ─────────────────────────────────────────
const rateLimit = require('express-rate-limit');
const limiterGlobal = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_GLOBAL_MAX) || 100,
  message: { succes: false, erreur: 'Trop de requêtes — réessayez dans 1 minute', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(PREFIX, limiterGlobal);

app.use(PREFIX, setupRouter);
app.use(PREFIX, authRouter);
app.use(PREFIX, identitesRouter);
app.use(PREFIX, elevesRouter);
app.use(PREFIX, parentsRouter);
app.use(PREFIX, enseignantsRouter);
app.use(PREFIX, pedagogieRouter);
app.use(PREFIX, vieScolaireRouter);
app.use(PREFIX, securiteRouter);
app.use(PREFIX, syncRouter);
app.use(PREFIX, notificationsRouter);
app.use(PREFIX, rgpdRouter);

// ── Gestion des erreurs ─────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Démarrage ───────────────────────────────────────────────────
const { validateEnv } = require('./utils/env');

async function start() {
  try {
    validateEnv();

    await connectDB();
    logger.info('✓ PostgreSQL connecté');

    await connectRedis();
    logger.info('✓ Redis connecté');

    initPurgeWorker();
    logger.info('✓ Worker de purge initialisé');

    const PORT = parseInt(process.env.PORT) || 3000;
    app.listen(PORT, () => {
      logger.info(`✓ API démarrée sur http://localhost:${PORT}${PREFIX}`);
      logger.info(`✓ Documentation : http://localhost:${PORT}/api/docs`);
      logger.info(`  Environnement : ${process.env.NODE_ENV}`);

      // Démarrer la surveillance (production uniquement)
      if (process.env.NODE_ENV === 'production') {
        const { startMonitoring } = require('./infrastructure/monitoring/monitoring.service');
        startMonitoring();
      }
    });
  } catch (err) {
    logger.error('Échec du démarrage', { error: err.message });
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`${signal} reçu — arrêt propre`);
  try {
    const { getDB } = require('./infrastructure/database/pool');
    await getDB().destroy();
    logger.info('✓ PostgreSQL déconnecté');
  } catch { /* ignore */ }
  try {
    const { getRedis } = require('./infrastructure/cache/redis');
    await getRedis().quit();
    logger.info('✓ Redis déconnecté');
  } catch { /* ignore */ }
  try {
    const { stopMonitoring } = require('./infrastructure/monitoring/monitoring.service');
    stopMonitoring();
  } catch { /* ignore */ }
  try {
    stopPurgeWorker();
  } catch { /* ignore */ }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Promise non gérée', { reason });
});

start();

module.exports = app; // pour les tests
