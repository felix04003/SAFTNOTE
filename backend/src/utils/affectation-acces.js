'use strict';

const ROLES_DIRECTION = ['super_admin', 'directeur', 'censeur', 'admin'];

/**
 * Retrouve une affectation (enseignant × matière × classe) que l'utilisateur de la session a le droit d'utiliser,
 * ou null :
 *  - elle doit appartenir à l'établissement de la session (sinon, créer une évaluation avec l'identifiant d'une
 *    affectation d'une autre école était possible) ;
 *  - un enseignant n'a accès qu'à SES affectations ; la direction à toutes celles de l'établissement.
 */
async function affectationAccessible(db, session, etablissementId, affectationId) {
  let requete = db('affectations_enseignants as ae')
    .join('classes as c', 'c.id', 'ae.classe_id')
    .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
    .where({ 'ae.id': affectationId, 'a.etablissement_id': etablissementId });

  const roles = session?.roles || [];
  if (!roles.some((r) => ROLES_DIRECTION.includes(r))) {
    requete = requete
      .join('enseignants as ens', 'ens.id', 'ae.enseignant_id')
      .where({ 'ens.utilisateur_id': session?.utilisateur_id });
  }
  return (await requete.first('ae.id', 'ae.classe_id')) || null;
}

module.exports = { affectationAccessible, ROLES_DIRECTION };
