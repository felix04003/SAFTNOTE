'use strict';

/**
 * Plafond mensuel de SMS de notification, par établissement (migration 023).
 *
 * - consommation : somme des segments des SMS envoyés ce mois civil (UTC)
 * - decision     : autorise ou bloque un envoi selon l'urgence
 * - alerte       : prévient le directeur à 80 % puis 100 %, une fois par palier et par mois
 */

const logger = require('../../utils/logger');

const SEUIL_ALERTE_PCT   = 80;
const COEF_BUTOIR        = 1.5;  // au-delà de 150 % du plafond, même les urgences sont bloquées
const STATUTS_COMPTES    = ['envoye', 'livre'];

/** Premier jour du mois civil courant, à 00:00 UTC. */
function debutDeMois(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** « 2026-10 » */
function cleMois(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/**
 * @returns {Promise<{utilises:number, plafond:number, pourcentage:number|null, alerteMois:string|null, alertePalier:number}>}
 */
async function consommationMois(db, etablissementId, maintenant = new Date()) {
  const politique = await db('politique_securite')
    .where({ etablissement_id: etablissementId })
    .first('sms_plafond_mensuel', 'sms_alerte_mois', 'sms_alerte_palier');

  const ligne = await db('journal_notifications')
    .where({ etablissement_id: etablissementId, canal: 'sms' })
    .whereIn('statut', STATUTS_COMPTES)
    .where('envoye_at', '>=', debutDeMois(maintenant))
    .sum({ total: 'segments' })
    .first();

  const plafond = politique ? Number(politique.sms_plafond_mensuel) : 0;
  const utilises = Number(ligne && ligne.total) || 0;
  return {
    utilises,
    plafond,
    pourcentage: plafond > 0 ? Math.round((utilises / plafond) * 100) : null,
    alerteMois: politique ? politique.sms_alerte_mois : null,
    alertePalier: politique ? Number(politique.sms_alerte_palier) : 0,
  };
}

/**
 * Peut-on envoyer un SMS de cette catégorie ?
 * @param {{utilises:number, plafond:number}} conso
 * @param {string} categorie - 'urgence' | 'quotidien' | 'document' | 'programme'
 * @returns {{autorise:boolean, raison?:string}}
 */
function decision(conso, categorie) {
  if (!conso.plafond) return { autorise: true };                         // 0 = illimité
  if (conso.utilises >= conso.plafond * COEF_BUTOIR) {
    return { autorise: false, raison: 'butoir_atteint' };
  }
  if (categorie !== 'urgence' && conso.utilises >= conso.plafond) {
    return { autorise: false, raison: 'plafond_atteint' };
  }
  return { autorise: true };
}

/**
 * Prévient les directeurs de l'établissement quand le palier 80 % puis 100 %
 * est franchi. Le passage du palier est réservé par un UPDATE conditionnel :
 * si plusieurs workers franchissent le seuil en même temps, un seul envoie.
 *
 * @param {object} deps - { envoyerSMS }  (injecté pour éviter une dépendance circulaire)
 * @returns {Promise<number|null>} palier notifié (80 ou 100), ou null
 */
async function alerterSiSeuilFranchi(db, etablissementId, conso, { envoyerSMS }, maintenant = new Date()) {
  if (!conso.plafond) return null;
  const palier = conso.utilises >= conso.plafond ? 100
    : (conso.utilises * 100 >= conso.plafond * SEUIL_ALERTE_PCT ? SEUIL_ALERTE_PCT : 0);
  if (!palier) return null;

  const mois = cleMois(maintenant);
  const reserve = await db('politique_securite')
    .where({ etablissement_id: etablissementId })
    .andWhere(function () {
      this.whereNull('sms_alerte_mois').orWhere('sms_alerte_mois', '!=', mois).orWhere('sms_alerte_palier', '<', palier);
    })
    .update({ sms_alerte_mois: mois, sms_alerte_palier: palier });
  if (!reserve) return null;                                              // déjà prévenu pour ce palier

  const directeurs = await db('utilisateurs as u')
    .join('utilisateur_roles as ur', 'ur.utilisateur_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .join('etablissements as e', 'e.id', 'u.etablissement_id')
    .where({ 'u.etablissement_id': etablissementId, 'u.actif': true, 'r.code': 'directeur', 'ur.actif': true })
    .whereNotNull('u.telephone')
    .select('u.telephone', 'e.nom as etablissement');

  const texte = palier === 100
    ? (nom) => `[${nom}] Plafond mensuel de SMS atteint (${conso.utilises}/${conso.plafond}). Les notes et bulletins ne sont plus envoyes aux parents ce mois-ci. Les absences et sanctions continuent.`
    : (nom) => `[${nom}] ${palier}% du plafond mensuel de SMS atteint (${conso.utilises}/${conso.plafond}). Au plafond, les notes et bulletins ne seront plus envoyes.`;

  for (const d of directeurs) {
    try { await envoyerSMS(d.telephone, texte(d.etablissement)); }
    catch (err) { logger.warn('Alerte plafond SMS non envoyée', { etablissement_id: etablissementId, error: String(err.message).slice(0, 120) }); }
  }
  logger.warn('Plafond SMS : palier franchi', { etablissement_id: etablissementId, palier, utilises: conso.utilises, plafond: conso.plafond, directeurs_prevenus: directeurs.length });
  return palier;
}

module.exports = {
  debutDeMois, cleMois, consommationMois, decision, alerterSiSeuilFranchi,
  SEUIL_ALERTE_PCT, COEF_BUTOIR,
};
