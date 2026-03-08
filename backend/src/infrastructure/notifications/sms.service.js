'use strict';

const https  = require('https');
const logger = require('../../utils/logger');

/**
 * Service SMS via Africa's Talking API.
 * Documentation : https://developers.africastalking.com/docs/sms
 */

const AT_BASE_URL = process.env.AT_ENV === 'production'
  ? 'https://api.africastalking.com/version1'
  : 'https://api.sandbox.africastalking.com/version1';

/**
 * Envoie un SMS à un ou plusieurs numéros.
 *
 * @param {string|string[]} telephones - Numéro(s) international(aux) +221XXXXXXXX
 * @param {string} message - Contenu du message (max 160 chars pour 1 SMS)
 * @returns {object} Réponse Africa's Talking
 */
async function envoyerSMS(telephones, message) {
  const numeros = Array.isArray(telephones) ? telephones.join(',') : telephones;

  // Tronquer le message à 459 chars (3 SMS max)
  const messageTronque = message.length > 459
    ? message.slice(0, 456) + '...'
    : message;

  const body = new URLSearchParams({
    username: process.env.AT_USERNAME,
    to:       numeros,
    message:  messageTronque,
    ...(process.env.AT_SENDER_ID && { from: process.env.AT_SENDER_ID }),
  }).toString();

  logger.debug('Envoi SMS AT', { to: numeros, chars: messageTronque.length });

  try {
    const response = await fetch(`${AT_BASE_URL}/messaging`, {
      method: 'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'apiKey':       process.env.AT_API_KEY,
      },
      body,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`AT API error ${response.status}: ${JSON.stringify(data)}`);
    }

    // Extraire le statut par numéro
    const recipients = data?.SMSMessageData?.Recipients || [];
    const succes = recipients.filter(r => r.status === 'Success');
    const echecs = recipients.filter(r => r.status !== 'Success');

    if (echecs.length > 0) {
      logger.warn('SMS partiellement échoués', { echecs });
    }

    logger.info('SMS envoyé', {
      to: numeros,
      succes: succes.length,
      echecs: echecs.length,
    });

    return {
      succes: true,
      messageIds: succes.map(r => r.messageId),
      recipients: data?.SMSMessageData?.Recipients,
    };

  } catch (err) {
    logger.error('Erreur envoi SMS', { error: err.message, to: numeros });
    throw err;
  }
}

/**
 * Envoie un OTP par SMS.
 * @param {string} telephone - Numéro international
 * @param {string} code - Code OTP à 6 chiffres
 * @param {string} etablissementNom - Nom de l'établissement
 */
async function envoyerOTP(telephone, code, etablissementNom = 'EcoleManager') {
  const message = `[${etablissementNom}] Votre code de connexion : ${code}. Valable 10 minutes. Ne le partagez pas.`;
  return envoyerSMS(telephone, message);
}

module.exports = { envoyerSMS, envoyerOTP };
