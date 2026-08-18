'use strict';

const { getDB }         = require('../infrastructure/database/pool');
const { exigerPermission } = require('./permission.middleware');
const ApiError           = require('../utils/ApiError');

/**
 * Autorise l'accès à une route de type /eleves/:eleve_id/... (ou toute
 * route avec un paramètre `eleve_id` = utilisateurs.id, convention de ce
 * domaine) si :
 *
 *  - l'utilisateur connecté est un PARENT lié à cet élève précis
 *    (table parents_eleves), OU
 *  - l'utilisateur possède la permission staff `permissionStaff`
 *    (admin/directeur/censeur/enseignant selon la route).
 *
 * Sans ce garde-fou, `exigerPermission(permissionStaff)` seul autoriserait
 * TOUT parent possédant la permission générique (ex: notes.voir_eleve,
 * absences.voir_eleve) à consulter les données de N'IMPORTE QUEL élève de
 * l'établissement — pas seulement son propre enfant (IDOR). Le staff, lui,
 * reste isolé au niveau établissement par isolerEtablissement — aucune
 * vérification supplémentaire de "propriété" n'est nécessaire pour eux.
 */
function autoriserAccesEleve(permissionStaff) {
  const verifierPermissionStaff = exigerPermission(permissionStaff);

  return async (req, res, next) => {
    try {
      if (!req.session) return next(ApiError.nonAutorise());

      if (req.session.roles.includes('parent')) {
        const lien = await getDB()('parents_eleves as pe')
          .join('eleves as el', 'el.id', 'pe.eleve_id')
          .where({
            'pe.parent_id':      req.session.utilisateur_id,
            'el.utilisateur_id': req.params.eleve_id,
          })
          .first('pe.id');

        if (!lien) throw ApiError.interdit('Cet élève n\'est pas lié à votre compte');
        return next();
      }

      return verifierPermissionStaff(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { autoriserAccesEleve };
