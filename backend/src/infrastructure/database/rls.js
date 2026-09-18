'use strict';

/**
 * Helper RLS phase 1 pilote (migration 019).
 *
 * Ouvre une transaction sur le pool `ecole_app_rls` (getDBRls(), rôle
 * non propriétaire des tables, donc réellement soumis aux policies
 * RLS), pose app.etablissement_id pour la durée de CETTE SEULE
 * transaction via set_config(..., true) [true = LOCAL, jamais
 * persistant sur la connexion réutilisée ensuite par le pool], puis
 * exécute fn(trx).
 *
 * set_config() est utilisé plutôt qu'une interpolation de chaîne dans
 * `SET LOCAL app.etablissement_id = '...'` : PostgreSQL ne supporte
 * pas nativement les paramètres bindés sur SET LOCAL, mais
 * set_config() est une fonction SQL ordinaire qui accepte un binding
 * knex standard (`?`). Aucune concaténation de chaîne, donc aucune
 * injection SQL possible même si etablissementId provenait d'une
 * source non fiable — revalidé ici par défense en profondeur, même si
 * la valeur vient normalement de req.etablissement_id déjà posé par
 * isolerEtablissement() en amont.
 *
 * Rollback automatique en cas d'erreur : comportement standard de
 * knex.transaction (si fn(trx) rejette, la transaction est annulée).
 */

const { getDBRls } = require('./pool');

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {string} etablissementId - UUID de l'établissement (contexte RLS)
 * @param {(trx: import('knex').Knex.Transaction) => Promise<*>} fn - callback exécuté dans la transaction RLS
 * @returns {Promise<*>} résultat de fn
 * @throws {Error} si etablissementId n'est pas un UUID valide, ou si fn (ou la pose du contexte) échoue
 */
async function avecContexteEtablissement(etablissementId, fn) {
  if (typeof etablissementId !== 'string' || !RE_UUID.test(etablissementId)) {
    throw new Error(`avecContexteEtablissement: etablissementId invalide (${String(etablissementId)})`);
  }

  const db = getDBRls();

  return db.transaction(async (trx) => {
    await trx.raw('SELECT set_config(?, ?, TRUE)', ['app.etablissement_id', etablissementId]);
    return fn(trx);
  });
}

module.exports = { avecContexteEtablissement };
