'use strict';

const http   = require('http');
const logger = require('../../utils/logger');
const { envoyerSMS } = require('../notifications/sms.service');

// Cooldown anti-spam : stocke le timestamp de la dernière alerte par type
const dernierAlerteAt = {};

/**
 * Envoie une alerte SMS si le cooldown est écoulé.
 * @param {string} type - Identifiant du type d'alerte (ex: 'postgres_down')
 * @param {string} message - Message SMS à envoyer
 */
async function envoyerAlerte(type, message) {
  const phone    = process.env.ADMIN_PHONE;
  const cooldown = parseInt(process.env.MONITORING_COOLDOWN_MS) || 900000; // 15 min

  if (!phone) {
    logger.warn('MONITORING: ADMIN_PHONE non configuré — alerte non envoyée', { type });
    return;
  }

  const maintenant = Date.now();
  const derniere   = dernierAlerteAt[type] || 0;

  if (maintenant - derniere < cooldown) {
    logger.debug('MONITORING: alerte en cooldown', { type, restant_ms: cooldown - (maintenant - derniere) });
    return;
  }

  dernierAlerteAt[type] = maintenant;

  try {
    await envoyerSMS(phone, `[EcoleManager] ${message}`);
    logger.info('MONITORING: alerte SMS envoyée', { type, phone });
  } catch (err) {
    logger.error('MONITORING: échec envoi alerte SMS', { type, error: err.message });
  }
}

/**
 * Effectue un health check interne sur /health/deep.
 * Retourne { status: 'ok'|'degraded'|'error', checks: {} }
 */
async function verifierSante() {
  return new Promise((resolve) => {
    const token = process.env.MONITORING_TOKEN || '';
    const port  = parseInt(process.env.PORT) || 3000;

    const options = {
      hostname: 'localhost',
      port,
      path:    '/health/deep',
      method:  'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ status: 'error', checks: {} });
        }
      });
    });

    req.on('error',   () => resolve({ status: 'error',   checks: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'error', checks: {} }); });
    req.end();
  });
}

let intervalId = null;

/**
 * Démarre la surveillance périodique.
 * À appeler une seule fois au démarrage (NODE_ENV === 'production').
 */
function startMonitoring() {
  const interval = parseInt(process.env.MONITORING_INTERVAL_MS) || 120000; // 2 min

  logger.info(`MONITORING: démarré (intervalle ${interval / 1000}s)`);

  intervalId = setInterval(async () => {
    try {
      const sante = await verifierSante();

      if (sante.status === 'error') {
        logger.error('MONITORING: API injoignable');
        await envoyerAlerte('api_down', 'API EcoleManager injoignable. Vérifiez le serveur immédiatement.');
        return;
      }

      if (sante.status === 'degraded') {
        const problemes = Object.entries(sante.checks || {})
          .filter(([, v]) => v.status !== 'ok')
          .map(([k]) => k)
          .join(', ');

        logger.warn('MONITORING: état dégradé', { checks: sante.checks });

        if (sante.checks?.postgres?.status !== 'ok') {
          await envoyerAlerte('postgres_down', `PostgreSQL indisponible. Problèmes: ${problemes}`);
        }

        if (sante.checks?.redis?.status !== 'ok') {
          await envoyerAlerte('redis_down', `Redis indisponible. Problèmes: ${problemes}`);
        }
      }
    } catch (err) {
      logger.error('MONITORING: erreur lors de la vérification', { error: err.message });
    }
  }, interval);
}

function stopMonitoring() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('MONITORING: arrêté');
  }
}

module.exports = { startMonitoring, stopMonitoring };
