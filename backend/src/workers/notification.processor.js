'use strict';

/**
 * Traitement des notifications SMS/WhatsApp (logique pure, sans câblage BullMQ).
 *
 * Séparé de notification.worker.js pour pouvoir être exécuté contre une vraie
 * base dans les tests d'intégration : le worker, lui, démarre une connexion
 * Redis/BullMQ dès qu'on le charge.
 */

const pool                  = require('../infrastructure/database/pool');
const { envoyerSMS }        = require('../infrastructure/notifications/sms.service');
const { envoyerTemplate }   = require('../infrastructure/notifications/whatsapp.service');
const logger                = require('../utils/logger');
const { consommationMois, decision, alerterSiSeuilFranchi } = require('../infrastructure/notifications/plafond-sms');

const getDB = () => pool.getDB();

// ── Templates de message SMS ────────────────────────────────────
// Règle de coût : rester dans l'alphabet SMS de base (pas de tiret long « — »,
// pas de « ê î ô û » ni d'apostrophe typographique), sinon le message passe en
// UCS-2 (70 car./segment) et coûte 2 à 3 SMS. Garanti par
// tests/workers/sms-gabarits.test.js ; envoyerSMS convertit de toute façon.
const TEMPLATES_SMS = {
  absence: (data) =>
    `[${data.etablissement}] ABSENCE : ${data.prenom} ${data.nom} était absent(e) ce ${data.date} en ${data.matiere}. Contactez l'établissement si justifié.`,

  retard: (data) =>
    `[${data.etablissement}] RETARD : ${data.prenom} ${data.nom} est arrivé(e) avec ${data.minutes} min de retard le ${data.date} en ${data.matiere}.`,

  nouvelle_note: (data) =>
    `[${data.etablissement}] NOUVELLE NOTE : ${data.prenom} a obtenu ${data.note}/20 en ${data.matiere} (${data.type}). Consultez l'application pour les détails.`,

  bulletin_disponible: (data) =>
    `[${data.etablissement}] BULLETIN : le bulletin de ${data.prenom} pour le ${data.trimestre} est disponible. Moyenne: ${data.moyenne}/20, Rang: ${data.rang}/${data.rang_sur}.`,

  convocation: (data) =>
    `[${data.etablissement}] CONVOCATION : présence demandée le ${data.date} à ${data.heure} pour ${data.motif}. Merci de confirmer auprès de l'établissement.`,

  sanction: (data) =>
    `[${data.etablissement}] INFORMATION : une sanction a été prononcée pour ${data.prenom}: ${data.type_sanction}. Contactez l'établissement pour plus d'informations.`,
};

// ── Processeur principal ─────────────────────────────────────────
async function traiterNotification(job) {
  const { type_notif, inscription_id } = job.data;
  const db = getDB();

  logger.debug('Traitement notification', { type: type_notif, inscription_id });

  let info = null;
  try {
    // 1. Récupérer les infos de l'élève et son parent principal
    //    inscriptions.eleve_id référence eleves.id (pas utilisateurs.id) : le nom
    //    de l'élève passe par eleves.utilisateur_id. Les préférences sont en
    //    LEFT JOIN : un parent sans ligne notifications_preferences (compte
    //    existant réutilisé comme parent) reçoit les valeurs par défaut.
    info = await db('inscriptions as i')
      .join('eleves as el', 'el.id', 'i.eleve_id')
      .join('utilisateurs as eleve', 'eleve.id', 'el.utilisateur_id')
      .join('parents_eleves as pe', 'pe.eleve_id', 'i.eleve_id')
      .join('utilisateurs as parent', 'parent.id', 'pe.parent_id')
      .leftJoin('notifications_preferences as np', 'np.utilisateur_id', 'parent.id')
      .join('etablissements as e', 'e.id', 'parent.etablissement_id')
      .where({
        'i.id':                    inscription_id,
        'pe.est_contact_principal': true,
        'parent.actif':            true,
      })
      .first(
        'eleve.nom', 'eleve.prenom',
        'el.id as eleve_id',
        'parent.id as parent_id',
        'parent.etablissement_id',
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
    if (!info.telephone) {
      logger.warn('Parent sans numéro de téléphone', { inscription_id, parent_id: info.parent_id });
      return { statut: 'skip', raison: 'parent_sans_telephone' };
    }

    // 2. Vérifier les préférences de notification
    if (!doitEnvoyerNotification(type_notif, info)) {
      return { statut: 'skip', raison: 'preferences_desactivees' };
    }

    // 3. Vérifier la plage horaire
    if (!dansPlageHoraire(info.heure_debut_notif ?? undefined, info.heure_fin_notif ?? undefined)) {
      // Le report lui-même (job.moveToDelayed + DelayedError) est fait par le
      // câblage BullMQ du worker, qui détient le jeton du job : ici on décide
      // seulement QUAND reprendre.
      return {
        statut: 'delayed', raison: 'hors_plage_horaire',
        reprendre_a: prochaineOuverture(info.heure_debut_notif ?? undefined),
      };
    }

    // 4. Construire le message selon le type
    const contexte = await getContexteNotification(db, type_notif, job.data, info);
    if (!contexte) return { statut: 'skip', raison: 'contexte_introuvable' };

    // 5. Envoyer via le canal préféré
    let messageId = null;
    let canal = info.a_whatsapp && info.canal_prefere === 'whatsapp' ? 'whatsapp' : 'sms';
    let segments = 1;
    let consoAvant = null;

    // Envoi SMS soumis au plafond mensuel de l'établissement (migration 023).
    // Retourne { bloque } sans rien envoyer si le plafond interdit ce message.
    const envoyerSmsPlafonne = async () => {
      consoAvant = await consommationMois(db, info.etablissement_id);
      const verdict = decision(consoAvant, getCategorie(type_notif));
      if (!verdict.autorise) return { bloque: verdict.raison };
      const message = TEMPLATES_SMS[type_notif]?.(contexte.data) || contexte.data.message_fallback;
      const result = await envoyerSMS(info.telephone, message);
      messageId = result.messageIds?.[0];
      segments = result.segments || 1;
      return {};
    };

    let envoi = {};
    if (canal === 'whatsapp') {
      try {
        const result = await envoyerTemplate(info.telephone, type_notif, contexte.parametres);
        messageId = result.messageId;
      } catch (waErr) {
        // Fallback vers SMS (journalisé et compté comme SMS, pas comme WhatsApp)
        logger.warn('WhatsApp échoué, fallback SMS', { error: waErr.message });
        canal = 'sms';
        envoi = await envoyerSmsPlafonne();
      }
    } else {
      envoi = await envoyerSmsPlafonne();
    }

    if (envoi.bloque) {
      // Rien n'est parti : tracer pour que le directeur sache ce qui n'a pas été envoyé
      logger.warn('Notification SMS bloquée par le plafond mensuel', {
        type: type_notif, etablissement_id: info.etablissement_id, raison: envoi.bloque,
        utilises: consoAvant.utilises, plafond: consoAvant.plafond,
      });
      await db('journal_notifications').insert({
        etablissement_id: info.etablissement_id,
        destinataire_id:  info.parent_id,
        eleve_id:         info.eleve_id,
        canal:            'sms',
        categorie:        getCategorie(type_notif),
        type_notif,
        telephone:        info.telephone,
        statut:           'annule',
        code_erreur:      'PLAFOND_SMS',
        segments:         0,
      }).catch((e) => logger.warn('Notification bloquée non journalisée', { error: e.message }));
      return { statut: 'skip', raison: envoi.bloque };
    }

    // 6. Journaliser. Le message est DÉJÀ parti : une erreur ici ne doit surtout
    //    pas faire échouer le job (BullMQ le rejouerait et renverrait — donc
    //    refacturerait — le SMS). On trace l'erreur et on termine normalement.
    try {
      await db('journal_notifications').insert({
        etablissement_id:   info.etablissement_id,
        destinataire_id:    info.parent_id,
        eleve_id:           info.eleve_id,
        canal,
        categorie:          getCategorie(type_notif),
        type_notif,
        telephone:          info.telephone,
        statut:             'envoye',
        provider_message_id: messageId,
        segments:           canal === 'sms' ? segments : 1,
        envoye_at:          db.raw('NOW()'),
      });
    } catch (journalErr) {
      logger.error('Journal de notification non enregistré (message déjà envoyé)', {
        type: type_notif, parent_id: info.parent_id, message_id: messageId, error: journalErr.message,
      });
    }

    // Prévenir le directeur si cet envoi fait franchir 80 % ou 100 % du plafond
    // (best-effort : une erreur ici ne doit jamais faire rejouer le job).
    if (canal === 'sms' && consoAvant) {
      try {
        await alerterSiSeuilFranchi(
          db, info.etablissement_id, { ...consoAvant, utilises: consoAvant.utilises + segments }, { envoyerSMS });
      } catch (alerteErr) {
        logger.warn('Alerte de plafond SMS en erreur', { error: alerteErr.message });
      }
    }

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

    // Journaliser l'échec (seulement si le destinataire est connu : la table
    // exige établissement, destinataire, canal et catégorie)
    if (info) {
      await db('journal_notifications').insert({
        etablissement_id: info.etablissement_id,
        destinataire_id:  info.parent_id,
        eleve_id:         info.eleve_id,
        canal:            'sms',
        categorie:        getCategorie(type_notif),
        type_notif,
        telephone:        info.telephone,
        statut:           'echec',
        code_erreur:      String(err.message || '').slice(0, 50),
      }).catch((e) => logger.warn('Échec de notification non journalisé', { error: e.message }));
    }

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

/**
 * Prochaine ouverture de la plage de notification (timestamp ms) : aujourd'hui
 * si l'heure d'ouverture n'est pas encore passée (5 h pour une plage 7 h-21 h),
 * demain sinon.
 */
function prochaineOuverture(debut = '07:00', maintenant = new Date()) {
  const minutes = parseHeure(debut);
  const cible = new Date(maintenant);
  cible.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (cible.getTime() <= maintenant.getTime()) cible.setDate(cible.getDate() + 1);
  return cible.getTime();
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


module.exports = {
  traiterNotification,
  TEMPLATES_SMS,
  doitEnvoyerNotification,
  dansPlageHoraire,
  parseHeure,
  prochaineOuverture,
  getCategorie,
  getContexteNotification,
};
