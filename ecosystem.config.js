'use strict';

/**
 * Configuration PM2 — EcoleManager
 *
 * Usage :
 *   pm2 start ecosystem.config.js --env production
 *   pm2 reload ecosystem.config.js --env production   → zero-downtime
 *   pm2 stop all
 *   pm2 logs ecolemanager-api
 *   pm2 save && pm2 startup                           → persistence reboot
 */

module.exports = {
  apps: [

    // ── API — cluster multi-cœur ──────────────────────────────────
    {
      name:      'ecolemanager-api',
      script:    'src/app.js',
      cwd:       './backend',
      instances: 'max',        // 1 instance par cœur CPU
      exec_mode: 'cluster',
      watch:     false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
        PORT:     3010,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT:     3000,
      },

      out_file:        './logs/api-out.log',
      error_file:      './logs/api-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs:      true,

      listen_timeout: 5000,
      kill_timeout:   3000,
      wait_ready:     true,
    },

    // ── Worker — Notifications SMS/WhatsApp ───────────────────────
    {
      name:      'ecolemanager-worker-notif',
      script:    'src/workers/notification.worker.js',
      cwd:       './backend',
      instances: 1,
      exec_mode: 'fork',
      watch:     false,
      max_memory_restart: '256M',

      env: {
        NODE_ENV: 'development',
        WORKER_NOTIF_CONCURRENCY: 5,
      },
      env_production: {
        NODE_ENV: 'production',
        WORKER_NOTIF_CONCURRENCY: 5,
      },

      out_file:        './logs/worker-notif-out.log',
      error_file:      './logs/worker-notif-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ── Worker — Calcul des moyennes ──────────────────────────────
    {
      name:      'ecolemanager-worker-moyennes',
      script:    'src/workers/calcul-moyennes.worker.js',
      cwd:       './backend',
      instances: 1,
      exec_mode: 'fork',
      watch:     false,
      max_memory_restart: '256M',

      env: {
        NODE_ENV: 'development',
        WORKER_MOYENNES_CONCURRENCE: 2,
      },
      env_production: {
        NODE_ENV: 'production',
        WORKER_MOYENNES_CONCURRENCE: 2,
      },

      out_file:        './logs/worker-moyennes-out.log',
      error_file:      './logs/worker-moyennes-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

    // ── Worker — Génération bulletins PDF ─────────────────────────
    {
      name:      'ecolemanager-worker-bulletins',
      script:    'src/workers/generation-bulletins.worker.js',
      cwd:       './backend',
      instances: 1,
      exec_mode: 'fork',       // fork obligatoire — Puppeteer incompatible cluster
      watch:     false,
      max_memory_restart: '1G', // Puppeteer + Chromium ~ 300-600 Mo

      env: {
        NODE_ENV: 'development',
        WORKER_BULLETINS_CONCURRENCE: 1,
      },
      env_production: {
        NODE_ENV: 'production',
        WORKER_BULLETINS_CONCURRENCE: 1,
      },

      out_file:        './logs/worker-bulletins-out.log',
      error_file:      './logs/worker-bulletins-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },

  ],
};
