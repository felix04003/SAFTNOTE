'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const ApiError = require('./ApiError');

/**
 * Politique de mot de passe UNIQUE, appliquée à tous les profils qui ont un
 * mot de passe (directeur à l'inscription, enseignant créé par le directeur,
 * réinitialisation pour tout compte). Les parents et élèves n'en ont pas :
 * ils se connectent par code SMS.
 *
 * Socle imposé partout : 8 caractères minimum, au moins une minuscule, une
 * majuscule et un chiffre. La politique propre à l'établissement
 * (`politique_securite`) ne peut que RENFORCER ce socle (longueur plus
 * grande), jamais l'assouplir.
 *
 * Maximum 72 octets : bcrypt ignore silencieusement tout ce qui dépasse.
 */

const LONGUEUR_MIN = 8;
const LONGUEUR_MAX_OCTETS = 72;

const MSG = {
  min:       (n) => `Le mot de passe doit contenir au moins ${n} caractères`,
  max:       `Le mot de passe est trop long (72 octets maximum)`,
  minuscule: 'Le mot de passe doit contenir au moins une lettre minuscule',
  majuscule: 'Le mot de passe doit contenir au moins une lettre majuscule',
  chiffre:   'Le mot de passe doit contenir au moins un chiffre',
  identite:  'Le mot de passe ne doit pas reprendre votre numéro de téléphone, votre email ou votre nom',
};

/** Ne garde que lettres/chiffres, en minuscules, sans accents. */
function squelette(valeur) {
  return String(valeur || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string} mdp
 * @param {object} [politique] - Ligne `politique_securite` (mdp_longueur_min…) : ne peut que durcir
 * @param {{telephone?:string, email?:string, nom?:string, prenom?:string}} [identite]
 *        Éléments du compte que le mot de passe ne doit pas reprendre
 * @returns {string|null} Message d'erreur, ou null si le mot de passe est conforme
 */
function validerMotDePasse(mdp, politique, identite) {
  if (typeof mdp !== 'string') return MSG.min(LONGUEUR_MIN);
  const min = Math.max(LONGUEUR_MIN, Number(politique && politique.mdp_longueur_min) || 0);
  if (mdp.length < min) return MSG.min(min);
  if (Buffer.byteLength(mdp, 'utf8') > LONGUEUR_MAX_OCTETS) return MSG.max;
  if (!/[a-z]/.test(mdp)) return MSG.minuscule;
  if (!/[A-Z]/.test(mdp)) return MSG.majuscule;
  if (!/[0-9]/.test(mdp)) return MSG.chiffre;

  if (identite) {
    const sq = squelette(mdp);
    const chiffresTel = String(identite.telephone || '').replace(/\D/g, '');
    const candidats = [
      identite.email,
      String(identite.email || '').split('@')[0],
      identite.nom,
      identite.prenom,
    ].map(squelette).filter(c => c.length >= 4);
    const reprendTel = chiffresTel.length >= 8
      && (sq.includes(chiffresTel) || sq.includes(chiffresTel.slice(-9)));
    if (reprendTel || candidats.some(c => sq === c)) return MSG.identite;
  }
  return null;
}

/** Même contrôle, sous forme d'exception 422 (à utiliser dans les routes). */
function exigerMotDePasseConforme(mdp, politique, identite) {
  const erreur = validerMotDePasse(mdp, politique, identite);
  if (erreur) throw ApiError.validationEchouee(erreur);
}

/** Schéma zod du socle commun, pour les corps de requête (messages en français). */
const schemaMotDePasse = z.string()
  .min(LONGUEUR_MIN, MSG.min(LONGUEUR_MIN))
  .regex(/[a-z]/, MSG.minuscule)
  .regex(/[A-Z]/, MSG.majuscule)
  .regex(/[0-9]/, MSG.chiffre)
  .refine(v => Buffer.byteLength(v, 'utf8') <= LONGUEUR_MAX_OCTETS, MSG.max);

/**
 * Mot de passe provisoire aléatoire (12 caractères, conforme au socle), sans
 * caractères ambigus (0/O, 1/l/I). Remplace l'ancien défaut « mot de passe =
 * numéro de téléphone », qui était aussi l'identifiant de connexion.
 */
function genererMotDePasseTemporaire() {
  const MIN = 'abcdefghijkmnpqrstuvwxyz';
  const MAJ = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const NUM = '23456789';
  const tout = MIN + MAJ + NUM;
  const un = (alphabet) => alphabet[crypto.randomInt(alphabet.length)];

  const car = [un(MIN), un(MAJ), un(NUM)];
  while (car.length < 12) car.push(un(tout));
  for (let i = car.length - 1; i > 0; i--) { // mélange Fisher-Yates
    const j = crypto.randomInt(i + 1);
    [car[i], car[j]] = [car[j], car[i]];
  }
  return car.join('');
}

module.exports = {
  LONGUEUR_MIN,
  validerMotDePasse,
  exigerMotDePasseConforme,
  schemaMotDePasse,
  genererMotDePasseTemporaire,
};
