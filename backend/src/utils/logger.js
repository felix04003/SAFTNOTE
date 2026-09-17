'use strict';

const winston = require('winston');

const { combine, timestamp, json, printf, colorize } = winston.format;

// Format simple pour le développement
const formatSimple = printf(({ level, message, timestamp, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}] ${message}${metaStr}`;
});

// Les fichiers de logs ne sont utiles que si le filesystem est persistant.
// Sur Render/Docker, le filesystem est éphémère et stdout est déjà capturé par la plateforme :
// les transports fichiers restent donc désactivés par défaut, même en production,
// et ne s'activent que si LOG_TO_FILE=true est explicitement positionné.
const logVersFichier = process.env.LOG_TO_FILE === 'true';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.LOG_FORMAT === 'json'
    ? combine(timestamp(), json())
    : combine(timestamp({ format: 'HH:mm:ss' }), colorize(), formatSimple),
  transports: [
    new winston.transports.Console(),
    ...(logVersFichier
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
  // Ne pas planter sur une erreur de log
  exitOnError: false,
});

// Niveau http pour Morgan
logger.http = (message) => logger.log('http', message);

module.exports = logger;
