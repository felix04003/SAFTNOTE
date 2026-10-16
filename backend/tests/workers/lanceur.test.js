'use strict';

const { EventEmitter } = require('events');
const { lancer, nomsDemandes } = require('../../src/workers/lanceur');

function faux() {
  const appels = [];
  const forkFn = jest.fn((fichier) => {
    const e = new EventEmitter();
    e.pid = 100 + appels.length;
    e.kill = jest.fn(() => setImmediate(() => e.emit('exit', 0, 'SIGTERM')));
    appels.push({ fichier, enfant: e });
    return e;
  });
  const minuteurs = [];
  const setTimeoutFn = jest.fn((fn, ms) => { const m = { fn, ms }; minuteurs.push(m); return m; });
  let t = 0;
  return { appels, forkFn, minuteurs, setTimeoutFn, maintenant: () => t, avancer: (ms) => { t += ms; }, log: { info: jest.fn(), error: jest.fn() } };
}

describe('lanceur de workers', () => {
  test('démarre un processus par worker demandé', () => {
    const f = faux();
    lancer(['notification', 'moyennes'], f);
    expect(f.appels.map((a) => a.fichier.split('/').pop())).toEqual(['notification.worker.js', 'calcul-moyennes.worker.js']);
  });

  test('relance un worker qui s\'arrête, avec un délai qui double tant qu\'il retombe vite', () => {
    const f = faux();
    lancer(['moyennes'], f);

    f.appels[0].enfant.emit('exit', 1, null);
    expect(f.minuteurs[0].ms).toBe(2000);
    f.minuteurs[0].fn();
    expect(f.appels).toHaveLength(2);

    f.appels[1].enfant.emit('exit', 1, null);
    expect(f.minuteurs[1].ms).toBe(4000);
  });

  test('un worker resté vivant longtemps repart avec le délai minimal', () => {
    const f = faux();
    lancer(['moyennes'], f);
    f.appels[0].enfant.emit('exit', 1, null);          // délai 2 s, le suivant serait 4 s
    f.minuteurs[0].fn();
    f.avancer(60000);                                   // tient une minute
    f.appels[1].enfant.emit('exit', 1, null);
    expect(f.minuteurs[1].ms).toBe(2000);
  });

  test('à l\'arrêt, prévient chaque enfant, attend leur fin et ne relance rien', async () => {
    const f = faux();
    const { arreter } = lancer(['notification', 'bulletins'], f);
    await arreter();
    f.appels.forEach((a) => expect(a.enfant.kill).toHaveBeenCalledWith('SIGTERM'));
    expect(f.minuteurs).toHaveLength(0);
    expect(f.forkFn).toHaveBeenCalledTimes(2);
  });

  test('worker inconnu : erreur claire', () => {
    expect(() => lancer(['inconnu'], faux())).toThrow(/Worker inconnu/);
    expect(() => nomsDemandes({ WORKERS: 'notification,nimporte' })).toThrow(/nimporte/);
  });

  test('par défaut : les trois workers', () => {
    expect(nomsDemandes({})).toEqual(['notification', 'moyennes', 'bulletins']);
  });
});
