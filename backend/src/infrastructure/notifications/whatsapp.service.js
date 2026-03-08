'use strict';

const logger = require('../../utils/logger');

/**
 * Service WhatsApp via Meta Cloud API.
 * Documentation : https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * IMPORTANT : Les templates doivent être approuvés par Meta AVANT utilisation.
 * Délai d'approbation : 5 à 10 jours ouvrés.
 */

const WA_API_VERSION = process.env.META_WA_API_VERSION || 'v18.0';
const WA_BASE_URL = `https://graph.facebook.com/${WA_API_VERSION}`;
const WA_PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID;

// ── Templates WhatsApp approuvés ─────────────────────────────────
// Ces noms correspondent aux templates soumis à Meta.
// Paramètres : {{1}}, {{2}} etc.
const TEMPLATES = {
  absence:           { nom: 'absence_eleve_v1',       langue: 'fr' },
  retard:            { nom: 'retard_eleve_v1',         langue: 'fr' },
  nouvelle_note:     { nom: 'nouvelle_note_v1',        langue: 'fr' },
  bulletin_dispo:    { nom: 'bulletin_disponible_v1',  langue: 'fr' },
  convocation:       { nom: 'convocation_parents_v1',  langue: 'fr' },
  sanction:          { nom: 'sanction_eleve_v1',       langue: 'fr' },
  modification_edt:  { nom: 'modification_edt_v1',     langue: 'fr' },
  evenement:         { nom: 'evenement_ecole_v1',      langue: 'fr' },
  autorisation:      { nom: 'autorisation_sortie_v1',  langue: 'fr' },
  resume_hebdo:      { nom: 'resume_semaine_v1',       langue: 'fr' },
};

/**
 * Envoie un message WhatsApp basé sur un template.
 *
 * @param {string} telephone - Numéro international sans le +  (ex: 221771234567)
 * @param {string} templateKey - Clé dans TEMPLATES
 * @param {string[]} parametres - Valeurs des paramètres {{1}}, {{2}}...
 * @param {object} [document] - Document joint { url, nom_fichier } pour bulletins
 */
async function envoyerTemplate(telephone, templateKey, parametres = [], document = null) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Template WhatsApp inconnu : ${templateKey}`);

  // Construire le body du template
  const components = [];

  // Paramètres du corps du message
  if (parametres.length > 0) {
    components.push({
      type: 'body',
      parameters: parametres.map(p => ({ type: 'text', text: String(p) })),
    });
  }

  // Document joint (bulletins PDF)
  if (document) {
    components.push({
      type: 'header',
      parameters: [{
        type:     'document',
        document: { link: document.url, filename: document.nom_fichier },
      }],
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                telephone.replace('+', ''),
    type:              'template',
    template: {
      name:       template.nom,
      language:   { code: template.langue },
      components,
    },
  };

  logger.debug('Envoi WA template', { to: telephone, template: template.nom });

  try {
    const response = await fetch(
      `${WA_BASE_URL}/${WA_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${process.env.META_WA_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Meta API error ${response.status}: ${JSON.stringify(data)}`);
    }

    const messageId = data?.messages?.[0]?.id;
    logger.info('WhatsApp envoyé', { to: telephone, template: template.nom, messageId });

    return { succes: true, messageId };

  } catch (err) {
    logger.error('Erreur envoi WhatsApp', { error: err.message, to: telephone });
    throw err;
  }
}

/**
 * Webhook Meta — vérification de l'abonnement.
 */
function verifierWebhook(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WA_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Webhook Meta — réception des statuts de livraison.
 * Met à jour journal_notifications avec statut livré/lu.
 */
async function traiterWebhookStatut(entry) {
  // TODO: parser les statuts delivered/read et mettre à jour journal_notifications
  logger.debug('Webhook WA statut reçu', { entry: JSON.stringify(entry) });
}

module.exports = { envoyerTemplate, verifierWebhook, traiterWebhookStatut, TEMPLATES };
