'use strict';

const express  = require('express');
const { z }    = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }    = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }  = require('../../middleware/validate.middleware');
const { ok, cree } = require('../../utils/reponse');
const ApiError     = require('../../utils/ApiError');
const logger       = require('../../utils/logger');

const router  = express.Router();
const auth    = authentifier;
const perm    = exigerPermission;
const isoler  = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// POST /conversations — Créer ou retrouver une conversation (upsert)
// ═════════════════════════════════════════════════════════════════
router.post('/conversations',
  auth, isoler, perm('messagerie.envoyer'),
  valider(z.object({
    parent_id:     z.string().uuid(),
    enseignant_id: z.string().uuid(),
    eleve_id:      z.string().uuid(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();
      const { parent_id, enseignant_id, eleve_id } = req.body;
      const etab = req.etablissement_id;

      // 1. Vérifier que enseignant_id (utilisateur) correspond à un enseignant de cet établissement
      const enseignantRow = await db('enseignants')
        .where({ utilisateur_id: enseignant_id, etablissement_id: etab })
        .whereNull('deleted_at')
        .first('id');
      if (!enseignantRow) throw ApiError.nonTrouve('Enseignant introuvable dans cet établissement');

      // 2. Vérifier l'affectation : l'enseignant est bien affecté à la classe de l'élève
      const affectation = await db('affectations_enseignants as ae')
        .join('inscriptions as i', 'i.classe_id', 'ae.classe_id')
        .where({ 'ae.enseignant_id': enseignantRow.id, 'i.eleve_id': eleve_id })
        .whereNull('ae.deleted_at')
        .whereNull('i.deleted_at')
        .first('ae.classe_id as id');
      if (!affectation) throw ApiError.interdit('Aucune affectation entre cet enseignant et cet élève');

      // 3. Upsert — chercher une conversation existante pour ce triplet + établissement
      const existing = await db('conversations')
        .where({ parent_id, enseignant_id, eleve_id, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (existing) {
        logger.info('Conversation existante retournée', { id: existing.id });
        return ok(res, existing, 200);
      }

      // 4. Créer la conversation
      const [newConv] = await db('conversations')
        .insert({
          id:               uuid(),
          etablissement_id: etab,
          parent_id,
          enseignant_id,
          eleve_id,
          dernier_message_at: null,
          archived_by_parent: false,
          archived_by_enseignant: false,
        })
        .returning('*');

      logger.info('Conversation créée', { id: newConv.id });
      return cree(res, newConv);
    } catch (err) { next(err); }
  }
);

module.exports = router;
