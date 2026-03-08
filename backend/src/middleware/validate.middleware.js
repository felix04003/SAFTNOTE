'use strict';

const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');

/**
 * Middleware de validation avec Zod.
 * @param {ZodSchema} schema - Schéma Zod
 * @param {'body'|'params'|'query'} source - Source à valider
 */
function valider(schema, source = 'body') {
  return (req, res, next) => {
    try {
      const data = req[source];
      const parsed = schema.parse(data);

      // Remplacer la source par les données validées/transformées
      req[source] = parsed;
      next();

    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map(e => ({
          champ:   e.path.join('.'),
          message: e.message,
          code:    e.code,
        }));

        return next(ApiError.validationEchouee('Données invalides', details));
      }
      next(err);
    }
  };
}

module.exports = { valider };
