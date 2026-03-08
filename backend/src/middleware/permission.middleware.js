'use strict';

const { getDB } = require('../infrastructure/database/pool');
const ApiError  = require('../utils/ApiError');
const logger    = require('../utils/logger');

/**
 * Charge toutes les permissions d'un utilisateur et les met en cache Redis.
 * Retourne un Set de codes permission.
 */
async function chargerPermissions(utilisateurId, etablissementId) {
  const cacheKey = `user:${utilisateurId}:perms:${etablissementId}`;

  try {
    const { getRedis } = require('../infrastructure/cache/redis');
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) return new Set(JSON.parse(cached));

    const rows = await getDB()
      .select('p.code')
      .from('utilisateur_roles as ur')
      .join('roles_permissions as rp', 'rp.role_id', 'ur.role_id')
      .join('permissions as p', 'p.id', 'rp.permission_id')
      .where({ 'ur.utilisateur_id': utilisateurId, 'ur.etablissement_id': etablissementId, 'ur.actif': true });

    const codes = rows.map(r => r.code);
    await redis.setex(cacheKey, 28800, JSON.stringify(codes)); // 8h TTL
    return new Set(codes);
  } catch {
    // Redis down — fallback sur PostgreSQL direct
    const result = await getDB().raw(
      'SELECT verifier_permission(?, ?, ?) AS autorise',
      [utilisateurId, 'dummy', etablissementId]
    );
    // Fallback: pas de cache, vérification unitaire
    return null;
  }
}

/**
 * Middleware de vérification de permission fine.
 * Utilise le cache Redis quand disponible, sinon appelle PostgreSQL.
 *
 * @param {string} permissionCode - Ex: 'notes.saisir', 'bulletins.valider'
 */
function exigerPermission(permissionCode) {
  return async (req, res, next) => {
    try {
      if (!req.session) return next(ApiError.nonAutorise());

      const { utilisateur_id, etablissement_id } = req.session;

      // Tenter le cache Redis
      const permsSet = await chargerPermissions(utilisateur_id, etablissement_id);

      let autorise;
      if (permsSet) {
        // Cache hit — vérification en mémoire
        autorise = permsSet.has(permissionCode);
      } else {
        // Redis down — fallback PostgreSQL
        const result = await getDB().raw(
          'SELECT verifier_permission(?, ?, ?) AS autorise',
          [utilisateur_id, permissionCode, etablissement_id]
        );
        autorise = result.rows[0]?.autorise;
      }

      if (!autorise) {
        logger.warn('Permission refusée', {
          utilisateur_id,
          permission: permissionCode,
          etablissement_id,
        });
        return next(ApiError.interdit(
          `Permission requise : ${permissionCode}`
        ));
      }

      next();

    } catch (err) {
      logger.error('Erreur vérification permission', { error: err.message });
      next(err);
    }
  };
}

/**
 * Middleware d'isolation par établissement.
 * Vérifie que les ressources accédées appartiennent à l'établissement du token.
 */
async function isolerEtablissement(req, res, next) {
  try {
    if (!req.session) return next(ApiError.nonAutorise());

    const { etablissement_id, roles } = req.session;

    // Les super_admins traversent sans vérification
    if (roles.includes('super_admin')) return next();

    const db = getDB();

    // Vérification dynamique selon le paramètre présent dans la route
    const verifications = [
      { param: 'eleve_id',       table: 'eleves',            jointure: null },
      { param: 'classe_id',      table: 'classes',           jointure: 'annees_scolaires' },
      { param: 'enseignant_id',  table: 'enseignants',       jointure: 'utilisateurs' },
      { param: 'parent_id',      table: 'utilisateurs',      jointure: null },
      { param: 'evaluation_id',  table: 'evaluations',       jointure: 'affectations_enseignants' },
    ];

    for (const { param, table, jointure } of verifications) {
      if (!req.params[param]) continue;

      const resourceId = req.params[param];
      let appartient = false;

      // Vérification simplifiée : tous les enregistrements ont etablissement_id
      // ou on peut le trouver par jointure
      if (table === 'classes') {
        const row = await db('classes as c')
          .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
          .where('c.id', resourceId)
          .where('a.etablissement_id', etablissement_id)
          .first('c.id');
        appartient = !!row;

      } else if (table === 'utilisateurs' || table === 'enseignants' || table === 'eleves') {
        const row = await db('utilisateurs')
          .where({ id: resourceId, etablissement_id })
          .first('id');
        appartient = !!row;

      } else if (table === 'evaluations') {
        const row = await db('evaluations as e')
          .join('affectations_enseignants as ae', 'ae.id', 'e.affectation_id')
          .join('classes as c', 'c.id', 'ae.classe_id')
          .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
          .where('e.id', resourceId)
          .where('a.etablissement_id', etablissement_id)
          .first('e.id');
        appartient = !!row;
      }

      if (!appartient) {
        // 404 et non 403 : ne pas confirmer l'existence de la ressource
        return next(ApiError.nonTrouve('Ressource introuvable'));
      }
    }

    // Passer l'etablissement_id dans req pour usage dans les handlers
    req.etablissement_id = etablissement_id;

    next();

  } catch (err) {
    next(err);
  }
}

module.exports = { exigerPermission, isolerEtablissement };
