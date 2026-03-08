'use strict';
// Worker de calcul des moyennes
// Appelle calculer_moyenne_matiere() et met à jour moyennes_matieres + moyennes_generales
require('dotenv').config();
const { Worker }   = require('bullmq');
const { connectDB, getDB } = require('../infrastructure/database/pool');
const { connectRedis, getRedis } = require('../infrastructure/cache/redis');
const logger = require('../utils/logger');

async function init() { await connectDB(); await connectRedis(); }

async function traiterCalcul(job) {
  const db = getDB();
  const { classe_id, matiere_id, evaluation_id, etablissement_id } = job.data;
  // Récupérer toutes les inscriptions actives de la classe
  const inscriptions = await db('inscriptions')
    .where({ classe_id, statut: 'actif' })
    .select('id', 'eleve_id');
  const periode = await db('evaluations as ev')
    .join('periodes as p', 'p.id', 'ev.periode_id')
    .where({ 'ev.id': evaluation_id })
    .first('p.id as periode_id');
  if (!periode) return;
  // Appeler la fonction PL/pgSQL pour chaque inscription
  for (const insc of inscriptions) {
    await db.raw('SELECT calculer_moyenne_matiere(?, ?, ?)', [insc.id, matiere_id, periode.periode_id]);
  }
  logger.info('Moyennes recalculées', { classe_id, matiere_id, nb: inscriptions.length });
}

init().then(() => {
  const worker = new Worker('calcul-moyennes', traiterCalcul, { connection: getRedis(), concurrency: 2 });
  worker.on('failed', (job, err) => logger.error('Calcul moyennes échoué', { error: err.message }));
  logger.info('Worker calcul-moyennes démarré');
});
