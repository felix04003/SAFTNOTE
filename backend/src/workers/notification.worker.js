'use strict';

/**
 * Worker de notifications SMS/WhatsApp.
 * Traite les tâches de la queue 'notifications'.
 *
 * Démarrage : npm run worker:notif
 * En production : PM2 ou service systemd distinct du processus API
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const { createBullMQConnection } = require('../infrastructure/cache/redis');
const { getDB, connectDB }       = require('../infrastructure/database/pool');
const { connectRedis }           = require('../infrastructure/cache/redis');
const { envoyerSMS }        = require('../infrastructure/notifications/sms.service');
const { envoyerTemplate }   = require('../infrastructure/notifications/whatsapp.service');
const logger                = require('../utils/logger');

// ── Démarrage connexions ─────────────────────────────────────────
async function init() {
  await connectDB();
  await connectRedis();
  logger.info('Worker notifications démarré');
}

// ── Templates de message SMS ────────────────────────────────────
const TEMPLATES_SMS = {
  absence: (data) =>
    `[${data.etablissement}] ABSENCE — ${data.prenom} ${data.nom} était absent(e) ce ${data.date} en ${data.matiere}. Contactez l'établissement si justifié.`,

  retard: (data) =>
    `[${data.etablissement}] RETARD — ${data.prenom} ${data.nom} est arrivé(e) avec ${data.minutes} min de retard le ${data.date} en ${data.matiere}.`,

  nouvelle_note: (data) =>
    `[${data.etablissement}] NOUVELLE NOTE — ${data.prenom} a obtenu ${data.note}/20 en ${data.matiere} (${data.type}). Consultez l'application pour les détails.`,

  bulletin_disponible: (data) =>
    `[${data.etablissement}] BULLETIN — Le bulletin de ${data.prenom} pour le ${data.trimestre} est disponible. Moyenne: ${data.moyenne}/20, Rang: ${data.rang}/${data.rang_sur}.`,

  convocation: (data) =>
    `[${data.etablissement}] CONVOCATION — Vous êtes convoqué(e) le ${data.date} à ${data.heure} pour ${data.motif}. Contacter l'établissement pour confirmer.`,

  sanction: (data) =>
    `[${data.etablissement}] INFORMATION — Une sanction a été prononcée pour ${data.prenom}: ${data.type_sanction}. Contactez l'établissement pour plus d'informations.`,
};

// ── Processeur principal ─────────────────────────────────────────
async function traiterNotification(job) {
  const { type_notif, inscription_id } = job.data;
  const db = getDB();

  logger.debug('Traitement notification', { type: type_notif, inscription_id });

  try {
    // 1. Récupérer les infos de l'élève et son parent principal
    const info = await db('inscriptions as i')
      .join('utilisateurs as eleve', 'eleve.id', 'i.eleve_id')
      .join('parents_eleves as pe', 'pe.eleve_id', 'i.eleve_id')
      .join('utilisateurs as parent', 'parent.id', 'pe.parent_id')
      .join('notifications_preferences as np', 'np.utilisateur_id', 'parent.id')
      .join('etablissements as e', 'e.id', 'parent.etablissement_id')
      .where({
        'i.id':                    inscription_id,
        'pe.est_contact_principal': true,
        'parent.actif':            true,
      })
      .first(
        'eleve.nom', 'eleve.prenom',
        'parent.id as parent_id',
        'parent.telephone',
        'np.canal_prefere', 'np.a_whatsapp',
        'np.notif_absences', 'np.notif_notes', 'np.notif_bulletins',
        'np.heure_debut_notif', 'np.heure_fin_notif',
        'e.nom as etablissement',
      );

    if (!info) {
      logger.warn('Parent introuvable pour notification', { inscription_id });
      return { statut: 'skip', raison: 'parent_introuvable' };
    }

    // 2. Vérifier les préférences de notification
    if (!doitEnvoyerNotification(type_notif, info)) {
      return { statut: 'skip', raison: 'preferences_desactivees' };
    }

    // 3. Vérifier la plage horaire
    if (!dansPlageHoraire(info.heure_debut_notif, info.heure_fin_notif)) {
      // Re-scheduler pour le lendemain matin
      const demain = new Date();
      demain.setDate(demain.getDate() + 1);
      demain.setHours(parseInt(info.heure_debut_notif?.split(':')[0]) || 7, 0, 0, 0);
      await job.moveToDelayed(demain.getTime());
      return { statut: 'delayed', raison: 'hors_plage_horaire' };
    }

    // 4. Construire le message selon le type
    const contexte = await getContexteNotification(db, type_notif, job.data, info);
    if (!contexte) return { statut: 'skip', raison: 'contexte_introuvable' };

    // 5. Envoyer via le canal préféré
    let messageId = null;
    const canal = info.a_whatsapp && info.canal_prefere === 'whatsapp' ? 'whatsapp' : 'sms';

    if (canal === 'whatsapp') {
      try {
        const result = await envoyerTemplate(info.telephone, type_notif, contexte.parametres);
        messageId = result.messageId;
      } catch (waErr) {
        // Fallback vers SMS
        logger.warn('WhatsApp échoué, fallback SMS', { error: waErr.message });
        const message = TEMPLATES_SMS[type_notif]?.(contexte.data) || contexte.data.message_fallback;
        const result = await envoyerSMS(info.telephone, message);
        messageId = result.messageIds?.[0];
      }
    } else {
      const message = TEMPLATES_SMS[type_notif]?.(contexte.data) || contexte.data.message_fallback;
      const result = await envoyerSMS(info.telephone, message);
      messageId = result.messageIds?.[0];
    }

    // 6. Journaliser
    await db('journal_notifications').insert({
      destinataire_id:    info.parent_id,
      eleve_id:           db.raw('(SELECT eleve_id FROM inscriptions WHERE id = ?)', [inscription_id]),
      canal,
      categorie:          getCategorie(type_notif),
      type_notif,
      telephone:          info.telephone,
      statut:             'envoye',
      provider_message_id: messageId,
      envoye_at:          db.raw('NOW()'),
    });

    logger.info('Notification envoyée', {
      type:       type_notif,
      canal,
      parent_id:  info.parent_id,
      message_id: messageId,
    });

    return { statut: 'envoye', canal, message_id: messageId };

  } catch (err) {
    logger.error('Erreur traitement notification', {
      type: type_notif,
      error: err.message,
      job_id: job.id,
    });

    // Journaliser l'échec
    await db('journal_notifications').insert({
      destinataire_id: null,
      type_notif,
      statut:          'echec',
      code_erreur:     err.message?.slice(0, 100),
    }).catch(() => {}); // Ne pas planter sur une erreur de log

    throw err; // BullMQ gère le retry
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function doitEnvoyerNotification(type_notif, preferences) {
  const URGENCES = ['convocation', 'sanction', 'conseil_discipline'];
  if (URGENCES.includes(type_notif)) return true; // Toujours envoyer

  const MAP = {
    absence:     preferences.notif_absences,
    retard:      preferences.notif_absences,
    nouvelle_note: preferences.notif_notes,
    bulletin_disponible: preferences.notif_bulletins,
  };
  return MAP[type_notif] !== false;
}

function dansPlageHoraire(debut = '07:00', fin = '21:00') {
  const maintenant = new Date();
  const heureActuelle = maintenant.getHours() * 60 + maintenant.getMinutes();
  const heureDebut = parseHeure(debut);
  const heureFin   = parseHeure(fin);
  return heureActuelle >= heureDebut && heureActuelle <= heureFin;
}

function parseHeure(str = '07:00') {
  const [h, m] = str.split(':').map(Number);
  return (h || 7) * 60 + (m || 0);
}

function getCategorie(type) {
  if (['convocation', 'sanction', 'absence', 'retard'].includes(type)) return 'urgence';
  if (['nouvelle_note', 'retard'].includes(type)) return 'quotidien';
  if (['bulletin_disponible'].includes(type)) return 'document';
  return 'programme';
}

async function getContexteNotification(db, type, jobData, info) {
  // Construit les paramètres selon le type de notification
  if (type === 'absence' || type === 'retard') {
    const appel = await db('appels as a')
      .join('emplois_du_temps as edt', 'edt.id', 'a.emploi_du_temps_id')
      .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .where({ 'a.id': jobData.appel_id })
      .first('m.nom as matiere', 'a.date_cours');

    if (!appel) return null;

    const date = new Date(appel.date_cours).toLocaleDateString('fr-FR');
    return {
      parametres: [info.prenom, info.nom, date, appel.matiere],
      data: {
        prenom: info.prenom, nom: info.nom,
        date, matiere: appel.matiere,
        minutes: jobData.minutes_retard || 0,
        etablissement: info.etablissement,
      },
    };
  }

  if (type === 'nouvelle_note') {
    const ev = await db('evaluations as e')
      .join('affectations_enseignants as ae', 'ae.id', 'e.affectation_id')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .join('notes as n', 'n.evaluation_id', 'e.id')
      .join('inscriptions as i', 'i.id', 'n.inscription_id')
      .where({ 'e.id': jobData.evaluation_id, 'i.id': jobData.inscription_id })
      .first('m.nom as matiere', 'n.valeur', 'e.type');

    if (!ev) return null;
    return {
      parametres: [info.prenom, String(ev.valeur), ev.matiere, ev.type],
      data: { prenom: info.prenom, note: ev.valeur, matiere: ev.matiere, type: ev.type, etablissement: info.etablissement },
    };
  }

  return null;
}

// ── Démarrage du worker ──────────────────────────────────────────
init().then(() => {
  const worker = new Worker(
    'notifications',
    traiterNotification,
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
