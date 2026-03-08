'use strict';

const logger = require('../utils/logger');

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
    return res.status(409).json({
      succes:  false,
      erreur:  'Cet enregistrement existe déjà',
      code:    'DOUBLON',
      details: err.detail ? [{ message: err.detail }] : [],
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
    return res.status(422).json({
      succes:  false,
      erreur:  'Contrainte de validation violée',
      code:    'CONTRAINTE_BD',
      details: err.detail ? [{ message: err.detail }] : [],
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
