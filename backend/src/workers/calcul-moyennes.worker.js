'use strict';

/**
 * Worker BullMQ — calcul des moyennes.
 *
 * Payload attendu :
 *   { classe_id, periode_id, etablissement_id }
 *   ou
 *   { classe_id, matiere_id, evaluation_id, etablissement_id }
 *   (periode_id déduit depuis evaluation_id si absent)
 *
 * Séquence :
 *   1. Inscriptions actives de la classe
 *   2. Matières affectées à la classe (ou matiere_id unique si fourni)
 *   3. calculer_moyenne_matiere(inscription_id, matiere_id, periode_id) × N
 *   4. calculer_moyenne_generale(inscription_id, periode_id) × N
 *
 * Mode PM2 : fork obligatoire.
 * Concurrence : WORKER_MOYENNES_CONCURRENCE (défaut 2).
 */

require('dotenv').config();

const { Worker }                 = require('bullmq');
const { connectDB, getDB }       = require('../infrastructure/database/pool');
const { connectRedis, getRedis } = require('../infrastructure/cache/redis');
const logger                     = require('../utils/logger');

const CONCURRENCE = parseInt(process.env.WORKER_MOYENNES_CONCURRENCE) || 2;

// ── Logique métier ───────────────────────────────────────────────

async function traiterCalcul(job) {
  const db = getDB();
  const { classe_id, matiere_id, evaluation_id, etablissement_id } = job.data;
  let { periode_id } = job.data;

  // Dériver periode_id depuis evaluation_id si absent
  if (!periode_id && evaluation_id) {
    const evalRow = await db('evaluations as ev')
      .join('periodes as p', 'p.id', 'ev.periode_id')
      .where({ 'ev.id': evaluation_id })
      .first('p.id as periode_id');

    if (!evalRow) {
      logger.warn('calcul-moyennes: évaluation introuvable', { evaluation_id });
      return { skipped: true, reason: 'evaluation_introuvable' };
    }
    periode_id = evalRow.periode_id;
  }

  if (!periode_id) {
    logger.warn('calcul-moyennes: periode_id manquant', { job_id: job.id });
    return { skipped: true, reason: 'periode_id_manquant' };
  }

  await job.updateProgress(5);

  // 1. Inscriptions actives
  const inscriptions = await db('inscriptions')
    .where({ classe_id, statut: 'actif' })
    .select('id', 'eleve_id');

  if (!inscriptions.length) {
    return { skipped: true, reason: 'aucune_inscription', classe_id };
  }

  // 2. Matières à calculer
  let matieres;
  if (matiere_id) {
    matieres = [{ matiere_id }];
  } else {
    const affectations = await db('affectations')
      .where({ classe_id, etablissement_id })
      .distinct('matiere_id')
      .select('matiere_id');
    matieres = affectations;
  }

  const nbInsc     = inscriptions.length;
  const nbMatieres = matieres.length;
  const totalSteps = nbInsc * nbMatieres + nbInsc;
  let done = 0;

  await job.updateProgress(10);

  // 3. Moyennes par matière (10–90 %)
  for (const { matiere_id: mid } of matieres) {
    for (const insc of inscriptions) {
      try {
        await db.raw('SELECT calculer_moyenne_matiere(?, ?, ?)', [insc.id, mid, periode_id]);
      } catch (err) {
        logger.warn('calcul-moyennes: erreur matière', {
          inscription_id: insc.id, matiere_id: mid, periode_id, error: err.message,
        });
      }
      done++;
      await job.updateProgress(10 + Math.round((done / totalSteps) * 80));
    }
  }

  // 4. Moyennes générales (90–100 %)
  for (const insc of inscriptions) {
    try {
      await db.raw('SELECT calculer_moyenne_generale(?, ?)', [insc.id, periode_id]);
    } catch (err) {
      logger.warn('calcul-moyennes: erreur générale', {
        inscription_id: insc.id, periode_id, error: err.message,
      });
    }
    done++;
    const pctGenerales = (done - nbInsc * nbMatieres) / nbInsc;
    await job.updateProgress(90 + Math.round(pctGenerales * 10));
  }

  await job.updateProgress(100);

  const result = {
    classe_id,
    periode_id,
    nb_inscriptions: nbInsc,
    nb_matieres:     nbMatieres,
  };

  logger.info('Moyennes calculées', result);
  return result;
}

// ── Démarrage ────────────────────────────────────────────────────

async function init() {
  await connectDB();
  logger.info('calcul-moyennes: PostgreSQL connecté');

  await connectRedis();
  logger.info('calcul-moyennes: Redis connecté');

  const worker = new Worker('calcul-moyennes', traiterCalcul, {
    connection:  getRedis(),
    concurrency: CONCURRENCE,
  });

  worker.on('completed', (job, result) => {
    logger.info('calcul-moyennes: job terminé', { job_id: job.id, ...result });
  });

  worker.on('failed', (job, err) => {
    logger.error('calcul-moyennes: job échoué', {
      job_id:  job?.id,
      payload: job?.data,
      error:   err.message,
    });
  });

  logger.info(`Worker calcul-moyennes démarré (concurrence=${CONCURRENCE})`);

  // Graceful shutdown
  async function shutdown(signal) {
    logger.info(`calcul-moyennes: ${signal} — arrêt propre`);
    await worker.close();
    try { await getRedis().quit(); } catch { /* ignore */ }
    try { await getDB().destroy(); } catch { /* ignore */ }
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

init().catch(err => {
  logger.error('calcul-moyennes: échec démarrage', { error: err.message });
  process.exit(1);
});
