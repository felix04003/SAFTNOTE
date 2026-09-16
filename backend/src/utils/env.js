'use strict';

/**
 * env.js — Validation des variables d'environnement critiques au démarrage.
 *
 * Comportement :
 * - En production  : toute variable critique manquante provoque un crash immédiat (fail-closed)
 * - En développement : avertissement logger uniquement, le serveur démarre quand même
 *
 * Inspiré du pattern KPLAN (lib/env.ts).
 */

const logger = require('./logger');

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd   = NODE_ENV === 'production';

// ── Définition des règles de validation ─────────────────────────

/**
 * @typedef {Object} RegleEnv
 * @property {string}   nom        — Nom de la variable d'environnement
 * @property {boolean}  [prodOnly] — Uniquement obligatoire en production
 * @property {Function} [check]    — Validation additionnelle (value) => boolean
 * @property {string}   [hint]     — Message d'aide affiché en cas d'erreur
 */

/** @type {RegleEnv[]} */
const REGLES = [
  {
    nom:   'JWT_SECRET',
    check: (v) => !isProd || v.length >= 32,
    hint:  'JWT_SECRET doit faire au moins 32 caractères en production',
  },
  {
    // DATABASE_URL OU (POSTGRES_HOST + POSTGRES_DB + POSTGRES_USER + POSTGRES_PASSWORD)
    nom:   '_DATABASE_GROUP',
    check: () => {
      const hasUrl = Boolean(process.env.DATABASE_URL);
      const hasComponents = (
        process.env.POSTGRES_HOST &&
        process.env.POSTGRES_DB &&
        process.env.POSTGRES_USER &&
        process.env.POSTGRES_PASSWORD
      );
      return hasUrl || hasComponents;
    },
    hint: 'Configurez DATABASE_URL ou les 4 variables POSTGRES_HOST / POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD',
  },
  // Redis est optionnel — si absent, cache et queues désactivés (plan gratuit Render)
  {
    nom:      'MONITORING_TOKEN',
    prodOnly: true,
    check:    (v) => v && v.length > 0,
    hint:     'MONITORING_TOKEN est requis en production pour sécuriser /health/deep et /metrics',
  },
  // Stockage S3/R2 des bulletins (lot D, finding C2 audit 2026-09) : le
  // stockage entier est optionnel (dev sans MinIO), mais dès que S3_ENDPOINT
  // est renseigné, une config à moitié faite doit être détectée tout de
  // suite plutôt que de tomber silencieusement en mode "storage désactivé"
  // (voir storage.service.js isDisponible()). Avertissement en dev, erreur
  // fatale en prod — comme JWT_SECRET/MONITORING_TOKEN ci-dessus.
  {
    nom:   '_S3_GROUP',
    check: () => {
      const hasEndpoint = Boolean(process.env.S3_ENDPOINT);
      if (!hasEndpoint) return true; // stockage non configuré, c'est permis
      return Boolean(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY && process.env.S3_BUCKET);
    },
    hint: 'S3_ENDPOINT est défini : S3_ACCESS_KEY, S3_SECRET_KEY et S3_BUCKET deviennent obligatoires (config S3 incomplète)',
  },
];

// ── Fonction de validation ───────────────────────────────────────

/**
 * Valide les variables d'environnement critiques.
 * Appelé une seule fois au boot, avant app.listen().
 *
 * @throws {Error} En production si une variable critique est manquante ou invalide.
 */
function validateEnv() {
  const erreurs   = [];
  const warnings  = [];

  for (const regle of REGLES) {
    // Variables groupées (nom commence par '_') — pas de lecture directe
    const estGroupe = regle.nom.startsWith('_');
    const valeur    = estGroupe ? null : process.env[regle.nom];

    // Ignorer les règles prod-only en développement
    if (regle.prodOnly && !isProd) continue;

    let invalide = false;

    if (!estGroupe) {
      // Variable simple
      if (!valeur) {
        invalide = true;
      } else if (regle.check && !regle.check(valeur)) {
        invalide = true;
      }
    } else {
      // Règle groupée — déléguer entièrement à check()
      if (regle.check && !regle.check()) {
        invalide = true;
      }
    }

    if (invalide) {
      const message = regle.hint || `Variable manquante ou invalide : ${regle.nom}`;
      if (isProd) {
        erreurs.push(message);
      } else {
        warnings.push(message);
      }
    }
  }

  // Afficher les avertissements (dev)
  for (const w of warnings) {
    logger.warn(`[env] ${w}`);
  }

  // Crasher proprement en production
  if (erreurs.length > 0) {
    const message = [
      `[env] ${erreurs.length} variable(s) d'environnement critique(s) manquante(s) :`,
      ...erreurs.map((e) => `  • ${e}`),
    ].join('\n');

    logger.error(message);
    throw new Error(message);
  }

  logger.info('[env] Variables d\'environnement validées');
}

module.exports = { validateEnv };
