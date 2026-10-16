'use strict';

/**
 * Lanceur des workers BullMQ : un seul processus à déployer là où chaque worker ne justifie pas son propre service
 * (ex. Render : un « background worker » = un service payant).
 *
 * Chaque worker garde son propre processus (fork) : le worker de bulletins lance Chromium et peut planter sans
 * emporter les notifications. Un worker qui s'arrête est relancé avec un délai croissant ; à l'arrêt (SIGTERM,
 * SIGINT) on prévient les enfants et on attend leur fin (leur propre arrêt propre ferme BullMQ, Redis et la base).
 *
 *   node src/workers/lanceur.js            # notifications + moyennes + bulletins
 *   WORKERS=notification,moyennes node src/workers/lanceur.js
 */

const path = require('path');
const { fork } = require('child_process');

const WORKERS = {
  notification: 'notification.worker.js',
  moyennes:     'calcul-moyennes.worker.js',
  bulletins:    'generation-bulletins.worker.js',
};

const DELAI_MIN_MS = 2000;
const DELAI_MAX_MS = 60000;
const STABLE_APRES_MS = 30000;      // un worker resté vivant aussi longtemps repart avec le délai minimal

/**
 * @param {string[]} noms             clés de WORKERS
 * @param {object}   [deps]           injectables pour les tests
 * @returns {{ arreter: () => Promise<void>, enfants: Map }}
 */
function lancer(noms, { forkFn = fork, setTimeoutFn = setTimeout, maintenant = Date.now, log = console } = {}) {
  const enfants = new Map();            // nom -> processus
  const delais  = new Map();            // nom -> prochain délai de relance
  const minuteurs = new Set();
  let arret = false;

  function demarrer(nom) {
    const fichier = WORKERS[nom];
    if (!fichier) throw new Error(`Worker inconnu : ${nom} (attendus : ${Object.keys(WORKERS).join(', ')})`);

    const debut = maintenant();
    const enfant = forkFn(path.join(__dirname, fichier), [], { env: process.env });
    enfants.set(nom, enfant);
    log.info(`[workers] ${nom} démarré (pid ${enfant.pid})`);

    enfant.once('exit', (code, signal) => {
      enfants.delete(nom);
      if (arret) return;
      const vecu = maintenant() - debut;
      const delai = vecu >= STABLE_APRES_MS ? DELAI_MIN_MS : (delais.get(nom) ?? DELAI_MIN_MS);
      delais.set(nom, Math.min(delai * 2, DELAI_MAX_MS));
      log.error(`[workers] ${nom} arrêté (code ${code}, signal ${signal}) — relance dans ${delai} ms`);
      const minuteur = setTimeoutFn(() => { minuteurs.delete(minuteur); if (!arret) demarrer(nom); }, delai);
      minuteurs.add(minuteur);
    });
  }

  noms.forEach(demarrer);

  async function arreter() {
    arret = true;
    for (const m of minuteurs) clearTimeout(m);
    await Promise.all([...enfants.values()].map((enfant) => new Promise((resolve) => {
      enfant.once('exit', resolve);
      enfant.kill('SIGTERM');
    })));
  }

  return { arreter, enfants };
}

function nomsDemandes(env = process.env) {
  const demandes = (env.WORKERS || Object.keys(WORKERS).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const inconnus = demandes.filter((n) => !WORKERS[n]);
  if (inconnus.length) throw new Error(`WORKERS : inconnu(s) ${inconnus.join(', ')} (attendus : ${Object.keys(WORKERS).join(', ')})`);
  return demandes;
}

module.exports = { lancer, nomsDemandes, WORKERS };

if (require.main === module) {
  const lanceur = lancer(nomsDemandes());
  const fin = async (signal) => {
    console.info(`[workers] ${signal} — arrêt des workers`);
    await lanceur.arreter();
    process.exit(0);
  };
  process.on('SIGTERM', () => fin('SIGTERM'));
  process.on('SIGINT',  () => fin('SIGINT'));
}
