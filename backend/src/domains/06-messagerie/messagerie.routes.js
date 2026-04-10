'use strict';

const express  = require('express');
const { z }    = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }    = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }  = require('../../middleware/validate.middleware');
const { ok, cree, paginee, getPagination } = require('../../utils/reponse');
const ApiError     = require('../../utils/ApiError');
const logger       = require('../../utils/logger');

const router  = express.Router();
const auth    = authentifier;
const perm    = exigerPermission;
const isoler  = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /conversations — Liste paginée des conversations
// ═════════════════════════════════════════════════════════════════
router.get('/conversations',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const etab   = req.etablissement_id;
      const userId = req.session.utilisateur_id;
      const roles  = req.session.roles || [];
      const { page, limite, offset } = getPagination(req.query);

      let query = db('conversations as c')
        .join('utilisateurs as p', 'p.id', 'c.parent_id')
        .join('utilisateurs as e', 'e.id', 'c.enseignant_id')
        .join('eleves as el', 'el.id', 'c.eleve_id')
        .where('c.etablissement_id', etab)
        .whereNull('c.deleted_at')
        .select(
          'c.*',
          'p.nom as parent_nom', 'p.prenom as parent_prenom',
          'e.nom as enseignant_nom', 'e.prenom as enseignant_prenom',
          'el.nom as eleve_nom', 'el.prenom as eleve_prenom'
        );

      const estSuperviseur = roles.some(r => ['directeur', 'censeur', 'super_admin'].includes(r));
      if (!estSuperviseur) {
        query = query.andWhere(function () {
          this.where('c.parent_id', userId).orWhere('c.enseignant_id', userId);
        });
        const estParent = roles.includes('parent');
        if (estParent) {
          query = query.andWhere('c.archived_by_parent', false);
        } else {
          query = query.andWhere('c.archived_by_enseignant', false);
        }
      }

      query = query.select(
        db.raw(
          `(SELECT COUNT(*) FROM messages m
             WHERE m.conversation_id = c.id
               AND m.expediteur_id != ?
               AND m.lu = FALSE
               AND m.deleted_at IS NULL) as non_lus`,
          [userId]
        )
      );

      const countResult = await query.clone().clearSelect().clearOrder().count('c.id as count').first();
      const total = parseInt((countResult && countResult.count) || '0', 10);

      const rows = await query
        .orderBy('c.dernier_message_at', 'desc')
        .limit(limite)
        .offset(offset);

      return paginee(res, rows, { total, page, limite });
    } catch (err) { next(err); }
  }
);

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
