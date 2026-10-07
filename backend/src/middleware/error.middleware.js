'use strict';

const logger = require('../utils/logger');

// Contraintes d'unicité connues → message lisible + champ en cause.
// utilisateurs.telephone est UNIQUE pour toute la base (pas par établissement) :
// un numéro déjà pris peut donc l'être dans un AUTRE établissement.
const MESSAGES_DOUBLON = {
  utilisateurs_telephone_key:
    'Ce numéro de téléphone est déjà utilisé par un autre compte (dans cet établissement ou dans un autre).',
  utilisateurs_etablissement_id_email_key:
    'Cette adresse email est déjà utilisée par un autre compte de cet établissement.',
};
const CHAMPS_DOUBLON = {
  utilisateurs_telephone_key: 'telephone',
  utilisateurs_etablissement_id_email_key: 'email',
};

/**
 * Middleware de gestion globale des erreurs.
 * Transforme toutes les erreurs en réponse JSON uniforme.
 *
 * Format de réponse erreur :
 * {
 *   succes: false,
 *   erreur: "Message lisible",
 *   code: "CODE_ERREUR",
 *   details: [...] // optionnel
 * }
 */
function errorHandler(err, req, res, next) {
  // Log de l'erreur
  const logData = {
    method: req.method,
    url: req.originalUrl,
    utilisateur_id: req.session?.utilisateur_id,
    etablissement_id: req.session?.etablissement_id,
    statusCode: err.statusCode || 500,
    message: err.message,
  };

  if (err.statusCode >= 500 || !err.statusCode) {
    logger.error('Erreur serveur', { ...logData, stack: err.stack });
  } else {
    logger.warn('Erreur client', logData);
  }

  // Erreurs Knex / PostgreSQL
  if (err.code === '23505') {
    if (err.detail) logger.warn('Contrainte unicité BD', { detail: err.detail, url: req.originalUrl });
    // Filet de sécurité (course entre deux requêtes) : même message précis
    // que les contrôles préalables des routes, au lieu d'un « existe déjà »
    // sans indication du champ en cause.
    const precis = MESSAGES_DOUBLON[err.constraint];
    return res.status(409).json({
      succes:  false,
      erreur:  precis || 'Cet enregistrement existe déjà',
      code:    'DOUBLON',
      ...(precis && { champ: CHAMPS_DOUBLON[err.constraint] }),
    });
  }

  if (err.code === '23503') {
    return res.status(422).json({
      succes:  false,
      erreur:  'Référence invalide — l\'enregistrement lié n\'existe pas',
      code:    'REFERENCE_INVALIDE',
    });
  }

  if (err.code === '23514') {
    if (err.detail) logger.warn('Contrainte check BD', { detail: err.detail, url: req.originalUrl });
    return res.status(422).json({
      succes:  false,
      erreur:  'Contrainte de validation violée',
      code:    'CONTRAINTE_BD',
    });
  }

  // Erreurs ApiError (métier)
  if (err.isApiError) {
    return res.status(err.statusCode).json({
      succes:   false,
      erreur:   err.message,
      code:     err.code,
      ...(err.details && { details: err.details }),
    });
  }

  // Erreur générique
  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    succes: false,
    erreur: isProduction && statusCode === 500
      ? 'Une erreur interne est survenue'
      : err.message,
    code: 'ERREUR_SERVEUR',
    ...((!isProduction && err.stack) && { stack: err.stack }),
  });
}

module.exports = errorHandler;
