'use strict';

// La documentation OpenAPI (/api/docs) doit suivre les routes : toute route Express ajoutée doit y figurer, et
// toute opération documentée doit exister. Les paramètres de chemin sont comparés sans tenir compte de leur nom.

const spec = require('../../src/swagger');

const MODULES = [
  'setup/setup.routes', '01-identites/identites.routes', '02-acteurs/auth/auth.routes', '02-acteurs/eleves/eleves.routes',
  '02-acteurs/parents/parents.routes', '02-acteurs/enseignants/enseignants.routes', '03-pedagogie/pedagogie.routes',
  '04-vie-scolaire/vie-scolaire.routes', '05-securite/securite.routes', 'sync.routes', 'notifications.routes',
  '02-acteurs/auth/rgpd.routes', 'exports/exports.routes',
];
const METHODES = ['get', 'post', 'put', 'delete', 'patch'];
const normaliser = (chemin) => chemin.replace(/:[A-Za-z_]+/g, '{}').replace(/\{[^}]+\}/g, '{}');

function collecter(pile, sortie) {
  for (const couche of pile) {
    if (couche.route) {
      for (const methode of Object.keys(couche.route.methods)) sortie.add(`${methode.toUpperCase()} ${normaliser(String(couche.route.path))}`);
    } else if (couche.handle && couche.handle.stack) {
      collecter(couche.handle.stack, sortie);
    }
  }
}

const routes = new Set();
for (const m of MODULES) collecter(require(`../../src/domains/${m}`).stack, routes);

const documentees = new Set();
for (const [chemin, operations] of Object.entries(spec.paths)) {
  for (const methode of Object.keys(operations).filter((k) => METHODES.includes(k))) documentees.add(`${methode.toUpperCase()} ${normaliser(chemin)}`);
}
// Définies dans app.js, hors des routeurs
const SANS_ROUTEUR = ['GET /health'];

describe('documentation OpenAPI', () => {
  test('chaque route Express est documentée', () => {
    expect([...routes].filter((r) => !documentees.has(r)).sort()).toEqual([]);
  });

  test('chaque opération documentée correspond à une route (sauf /health, défini dans app.js)', () => {
    const orphelines = [...documentees].filter((d) => !routes.has(d) && !SANS_ROUTEUR.includes(d));
    expect(orphelines.sort()).toEqual([]);
  });

  test('chaque opération a un tag déclaré, un résumé et au moins une réponse', () => {
    const declares = new Set(spec.tags.map((t) => t.name));
    const defauts = [];
    for (const [chemin, operations] of Object.entries(spec.paths)) {
      for (const methode of Object.keys(operations).filter((k) => METHODES.includes(k))) {
        const o = operations[methode];
        if (!o.tags || !o.tags.length || !o.tags.every((t) => declares.has(t))) defauts.push(`${methode.toUpperCase()} ${chemin} : tag`);
        if (!o.summary) defauts.push(`${methode.toUpperCase()} ${chemin} : résumé`);
        if (!o.responses || !Object.keys(o.responses).length) defauts.push(`${methode.toUpperCase()} ${chemin} : réponses`);
      }
    }
    expect(defauts).toEqual([]);
  });

  test('les paramètres de chemin sont déclarés pour chaque {nom} du chemin', () => {
    const manquants = [];
    for (const [chemin, operations] of Object.entries(spec.paths)) {
      const noms = [...chemin.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const methode of Object.keys(operations).filter((k) => METHODES.includes(k))) {
        const declares = (operations[methode].parameters || []).filter((p) => p.in === 'path').map((p) => p.name);
        for (const n of noms) if (!declares.includes(n)) manquants.push(`${methode.toUpperCase()} ${chemin} : {${n}}`);
      }
    }
    expect(manquants).toEqual([]);
  });
});
