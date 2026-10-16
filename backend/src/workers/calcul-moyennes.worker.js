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
const { connectRedis, getRedis, createBullMQConnection, invalidatePattern } = require('../infrastructure/cache/redis');
const { recalculerMoyennesClasse } = require('../domains/03-pedagogie/moyennes/calcul-moyennes.service');
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

  // La classe doit appartenir à l'établissement du job (même garde que POST /moyennes/calculer)
  const classe = await db('classes as c')
    .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
    .where({ 'c.id': classe_id, 'a.etablissement_id': etablissement_id })
    .first('c.id');
  if (!classe) {
    logger.warn('calcul-moyennes: classe introuvable pour cet établissement', { job_id: job.id, classe_id });
    return { skipped: true, reason: 'classe_introuvable', classe_id };
  }

  await job.updateProgress(10);

  // Le calcul lui-même est partagé avec POST /moyennes/calculer (une seule implémentation)
  const { nbCalculees, inscriptions, matieres } = await recalculerMoyennesClasse(db, { classe_id, periode_id, matiere_id });

  await job.updateProgress(100);

  if (!inscriptions.length) return { skipped: true, reason: 'aucune_inscription', classe_id };

  try { await invalidatePattern(`moyennes_classe:${classe_id}`); } catch { /* Redis indisponible : pas critique */ }

  const result = {
    classe_id,
    periode_id,
    nb_inscriptions: inscriptions.length,
    nb_matieres:     matieres.length,
    nb_moyennes:     nbCalculees,
  };

  logger.info('Moyennes calculées', result);
  return result;
}

// ── Exports (lot J, E5) ──────────────────────────────────────────
// Ajout uniquement pour permettre les tests unitaires de traiterCalcul
// séparément du câblage BullMQ (voir init() ci-dessous, inchangé).
module.exports = { traiterCalcul };

// ── Démarrage ────────────────────────────────────────────────────

async function init() {
  await connectDB();
  logger.info('calcul-moyennes: PostgreSQL connecté');

  await connectRedis();
  logger.info('calcul-moyennes: Redis connecté');

  const worker = new Worker('calcul-moyennes', traiterCalcul, {
    // BullMQ exige maxRetriesPerRequest: null : le client de cache (getRedis) fait échouer le démarrage
    // (« BullMQ: Your redis options maxRetriesPerRequest must be null ») — ce worker n'avait donc jamais pu tourner
    connection:  createBullMQConnection(),
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

// Seulement lancé comme programme (node …/calcul-moyennes.worker.js, ou fork du lanceur) : un simple require()
// — tests, import de traiterCalcul — ne doit pas ouvrir de connexions ni démarrer de Worker.
if (require.main === module) {
  init().catch(err => {
    logger.error('calcul-moyennes: échec démarrage', { error: err.message });
    process.exit(1);
  });
}
