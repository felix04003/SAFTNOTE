'use strict';

/**
 * Classe d'erreurs métier avec code HTTP et code applicatif.
 * Utilisée dans toute la couche domaine pour lever des erreurs lisibles.
 */
class ApiError extends Error {
  constructor(statusCode, message, code, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code       = code;
    this.details    = details;
    this.isApiError = true;
    Error.captureStackTrace(this, this.constructor);
  }

  // ── Factories ─────────────────────────────────────────────────

  static validationEchouee(message = 'Données invalides', details = null) {
    return new ApiError(422, message, 'VALIDATION_ECHOUEE', details);
  }

  static nonAutorise(message = 'Authentification requise') {
    return new ApiError(401, message, 'NON_AUTORISE');
  }

  static interdit(message = 'Accès refusé — permission insuffisante') {
    return new ApiError(403, message, 'PERMISSION_INSUFFISANTE');
  }

  static nonTrouve(message = 'Ressource introuvable') {
    return new ApiError(404, message, 'RESSOURCE_INTROUVABLE');
  }

  static conflit(message = 'Cet enregistrement existe déjà') {
    return new ApiError(409, message, 'DOUBLON');
  }

  static compteBloque(message = 'Compte temporairement bloqué') {
    return new ApiError(429, message, 'COMPTE_BLOQUE');
  }

  static otpInvalide(message = 'Code OTP invalide ou expiré') {
    return new ApiError(401, message, 'OTP_INVALIDE');
  }

  static erreurServeur(message = 'Erreur interne du serveur') {
    return new ApiError(500, message, 'ERREUR_SERVEUR');
  }
}

module.exports = ApiError;
