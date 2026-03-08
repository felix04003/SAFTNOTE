'use strict';

const express  = require('express');
const { z }    = require('zod');

const { getDB }      = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }    = require('../../middleware/validate.middleware');
const { ok, liste, paginee, getPagination, vide } = require('../../utils/reponse');
const ApiError       = require('../../utils/ApiError');
const logger         = require('../../utils/logger');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /securite/audit — Journal d'audit (admin seulement)
// ═════════════════════════════════════════════════════════════════
router.get('/securite/audit', auth, isoler, perm('admin.audit'), async (req, res, next) => {
  try {
    const db = getDB();
    const { page, limite, offset } = getPagination(req.query);
    const { action, table_cible, utilisateur_id, depuis, jusqua } = req.query;

    let query = db('journal_audit as ja')
      .leftJoin('utilisateurs as u', 'u.id', 'ja.utilisateur_id')
      .where({ 'ja.etablissement_id': req.etablissement_id });

    if (action)         query = query.where('ja.action', action);
    if (table_cible)    query = query.where('ja.table_cible', table_cible);
    if (utilisateur_id) query = query.where('ja.utilisateur_id', utilisateur_id);
    if (depuis)         query = query.where('ja.created_at', '>=', depuis);
    if (jusqua)         query = query.where('ja.created_at', '<=', jusqua);

    const [{ count }] = await query.clone().count('ja.id as count');
    const entries = await query
      .orderBy('ja.created_at', 'desc')
      .limit(limite).offset(offset)
      .select(
        'ja.id', 'ja.action', 'ja.resultat',
        'ja.table_cible', 'ja.enregistrement_id',
        'ja.ip_address',
        'ja.valeur_avant', 'ja.valeur_apres', 'ja.details',
        'ja.created_at',
        'u.id as utilisateur_id',
        db.raw("CASE WHEN u.id IS NOT NULL THEN CONCAT(u.prenom, ' ', u.nom) ELSE 'Système' END as utilisateur")
      );

    return paginee(res, entries, { total: parseInt(count), page, limite });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /securite/sessions — Sessions actives
// ═════════════════════════════════════════════════════════════════
router.get('/securite/sessions', auth, isoler, perm('admin.audit'), async (req, res, next) => {
  try {
    const db = getDB();
    const { utilisateur_id } = req.query;

    let query = db('sessions as s')
      .join('utilisateurs as u', 'u.id', 's.utilisateur_id')
      .where({ 's.etablissement_id': req.etablissement_id, 's.revoquee': false })
      .where('s.expire_at', '>', db.raw('NOW()'));

    if (utilisateur_id) query = query.where('s.utilisateur_id', utilisateur_id);

    const sessions = await query
      .orderBy('s.derniere_activite', 'desc')
      .select(
        's.id', 's.utilisateur_id',
        db.raw("CONCAT(u.prenom, ' ', u.nom) as utilisateur"),
        's.ip_address', 's.user_agent', 's.appareil', 's.canal_connexion',
        's.expire_at', 's.derniere_activite', 's.created_at'
      );

    return liste(res, sessions);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// DELETE /securite/sessions/:id — Révoquer une session
// ═════════════════════════════════════════════════════════════════
router.delete('/securite/sessions/:id', auth, isoler, perm('admin.utilisateurs'), async (req, res, next) => {
  try {
    const db = getDB();

    const session = await db('sessions')
      .where({ id: req.params.id, etablissement_id: req.etablissement_id, revoquee: false })
      .first('id', 'utilisateur_id');

    if (!session) throw ApiError.nonTrouve('Session introuvable ou déjà révoquée');

    await db('sessions').where({ id: req.params.id }).update({
      revoquee:         true,
      motif_revocation: 'Révoquée par un administrateur',
      revoquee_at:      db.raw('NOW()'),
    });

    logger.info('Session révoquée', {
      session_id: req.params.id,
      utilisateur_cible: session.utilisateur_id,
      revoquee_par: req.session.utilisateur_id,
    });

    return vide(res);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /securite/blocage/:userId — Bloquer un compte
// ═════════════════════════════════════════════════════════════════
router.post('/securite/blocage/:userId', auth, isoler, perm('admin.utilisateurs'),
  valider(z.object({
    motif: z.string().min(5).max(200),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier que l'utilisateur cible existe dans l'établissement
      const utilisateur = await db('utilisateurs')
        .where({ id: req.params.userId, etablissement_id: req.etablissement_id })
        .first('id', 'nom', 'prenom', 'actif');

      if (!utilisateur) throw ApiError.nonTrouve('Utilisateur introuvable');

      // Empêcher de se bloquer soi-même
      if (req.params.userId === req.session.utilisateur_id) {
        throw ApiError.interdit('Vous ne pouvez pas bloquer votre propre compte');
      }

      // Basculer le statut actif
      const nouveauStatut = !utilisateur.actif;

      await db.transaction(async trx => {
        // Mettre à jour le statut
        await trx('utilisateurs').where({ id: req.params.userId }).update({ actif: nouveauStatut });

        // Si on bloque : révoquer toutes les sessions actives
        if (!nouveauStatut) {
          await trx('sessions')
            .where({ utilisateur_id: req.params.userId, revoquee: false })
            .update({
              revoquee:         true,
              motif_revocation: `Compte bloqué : ${req.body.motif}`,
              revoquee_at:      trx.raw('NOW()'),
            });
        }

        // Journaliser dans l'audit
        await trx('journal_audit').insert({
          etablissement_id: req.etablissement_id,
          utilisateur_id:   req.session.utilisateur_id,
          action:           nouveauStatut ? 'utilisateurs.debloquer' : 'utilisateurs.bloquer',
          resultat:         'succes',
          table_cible:      'utilisateurs',
          enregistrement_id: req.params.userId,
          details:          JSON.stringify({ motif: req.body.motif }),
        });
      });

      logger.info(`Utilisateur ${nouveauStatut ? 'débloqué' : 'bloqué'}`, {
        utilisateur_id: req.params.userId,
        par: req.session.utilisateur_id,
        motif: req.body.motif,
      });

      return ok(res, {
        message: `Compte ${utilisateur.prenom} ${utilisateur.nom} ${nouveauStatut ? 'débloqué' : 'bloqué'}`,
        actif: nouveauStatut,
      });
    } catch (err) { next(err); }
  }
);

module.exports = router;
