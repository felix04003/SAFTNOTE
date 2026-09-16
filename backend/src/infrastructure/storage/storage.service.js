'use strict';

/**
 * storage.service.js — Client S3-compatible (MinIO dev / Cloudflare R2 prod)
 *
 * Dépendances : @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
 * (backend/package.json — corrigé au lot D, finding C2 de l'audit 2026-09 :
 * ces paquets étaient auparavant chargés dynamiquement sans être déclarés).
 *
 * Variables d'environnement :
 *   S3_ENDPOINT   — ex: http://localhost:9000 (MinIO) ou https://<account>.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY — Access key ID
 *   S3_SECRET_KEY — Secret access key
 *   S3_REGION     — Région (défaut: 'auto' pour R2, 'us-east-1' pour MinIO)
 *   S3_BUCKET     — Nom du bucket
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const logger = require('../../utils/logger');

// ── Détection de disponibilité ──────────────────────────────────

const VARS_REQUISES = ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET'];

// Durée par défaut de validité d'une URL signée (bulletins). Centralisée ici
// pour éviter de dupliquer la valeur dans chaque route qui appelle
// getUrlSignee() (bulletins.routes.js, parents.routes.js, sync.routes.js).
const DUREE_URL_SIGNEE_SECONDES = 3600;

function isDisponible() {
  return VARS_REQUISES.every((v) => Boolean(process.env[v]));
}

// ── Initialisation paresseuse du client ─────────────────────────

let _client = null;

function getClient() {
  if (_client) return _client;

  if (!isDisponible()) {
    return null;
  }

  _client = new S3Client({
    endpoint:        process.env.S3_ENDPOINT,
    region:          process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId:     process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    // Forcer le style path pour MinIO et R2 (pas de virtual-hosted)
    forcePathStyle: true,
  });

  return _client;
}

// ── Upload ──────────────────────────────────────────────────────

/**
 * Envoie un fichier dans le bucket S3.
 * @param {string} key           — Chemin dans le bucket (ex: 'bulletins/abc123.pdf')
 * @param {Buffer} buffer        — Contenu du fichier
 * @param {string} contentType   — MIME type (ex: 'application/pdf', 'image/jpeg')
 * @returns {Promise<string|null>} la CLÉ S3 (identique au paramètre `key`) en cas de
 *   succès, ou null si non disponible / échec. Ne retourne PLUS d'URL : les fichiers
 *   sont privés, l'accès se fait via getUrlSignee(key) au moment de la consultation.
 */
async function uploadFichier(key, buffer, contentType) {
  const client = getClient();
  if (!client) {
    logger.warn('Storage: uploadFichier ignoré — client non disponible', { key });
    return null;
  }

  try {
    const bucket = process.env.S3_BUCKET;

    await client.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        buffer,
      ContentType: contentType,
    }));

    logger.info('Storage: fichier uploadé', { key, contentType, bytes: buffer.length });
    return key;
  } catch (err) {
    logger.error('Storage: échec upload', { key, error: err.message });
    return null;
  }
}

// ── URL signée ──────────────────────────────────────────────────

/**
 * Génère une URL présignée pour un accès temporaire à un fichier privé.
 * @param {string} key               — Chemin dans le bucket
 * @param {number} expiresInSeconds  — Durée de validité en secondes (défaut: 3600)
 * @returns {Promise<string|null>} URL signée, ou null si non disponible
 */
async function getUrlSignee(key, expiresInSeconds = DUREE_URL_SIGNEE_SECONDES) {
  const client = getClient();
  if (!client) {
    logger.warn('Storage: getUrlSignee ignoré — client non disponible', { key });
    return null;
  }

  try {
    const commande = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
    });

    const url = await getSignedUrl(client, commande, { expiresIn: expiresInSeconds });
    logger.debug('Storage: URL signée générée', { key, expiresInSeconds });
    return url;
  } catch (err) {
    logger.error('Storage: échec génération URL signée', { key, error: err.message });
    return null;
  }
}

// ── Suppression ─────────────────────────────────────────────────

/**
 * Supprime un fichier du bucket S3.
 * @param {string} key — Chemin dans le bucket
 * @returns {Promise<void>}
 */
async function supprimerFichier(key) {
  const client = getClient();
  if (!client) {
    logger.warn('Storage: supprimerFichier ignoré — client non disponible', { key });
    return;
  }

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key:    key,
    }));

    logger.info('Storage: fichier supprimé', { key });
  } catch (err) {
    logger.error('Storage: échec suppression', { key, error: err.message });
  }
}

// ── Initialisation au démarrage ─────────────────────────────────

if (!isDisponible()) {
  logger.warn('Storage: variables S3 non configurées — service désactivé', {
    manquantes: VARS_REQUISES.filter((v) => !process.env[v]),
  });
}

module.exports = { uploadFichier, getUrlSignee, supprimerFichier, isDisponible, DUREE_URL_SIGNEE_SECONDES };
