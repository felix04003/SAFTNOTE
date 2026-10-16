'use strict';

/**
 * Parents et tuteurs d'un élève APRÈS l'inscription : ajouter un parent, corriger son numéro ou son lien, le retirer.
 * Avant, POST /eleves était le seul endroit qui créait un parent : un numéro qui change ou un second parent à
 * ajouter étaient impossibles à corriger, alors que le numéro est l'identifiant de connexion (code SMS).
 *
 * `:eleve_id` est l'identifiant UTILISATEUR de l'élève (convention de ce dépôt), `:parent_id` celui du parent.
 */

const express = require('express');
const { z }   = require('zod');
const { v4: uuid } = require('uuid');

const { getDB, withTransaction } = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider } = require('../../../middleware/validate.middleware');
const { ok, cree } = require('../../../utils/reponse');
const ApiError = require('../../../utils/ApiError');
const { paysEtablissement, telephoneOuErreur, variantesTelephone } = require('../../../utils/telephone');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

const LIENS = ['pere', 'mere', 'tuteur', 'grand_parent', 'oncle_tante', 'autre'];
const DROITS = ['peut_voir_notes', 'peut_voir_absences', 'peut_voir_bulletins', 'peut_voir_discipline'];

async function chargerEleve(db, utilisateurId, etablissementId) {
  const eleve = await db('utilisateurs as u')
    .join('eleves as e', 'e.utilisateur_id', 'u.id')
    .where({ 'u.id': utilisateurId, 'u.etablissement_id': etablissementId })
    .first('u.id as utilisateur_id', 'e.id as eleve_pk');
  if (!eleve) throw ApiError.nonTrouve('Élève introuvable');
  return eleve;
}

async function chargerLien(db, elevePk, parentId) {
  const lien = await db('parents_eleves').where({ eleve_id: elevePk, parent_id: parentId }).first();
  if (!lien) throw ApiError.nonTrouve('Ce parent n\'est pas rattaché à cet élève');
  return lien;
}

/** Rôles du compte DANS cet établissement */
async function rolesDuCompte(db, utilisateurId, etablissementId) {
  const lignes = await db('utilisateur_roles as ur').join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'ur.utilisateur_id': utilisateurId, 'ur.etablissement_id': etablissementId }).select('r.code');
  return lignes.map((l) => l.code);
}

function journaliser(trx, req, action, eleveUtilisateurId, details) {
  return trx('journal_audit').insert({
    etablissement_id: req.etablissement_id, utilisateur_id: req.session.utilisateur_id,
    action, resultat: 'succes', table_cible: 'parents_eleves', enregistrement_id: eleveUtilisateurId,
    details: JSON.stringify(details),       // identifiants et NOMS de champs seulement : jamais un numéro ni un nom
  });
}

async function donnerRoleParent(trx, utilisateurId, etablissementId) {
  const dejaParent = await trx('utilisateur_roles as ur').join('roles as r', 'r.id', 'ur.role_id')
    .where({ 'ur.utilisateur_id': utilisateurId, 'ur.etablissement_id': etablissementId, 'r.code': 'parent' }).first('ur.id');
  if (!dejaParent) {
    const role = await trx('roles').where({ code: 'parent' }).first('id');
    await trx('utilisateur_roles').insert({ id: uuid(), utilisateur_id: utilisateurId, role_id: role.id, etablissement_id: etablissementId });
  }
  await trx('notifications_preferences').insert({ id: uuid(), utilisateur_id: utilisateurId, canal_prefere: 'sms' })
    .onConflict('utilisateur_id').ignore();
}

// ═════════════════════════════════════════════════════════════════
// POST /eleves/:eleve_id/parents — rattacher un parent ou tuteur
// Un numéro déjà connu de l'établissement est RÉUTILISÉ (fratrie, parent déjà enregistré) : jamais deux comptes.
// ═════════════════════════════════════════════════════════════════
router.post('/eleves/:eleve_id/parents', auth, isoler, perm('parents.modifier'),
  valider(z.object({
    nom:       z.string().min(2).max(100),
    prenom:    z.string().min(2).max(100),
    telephone: z.string().min(6, 'Numéro invalide').max(25, 'Numéro invalide'),
    lien:      z.enum(LIENS).default('tuteur'),
    est_contact_principal: z.boolean().default(false),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      const eleve = await chargerEleve(db, req.params.eleve_id, req.etablissement_id);
      const pays = await paysEtablissement(db, req.etablissement_id);
      const telephone = telephoneOuErreur(req.body.telephone, pays, 'Téléphone du parent');

      const existant = await db('utilisateurs')
        .where({ etablissement_id: req.etablissement_id })
        .whereIn('telephone', variantesTelephone(req.body.telephone, pays))
        .first('id', 'nom', 'prenom');
      if (existant && existant.id === eleve.utilisateur_id) {
        throw ApiError.validationEchouee('Ce numéro est celui de l\'élève lui-même');
      }
      if (existant) {
        const dejaLie = await db('parents_eleves').where({ eleve_id: eleve.eleve_pk, parent_id: existant.id }).first('id');
        if (dejaLie) throw ApiError.conflit(`${existant.prenom} ${existant.nom} est déjà rattaché(e) à cet élève`);
      }

      const resultat = await withTransaction(async (trx) => {
        let parentId; let compteCree = false;
        if (existant) {
          parentId = existant.id;
        } else {
          parentId = uuid(); compteCree = true;
          await trx('utilisateurs').insert({
            id: parentId, etablissement_id: req.etablissement_id,
            nom: req.body.nom, prenom: req.body.prenom, telephone, actif: true,
          });
        }
        await donnerRoleParent(trx, parentId, req.etablissement_id);

        // Premier parent de l'élève = contact principal d'office ; un seul contact principal par élève
        const autres = await trx('parents_eleves').where({ eleve_id: eleve.eleve_pk }).count('id as n').first();
        const principal = req.body.est_contact_principal || parseInt(autres.n, 10) === 0;
        if (principal) await trx('parents_eleves').where({ eleve_id: eleve.eleve_pk }).update({ est_contact_principal: false });

        await trx('parents_eleves').insert({
          id: uuid(), parent_id: parentId, eleve_id: eleve.eleve_pk, lien: req.body.lien,
          est_contact_principal: principal, peut_voir_notes: true, peut_voir_absences: true,
        });
        await journaliser(trx, req, 'parents.ajouter', eleve.utilisateur_id, { parent_id: parentId, compte_cree: compteCree, lien: req.body.lien, principal });
        return { parent_id: parentId, compte_cree: compteCree, est_contact_principal: principal };
      });

      return cree(res, {
        ...resultat,
        // Numéro déjà connu : les nom et prénom saisis sont ignorés, on dit à qui il appartient
        compte_existant: existant ? { nom: existant.nom, prenom: existant.prenom } : null,
      });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// PUT /eleves/:eleve_id/parents/:parent_id — corriger le lien, les droits, le contact principal et l'identité
// L'identité (nom, prénom, NUMÉRO) est celle du COMPTE : elle change pour tous les enfants de ce parent, ce qui est
// voulu (c'est la même personne). Refusée si le compte est aussi celui d'un membre du personnel.
// ═════════════════════════════════════════════════════════════════
router.put('/eleves/:eleve_id/parents/:parent_id', auth, isoler, perm('parents.modifier'),
  valider(z.object({
    lien:                 z.enum(LIENS),
    est_contact_principal: z.boolean(),
    peut_voir_notes:      z.boolean(),
    peut_voir_absences:   z.boolean(),
    peut_voir_bulletins:  z.boolean(),
    peut_voir_discipline: z.boolean(),
    nom:       z.string().min(2).max(100),
    prenom:    z.string().min(2).max(100),
    telephone: z.string().min(6, 'Numéro invalide').max(25, 'Numéro invalide'),
  }).partial().refine((o) => Object.keys(o).length > 0, { message: 'Aucun champ à modifier' })),
  async (req, res, next) => {
    const db = getDB();
    try {
      const eleve = await chargerEleve(db, req.params.eleve_id, req.etablissement_id);
      await chargerLien(db, eleve.eleve_pk, req.params.parent_id);

      const identite = {};
      for (const c of ['nom', 'prenom']) if (req.body[c] !== undefined) identite[c] = req.body[c];
      if (req.body.telephone !== undefined) {
        const pays = await paysEtablissement(db, req.etablissement_id);
        const telephone = telephoneOuErreur(req.body.telephone, pays, 'Téléphone du parent');
        const detenteur = await db('utilisateurs')
          .where({ etablissement_id: req.etablissement_id })
          .whereIn('telephone', variantesTelephone(req.body.telephone, pays))
          .whereNot('id', req.params.parent_id)
          .first('id', 'nom', 'prenom');
        if (detenteur) {
          throw ApiError.validationEchouee(`Ce numéro appartient déjà à ${detenteur.prenom} ${detenteur.nom} : rattachez cette personne à l'élève au lieu de changer le numéro`);
        }
        identite.telephone = telephone;
      }
      if (Object.keys(identite).length) {
        const roles = await rolesDuCompte(db, req.params.parent_id, req.etablissement_id);
        if (roles.some((r) => r !== 'parent')) {
          throw new ApiError(409, 'Ce compte est aussi celui d\'un membre du personnel : modifiez son nom ou son numéro depuis sa propre fiche', 'COMPTE_PERSONNEL');
        }
      }

      const lienMaj = {};
      for (const c of ['lien', 'est_contact_principal', ...DROITS]) if (req.body[c] !== undefined) lienMaj[c] = req.body[c];

      await withTransaction(async (trx) => {
        if (Object.keys(identite).length) {
          await trx('utilisateurs').where({ id: req.params.parent_id, etablissement_id: req.etablissement_id }).update(identite);
        }
        if (lienMaj.est_contact_principal === true) {
          await trx('parents_eleves').where({ eleve_id: eleve.eleve_pk }).whereNot('parent_id', req.params.parent_id).update({ est_contact_principal: false });
        }
        if (Object.keys(lienMaj).length) {
          await trx('parents_eleves').where({ eleve_id: eleve.eleve_pk, parent_id: req.params.parent_id }).update(lienMaj);
        }
        await journaliser(trx, req, 'parents.modifier', eleve.utilisateur_id, { parent_id: req.params.parent_id, champs: [...Object.keys(identite), ...Object.keys(lienMaj)] });
      });

      return ok(res, { parent_id: req.params.parent_id });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// DELETE /eleves/:eleve_id/parents/:parent_id — détacher un parent de cet élève
// Le compte du parent n'est PAS supprimé (ses autres enfants, son historique). Il perd l'accès à cet élève
// immédiatement : tous les écrans parent passent par ce lien. Si c'était le contact principal, le plus ancien des
// autres le devient.
// ═════════════════════════════════════════════════════════════════
router.delete('/eleves/:eleve_id/parents/:parent_id', auth, isoler, perm('parents.modifier'), async (req, res, next) => {
  const db = getDB();
  try {
    const eleve = await chargerEleve(db, req.params.eleve_id, req.etablissement_id);
    const lien = await chargerLien(db, eleve.eleve_pk, req.params.parent_id);

    const nouveauPrincipal = await withTransaction(async (trx) => {
      await trx('parents_eleves').where({ id: lien.id }).del();
      let promu = null;
      if (lien.est_contact_principal) {
        const suivant = await trx('parents_eleves').where({ eleve_id: eleve.eleve_pk }).orderBy('created_at').first('id', 'parent_id');
        if (suivant) {
          await trx('parents_eleves').where({ id: suivant.id }).update({ est_contact_principal: true });
          promu = suivant.parent_id;
        }
      }
      await journaliser(trx, req, 'parents.retirer', eleve.utilisateur_id, { parent_id: req.params.parent_id, etait_principal: lien.est_contact_principal, nouveau_principal: promu });
      return promu;
    });

    return ok(res, { nouveau_contact_principal: nouveauPrincipal });
  } catch (err) { next(err); }
});

module.exports = router;
