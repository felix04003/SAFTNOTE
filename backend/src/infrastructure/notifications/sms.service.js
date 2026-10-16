'use strict';

const logger = require('../../utils/logger');
const { preparerTexteSms } = require('../../utils/sms-texte');

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

  // Tout message est ramené à l'alphabet SMS de base (sinon UCS-2 : 2 à 3 fois
  // plus de segments facturés) puis borné à 3 segments.
  const { texte: messageTronque, segments, encodage } = preparerTexteSms(message, 3);

  const body = new URLSearchParams({
    username: process.env.AT_USERNAME,
    to:       numeros,
    message:  messageTronque,
    ...(process.env.AT_SENDER_ID && { from: process.env.AT_SENDER_ID }),
  }).toString();

  logger.debug('Envoi SMS AT', { to: numeros, chars: messageTronque.length, segments, encodage });

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
      segments,
    });

    return {
      succes: true,
      messageIds: succes.map(r => r.messageId),
      segments,
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

/** Retire les accents et les caractères hors alphabet SMS de base (GSM-7). */
function versAscii(texte) {
  return String(texte)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[—–]/g, '-').replace(/[’‘]/g, "'").replace(/[«»“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, '');
}

/**
 * Envoie à un nouvel enseignant son identifiant et son mot de passe provisoire.
 *
 * Le texte est volontairement en ASCII : un seul caractère hors de l'alphabet
 * SMS de base (un tiret long, un accent comme « ê ») fait passer le message en
 * UCS-2, soit 70 caractères par segment au lieu de 160 — donc 2 à 3 SMS
 * facturés. Le mot de passe n'est jamais journalisé (envoyerSMS ne journalise
 * que le numéro et la longueur).
 *
 * @param {string} telephone       - Numéro E.164 du destinataire (aussi son identifiant)
 * @param {object} p
 * @param {string} p.etablissementNom
 * @param {string} p.motDePasse
 */
async function envoyerMotDePasseProvisoire(telephone, { etablissementNom = 'EcoleManager', motDePasse }) {
  const ecole = versAscii(etablissementNom).slice(0, 30);
  const message = `[${ecole}] Compte cree. Identifiant: ${telephone} Mot de passe provisoire: ${motDePasse} A changer a la 1ere connexion.`;
  return envoyerSMS(telephone, message);
}

module.exports = { envoyerSMS, envoyerOTP, envoyerMotDePasseProvisoire, versAscii };
