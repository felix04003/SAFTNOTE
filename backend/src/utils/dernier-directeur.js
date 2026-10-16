'use strict';

const ApiError = require('./ApiError');

/**
 * Cet utilisateur est-il le DERNIER directeur actif de l'établissement ?
 *
 * Garde-fou : fermer ou bloquer ce compte laisserait l'école sans direction (plus personne pour créer les
 * enseignants, valider les bulletins, régler la sécurité, ni débloquer quoi que ce soit). Une seule requête :
 * la liste des directeurs dont le compte ET le rôle sont actifs.
 */
async function estDernierDirecteurActif(db, utilisateurId, etablissementId) {
  const lignes = await db('utilisateur_roles as ur')
    .join('roles as r', 'r.id', 'ur.role_id')
    .join('utilisateurs as u', 'u.id', 'ur.utilisateur_id')
    .where({ 'ur.etablissement_id': etablissementId, 'r.code': 'directeur', 'ur.actif': true, 'u.actif': true })
    .select('ur.utilisateur_id');
  const ids = [...new Set(lignes.map((l) => l.utilisateur_id))];
  return ids.length === 1 && ids[0] === utilisateurId;
}

/** Erreur 409 commune aux routes qui désactiveraient le dernier directeur */
function erreurDernierDirecteur(message) {
  return new ApiError(409, message, 'DERNIER_DIRECTEUR');
}

module.exports = { estDernierDirecteurActif, erreurDernierDirecteur };
