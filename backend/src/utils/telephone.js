'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');
const ApiError = require('./ApiError');

/**
 * Normalisation des numéros de téléphone en format international E.164
 * (+221771234567). Un même numéro saisi « 77 123 45 67 », « 771234567 » ou
 * « +221 77 123 45 67 » donne toujours la même valeur stockée, ce qui rend la
 * connexion, l'OTP SMS et l'unicité en base fiables.
 */

const PAYS_PAR_NOM = {
  senegal: 'SN', 'sénégal': 'SN',
  "cote d'ivoire": 'CI', "côte d'ivoire": 'CI',
  mali: 'ML',
  'burkina faso': 'BF',
  guinee: 'GN', 'guinée': 'GN',
  cameroun: 'CM',
};

/**
 * Code pays ISO-2 à partir de `etablissements.pays` (code « SN » ou nom
 * « Sénégal »). Défaut : SN.
 */
function paysIso(pays) {
  if (!pays) return 'SN';
  const brut = String(pays).trim();
  if (/^[A-Za-z]{2}$/.test(brut)) return brut.toUpperCase();
  return PAYS_PAR_NOM[brut.toLowerCase()] || 'SN';
}

/**
 * @param {string} brut  - Saisie utilisateur (espaces, points, tirets tolérés)
 * @param {string} pays  - Pays par défaut pour un numéro sans indicatif
 * @returns {string|null} Numéro E.164, ou null s'il est inexploitable
 */
function normaliserTelephone(brut, pays) {
  if (typeof brut !== 'string') return null;
  const nettoye = brut.trim().replace(/^00/, '+');
  if (!nettoye) return null;
  const tel = parsePhoneNumberFromString(nettoye, paysIso(pays));
  // isPossible (longueur plausible) plutôt que isValid : les plages
  // d'opérateurs africaines évoluent plus vite que les métadonnées, un
  // numéro réel ne doit pas être refusé à tort.
  return tel && tel.isPossible() ? tel.number : null;
}

/** Normalise ou lève une 422 « Numéro de téléphone invalide ». */
function telephoneOuErreur(brut, pays, libelle = 'Numéro de téléphone') {
  const tel = normaliserTelephone(brut, pays);
  if (!tel) {
    throw ApiError.validationEchouee(
      `${libelle} invalide — format attendu : +221 77 123 45 67`
    );
  }
  return tel;
}

/**
 * Formes sous lesquelles un même numéro peut exister en base : la forme
 * normalisée, plus les formes historiques (avant normalisation : avec ou sans
 * « + », sans indicatif, tel que saisi). Sert aux recherches (connexion, OTP,
 * doublons) pour ne pas perdre les comptes créés avant cette normalisation.
 */
function variantesTelephone(brut, pays) {
  const variantes = new Set();
  if (typeof brut !== 'string' || !brut.trim()) return [];
  variantes.add(brut.trim());
  const nettoye = brut.trim().replace(/^00/, '+');
  const tel = parsePhoneNumberFromString(nettoye, paysIso(pays));
  if (tel) {
    variantes.add(tel.number);
    variantes.add(tel.number.slice(1));
    variantes.add(tel.nationalNumber);
  }
  return [...variantes];
}

/** Ressemble à un numéro (et non à un email) — pour le champ « identifiant ». */
function ressembleATelephone(identifiant) {
  return typeof identifiant === 'string'
    && !identifiant.includes('@')
    && /^[+\d][\d\s.\-()]{5,}$/.test(identifiant.trim());
}

/** Pays (ISO-2) de l'établissement, pour interpréter un numéro sans indicatif. */
async function paysEtablissement(db, etablissementId) {
  const etab = await db('etablissements').where({ id: etablissementId }).first('pays');
  return paysIso(etab && etab.pays);
}

module.exports = {
  paysEtablissement,
  paysIso,
  normaliserTelephone,
  telephoneOuErreur,
  variantesTelephone,
  ressembleATelephone,
};
