'use strict';

/**
 * Worker de génération de bulletins PDF.
 * Consomme la queue 'generation-bulletins' (BullMQ).
 *
 * Flux par job :
 *   1. Trouver tous les moyennes_generales (bulletin_genere=true, bulletin_url IS NULL)
 *      pour la (classe_id, periode_id) du job.
 *   2. Pour chaque bulletin : charger les données complètes depuis la DB.
 *   3. Générer le HTML via bulletin-template.js.
 *   4. Rendre en PDF via Puppeteer.
 *   5. Uploader sur S3/R2 via storage.service.js.
 *   6. Mettre à jour moyennes_generales.bulletin_url.
 *
 * Démarrage : npm run worker:bulletins
 */

require('dotenv').config();

const puppeteer  = require('puppeteer');
const { Worker } = require('bullmq');

const { createBullMQConnection } = require('../infrastructure/cache/redis');
const { getDB, connectDB }       = require('../infrastructure/database/pool');
const { connectRedis }           = require('../infrastructure/cache/redis');
const { uploadFichier }          = require('../infrastructure/storage/storage.service');
const { genererHTMLBulletin }    = require('../templates/bulletin-template');
const logger                     = require('../utils/logger');

const QUEUE_NAME  = 'generation-bulletins';
const CONCURRENCE = parseInt(process.env.WORKER_BULLETINS_CONCURRENCE) || 1;

// ── Chargement des données complètes d'un bulletin ──────────────

async function getDonneesBulletin(db, bulletinId, etablissementId) {
  const bulletin = await db('moyennes_generales as mg')
    .join('inscriptions as i',      'i.id',  'mg.inscription_id')
    .join('eleves as el',           'el.id', 'i.eleve_id')
    .join('utilisateurs as u',      'u.id',  'el.utilisateur_id')
    .join('classes as c',           'c.id',  'i.classe_id')
    .join('niveaux as n',           'n.id',  'c.niveau_id')
    .join('periodes as p',          'p.id',  'mg.periode_id')
    .join('annees_scolaires as a',  'a.id',  'p.annee_scolaire_id')
    .where({ 'mg.id': bulletinId, 'a.etablissement_id': etablissementId })
    .first(
      'mg.*', 'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre', 'el.matricule',
      db.raw("CONCAT(n.nom, ' ', c.nom) as classe"), 'n.nom as niveau',
      'p.numero as trimestre', 'p.libelle as periode', 'a.libelle as annee_scolaire',
      'i.id as inscription_id'
    );

  if (!bulletin) return null;

  const [matieres, conduite, etablissement] = await Promise.all([
    db('moyennes_matieres as mm')
      .join('matieres as m', 'm.id', 'mm.matiere_id')
      .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
      .where({ 'mm.inscription_id': bulletin.inscription_id, 'mm.periode_id': bulletin.periode_id })
      .orderBy(['dm.ordre', 'm.nom'])
      .select(
        'm.nom as matiere', 'm.code as matiere_code',
        'dm.nom as discipline',
        'mm.moyenne', 'mm.coefficient', 'mm.points',
        'mm.somme_notes_devoirs', 'mm.nb_devoirs_comptes',
        'mm.note_composition',
        'mm.rang_dans_classe', 'mm.rang_sur',
        'mm.appreciation_enseignant', 'mm.est_complete'
      ),
    db('notes_conduite')
      .where({ inscription_id: bulletin.inscription_id, periode_id: bulletin.periode_id })
      .first('valeur', 'appreciation', 'commentaire'),
    db('etablissements')
      .where({ id: etablissementId })
      .first('nom', 'code_officiel', 'ville', 'pays', 'telephone', 'logo_url'),
  ]);

  return {
    etablissement,
    eleve: {
      nom: bulletin.nom, prenom: bulletin.prenom,
      date_naissance: bulletin.date_naissance, genre: bulletin.genre,
      matricule: bulletin.matricule, classe: bulletin.classe, niveau: bulletin.niveau,
    },
    periode: {
      trimestre:      bulletin.trimestre,
      libelle:        bulletin.periode,
      annee_scolaire: bulletin.annee_scolaire,
    },
    matieres,
    conduite: conduite || null,
    resultat: {
      total_points:         bulletin.total_points,
      total_coefficients:   bulletin.total_coefficients,
      moyenne_generale:     bulletin.moyenne_generale,
      rang:                 bulletin.rang,
      rang_sur:             bulletin.rang_sur,
      mention:              bulletin.mention,
      decision_conseil:     bulletin.decision_conseil,
      appreciation_conseil: bulletin.appreciation_conseil,
    },
    absences: {
      justifiees:   bulletin.nb_absences_justifiees,
      injustifiees: bulletin.nb_absences_injustifiees,
      retards:      bulletin.nb_retards,
    },
  };
}

// ── Traitement d'un job ──────────────────────────────────────────

async function traiterJob(job) {
  const { classe_id, periode_id, etablissement_id } = job.data;

  logger.info('[BulletinsPDF] Job démarré', { jobId: job.id, classe_id, periode_id });

  const db = getDB();

  const aPDF = await db('moyennes_generales as mg')
    .join('inscriptions as i', 'i.id', 'mg.inscription_id')
    .where({ 'i.classe_id': classe_id, 'mg.periode_id': periode_id, 'mg.bulletin_genere': true })
    .whereNull('mg.bulletin_url')
    .select('mg.id');

  if (aPDF.length === 0) {
    logger.info('[BulletinsPDF] Aucun bulletin en attente', { classe_id, periode_id });
    return { generes: 0, echecs: 0 };
  }

  logger.info(`[BulletinsPDF] ${aPDF.length} bulletin(s) à rendre`, { classe_id });

  let browser;
  let generes = 0;
  let echecs  = 0;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    for (let idx = 0; idx < aPDF.length; idx++) {
      const b = aPDF[idx];
      await job.updateProgress(Math.round((idx / aPDF.length) * 100));

      try {
        const donnees = await getDonneesBulletin(db, b.id, etablissement_id);
        if (!donnees) {
          logger.warn('[BulletinsPDF] Données introuvables', { bulletinId: b.id });
          echecs++;
          continue;
        }

        const html = genererHTMLBulletin(donnees);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
          format:          'A4',
          printBackground: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        });

        await page.close();

        const key = `bulletins/${etablissement_id}/${periode_id}/${b.id}.pdf`;
        const url = await uploadFichier(key, Buffer.from(pdfBuffer), 'application/pdf');

        await db('moyennes_generales')
          .where('id', b.id)
          .update({ bulletin_url: url || `pending:${b.id}`, updated_at: db.raw('NOW()') });

        logger.info('[BulletinsPDF] Bulletin rendu', { bulletinId: b.id, hasUrl: Boolean(url) });
        generes++;

      } catch (err) {
        logger.error('[BulletinsPDF] Erreur bulletin individuel', { bulletinId: b.id, error: err.message });
        echecs++;
      }
    }

  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  logger.info('[BulletinsPDF] Job terminé', { jobId: job.id, generes, echecs });
  return { generes, echecs };
}

// ── Démarrage ────────────────────────────────────────────────────

async function init() {
  await connectDB();
  await connectRedis();
  logger.info('[BulletinsPDF] Worker démarré');
}

init().then(() => {
  const worker = new Worker(QUEUE_NAME, traiterJob, {
    connection:  createBullMQConnection(),
    concurrency: CONCURRENCE,
  });

  worker.on('completed', (job, result) => {
    logger.info('[BulletinsPDF] Complété', { jobId: job.id, ...result });
  });

  worker.on('progress', (job, progress) => {
    logger.debug('[BulletinsPDF] Progression', { jobId: job.id, progress });
  });

  worker.on('failed', (job, err) => {
    logger.error('[BulletinsPDF] Échoué', {
      jobId:      job?.id,
      tentatives: job?.attemptsMade,
      error:      err.message,
    });
  });

  logger.info(`[BulletinsPDF] En écoute sur "${QUEUE_NAME}" (concurrence: ${CONCURRENCE})`);
}).catch((err) => {
  logger.error('[BulletinsPDF] Démarrage échoué', { error: err.message });
  process.exit(1);
});
