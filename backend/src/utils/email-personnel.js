'use strict';

/**
 * Règle d'email (décision produit du 2026-10-07) :
 *   - un PARENT peut partager le même email entre plusieurs établissements ;
 *   - un DIRECTEUR ou un ENSEIGNANT (et plus généralement tout membre du
 *     personnel) ne le peut pas : son email ne doit être utilisé par aucun
 *     autre compte du personnel, dans aucun établissement.
 *
 * La base ne garantit que UNIQUE (etablissement_id, email), indépendamment du
 * rôle ; la règle « selon le rôle » ne peut pas s'exprimer en contrainte SQL,
 * elle est donc contrôlée ici, avant chaque création ou changement d'email.
 */

// super_admin = équipe technique ; élève et parent ne sont pas du personnel
const ROLES_PERSONNEL = ['super_admin', 'directeur', 'censeur', 'admin', 'enseignant'];

/**
 * Cherche un compte du personnel (actif ou non) qui utilise déjà cet email,
 * dans N'IMPORTE quel établissement.
 *
 * @param {Function} db
 * @param {string} email
 * @param {{ sauf?: string }} [options] - `sauf` : id d'un utilisateur à ignorer (modification de son propre email)
 * @returns {Promise<{id:string, etablissement_id:string}|undefined>}
 */
async function emailPrisParPersonnel(db, email, { sauf } = {}) {
  if (!email) return undefined;
  let requete = db('utilisateurs as u')
    .join('utilisateur_roles as ur', 'ur.utilisateur_id', 'u.id')
    .join('roles as r', 'r.id', 'ur.role_id')
    .whereRaw('LOWER(u.email) = ?', [String(email).trim().toLowerCase()])
    .whereIn('r.code', ROLES_PERSONNEL)
    .where('ur.actif', true);
  if (sauf) requete = requete.where('u.id', '!=', sauf);
  return requete.first('u.id', 'u.etablissement_id');
}

module.exports = { emailPrisParPersonnel, ROLES_PERSONNEL };
