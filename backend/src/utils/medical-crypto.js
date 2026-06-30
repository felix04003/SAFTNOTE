'use strict';

/**
 * Helpers pour le chiffrement/déchiffrement des données médicales.
 *
 * Utilise pgcrypto côté PostgreSQL (pgp_sym_encrypt/decrypt AES-256).
 * La clé est lue depuis MEDICAL_ENCRYPTION_KEY en variable d'environnement.
 *
 * Si MEDICAL_ENCRYPTION_KEY n'est pas définie :
 * - En développement : les données sont stockées en clair avec un warning
 * - En production : une erreur est levée
 */

const logger = require('./logger');

function getCle() {
  const cle = process.env.MEDICAL_ENCRYPTION_KEY;
  if (!cle) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MEDICAL_ENCRYPTION_KEY non définie — obligatoire en production');
    }
    logger.warn('⚠️  MEDICAL_ENCRYPTION_KEY non définie — données médicales stockées en clair (dev uniquement)');
    return null;
  }
  return cle;
}

/**
 * Prépare les colonnes médicales pour l'insertion.
 * Retourne un objet avec les colonnes chiffrées (_enc) si la clé est disponible.
 *
 * @param {object} db - Instance Knex
 * @param {object} donneesMediacles - { allergies, conditions_medicales, groupe_sanguin, medecin_urgence }
 * @returns {object} Colonnes à insérer/mettre à jour
 */
function preparerDonneesMediacles(db, donneesMediacles) {
  const cle = getCle();
  const cols = {};

  const champs = ['allergies', 'conditions_medicales', 'groupe_sanguin', 'medecin_urgence'];

  for (const champ of champs) {
    const valeur = donneesMediacles[champ];
    if (valeur === undefined) continue;

    if (cle && valeur !== null) {
      // Chiffrer avec pgcrypto
      cols[`${champ}_enc`] = db.raw('chiffrer_medical(?, ?)', [String(valeur), cle]);
      // Vider l'ancienne colonne en clair (si elle existe encore)
      if (champ in donneesMediacles) cols[champ] = null;
    } else {
      // Pas de clé (dev) ou valeur null — stocker en clair dans l'ancienne colonne
      cols[champ] = valeur;
    }
  }

  return cols;
}

/**
 * Déchiffre les colonnes médicales d'un enregistrement élève.
 *
 * @param {object} db - Instance Knex
 * @param {object} eleve - Ligne de la table eleves
 * @returns {object} Élève avec les champs médicaux déchiffrés
 */
async function dechiffrerDonneesMediacles(db, eleve) {
  const cle = getCle();
  if (!cle) return eleve;

  const champs = ['allergies', 'conditions_medicales', 'groupe_sanguin', 'medecin_urgence'];
  const result = { ...eleve };

  for (const champ of champs) {
    const cleEnc = `${champ}_enc`;
    if (eleve[cleEnc]) {
      try {
        const row = await db.raw('SELECT dechiffrer_medical(?, ?) as valeur', [eleve[cleEnc], cle]);
        result[champ] = row.rows[0]?.valeur || null;
      } catch {
        result[champ] = null;
      }
      delete result[cleEnc];
    }
  }

  return result;
}

/**
 * Sélecteurs SQL pour déchiffrer les données médicales dans une requête Knex.
 * À utiliser avec db.select(..., ...selecteursMedicaux(db))
 *
 * @param {object} db - Instance Knex
 * @param {string} alias - Alias de la table eleves dans la requête (défaut: 'e')
 */
function selecteursMedicaux(db, alias = 'e') {
  const cle = getCle();
  if (!cle) {
    return [
      `${alias}.allergies`,
      `${alias}.conditions_medicales`,
      `${alias}.groupe_sanguin`,
      `${alias}.medecin_urgence`,
    ];
  }
  return [
    db.raw(`dechiffrer_medical(${alias}.allergies_enc, ?) as allergies`, [cle]),
    db.raw(`dechiffrer_medical(${alias}.conditions_medicales_enc, ?) as conditions_medicales`, [cle]),
    db.raw(`dechiffrer_medical(${alias}.groupe_sanguin_enc, ?) as groupe_sanguin`, [cle]),
    db.raw(`dechiffrer_medical(${alias}.medecin_urgence_enc, ?) as medecin_urgence`, [cle]),
  ];
}

module.exports = { preparerDonneesMediacles, dechiffrerDonneesMediacles, selecteursMedicaux };
