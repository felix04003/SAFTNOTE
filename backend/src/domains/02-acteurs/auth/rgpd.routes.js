'use strict';

/**
 * Routes RGPD — Conformité Loi sénégalaise 2008-12, loi ivoirienne 2013-450, RGPD
 *
 * GET  /utilisateurs/moi/donnees   → Export de toutes les données personnelles
 * DELETE /utilisateurs/moi         → Droit à l'effacement (anonymisation)
 * POST /utilisateurs/moi/consentement → Enregistrer un consentement
 * GET  /utilisateurs/moi/consentements → Liste des consentements donnés
 */

const express = require('express');
const { getDB } = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { ok } = require('../../../utils/reponse');
const ApiError = require('../../../utils/ApiError');
const logger = require('../../../utils/logger');
const { z } = require('zod');
const { valider } = require('../../../middleware/validate.middleware');

const router = express.Router();

// ── GET /utilisateurs/moi/donnees ────────────────────────────────
// Export de toutes les données personnelles de l'utilisateur connecté
router.get('/utilisateurs/moi/donnees', authentifier, async (req, res, next) => {
  const db = getDB();
  const utilisateurId = req.session.utilisateur_id;

  try {
    // 1. Données du compte
    const compte = await db('utilisateurs')
      .where({ id: utilisateurId })
      .first('id', 'nom', 'prenom', 'email', 'telephone', 'date_naissance', 'genre', 'adresse', 'created_at');

    // 2. Rôles
    const roles = await db('utilisateur_roles as ur')
      .join('roles as r', 'r.id', 'ur.role_id')
      .join('etablissements as e', 'e.id', 'ur.etablissement_id')
      .where({ 'ur.utilisateur_id': utilisateurId, 'ur.actif': true })
      .select('r.code as role', 'e.nom as etablissement');

    // 3. Sessions (historique de connexion)
    const sessions = await db('sessions')
      .where({ utilisateur_id: utilisateurId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .select('ip_address', 'appareil', 'canal_connexion', 'created_at', 'expire_at', 'revoquee');

    // 4. Tentatives de connexion
    const tentatives = await db('tentatives_connexion')
      .where({ identifiant: compte.email || compte.telephone })
      .orderBy('tentee_at', 'desc')
      .limit(50)
      .select('ip_address', 'succes', 'motif_echec', 'tentee_at');

    // 5. Journal d'audit (actions effectuées)
    const audit = await db('journal_audit')
      .where({ utilisateur_id: utilisateurId })
      .orderBy('created_at', 'desc')
      .limit(100)
      .select('action', 'resultat', 'table_cible', 'created_at');

    // 6. Consentements
    const consentements = await db('consentements')
      .where({ utilisateur_id: utilisateurId })
      .orderBy('created_at', 'desc')
      .select('type', 'accorde', 'created_at', 'updated_at')
      .catch(() => []); // Table peut ne pas exister encore

    logger.info('Export RGPD données personnelles', { utilisateur_id: utilisateurId });

    return ok(res, {
      exporté_le: new Date().toISOString(),
      compte,
      roles,
      historique_connexions: sessions,
      tentatives_connexion: tentatives,
      actions_effectuées: audit,
      consentements,
      mention_légale: 'Ces données sont collectées conformément à la loi sénégalaise n°2008-12 sur la protection des données personnelles.',
    });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /utilisateurs/moi ─────────────────────────────────────
// Droit à l'effacement — anonymise le compte de l'utilisateur
// Note : les données scolaires (notes, absences) sont conservées anonymisées
// conformément à l'obligation légale de conservation des données éducatives
router.delete('/utilisateurs/moi', authentifier, async (req, res, next) => {
  const db = getDB();
  const utilisateurId = req.session.utilisateur_id;

  try {
    await db.transaction(async trx => {
      // 1. Anonymiser le compte utilisateur (RGPD : pseudonymisation)
      const pseudonyme = `ANONYME_${Date.now()}`;
      await trx('utilisateurs').where({ id: utilisateurId }).update({
        nom:            pseudonyme,
        prenom:         'Anonyme',
        email:          null,
        telephone:      null,
        adresse:        null,
        date_naissance: null,
        photo_url:      null,
        actif:          false,
        updated_at:     trx.raw('NOW()'),
      });

      // 2. Révoquer toutes les sessions actives
      await trx('sessions')
        .where({ utilisateur_id: utilisateurId, revoquee: false })
        .update({ revoquee: true, motif_revocation: 'effacement_rgpd' });

      // 3. Supprimer les OTP en attente
      await trx('otp_verifications')
        .where({ utilisateur_id: utilisateurId, utilise: false })
        .update({ utilise: true });
    });

    logger.info('Effacement RGPD effectué (anonymisation)', { utilisateur_id: utilisateurId });

    return ok(res, {
      message: 'Vos données personnelles ont été anonymisées. Les données scolaires sont conservées sous forme anonyme conformément à la réglementation.',
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /utilisateurs/moi/consentement ─────────────────────────
// Enregistrer ou mettre à jour un consentement
router.post('/utilisateurs/moi/consentement',
  authentifier,
  valider(z.object({
    type:    z.enum(['notifications_sms', 'notifications_whatsapp', 'partage_donnees', 'analytics']),
    accorde: z.boolean(),
  })),
  async (req, res, next) => {
    const db = getDB();
    const utilisateurId = req.session.utilisateur_id;
    const { type, accorde } = req.body;

    try {
      // Upsert du consentement
      const existing = await db('consentements')
        .where({ utilisateur_id: utilisateurId, type })
        .first('id')
        .catch(() => null);

      if (existing) {
        await db('consentements')
          .where({ id: existing.id })
          .update({ accorde, updated_at: db.raw('NOW()') });
      } else {
        const { v4: uuid } = require('uuid');
        await db('consentements').insert({
          id:             uuid(),
          utilisateur_id: utilisateurId,
          type,
          accorde,
        }).catch(async () => {
          // Table consentements peut ne pas exister — créer silencieusement
          await db.schema.createTableIfNotExists('consentements', t => {
            t.uuid('id').primary();
            t.uuid('utilisateur_id').notNullable().references('utilisateurs.id').onDelete('CASCADE');
            t.string('type', 50).notNullable();
            t.boolean('accorde').notNullable().defaultTo(false);
            t.timestamp('created_at').defaultTo(db.raw('NOW()'));
            t.timestamp('updated_at').defaultTo(db.raw('NOW()'));
            t.unique(['utilisateur_id', 'type']);
          });
          const { v4: uuid2 } = require('uuid');
          await db('consentements').insert({ id: uuid2(), utilisateur_id: utilisateurId, type, accorde });
        });
      }

      return ok(res, { message: `Consentement "${type}" ${accorde ? 'accordé' : 'retiré'}` });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /utilisateurs/moi/consentements ──────────────────────────
router.get('/utilisateurs/moi/consentements', authentifier, async (req, res, next) => {
  const db = getDB();
  try {
    const consentements = await db('consentements')
      .where({ utilisateur_id: req.session.utilisateur_id })
      .select('type', 'accorde', 'created_at', 'updated_at')
      .catch(() => []);
    return ok(res, consentements);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
