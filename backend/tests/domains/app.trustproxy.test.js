'use strict';

/**
 * Vérifie le réglage `trust proxy` (B1 — lot correctif proxy/sessions).
 *
 * `src/app.js` exécute `start()` (connexion DB, Redis, écoute du port…)
 * dès son require() — il n'est donc pas réutilisable tel quel dans un test
 * unitaire. On reproduit ici la ligne exacte ajoutée à `app.js` :
 *   app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS, 10) || 1);
 * sur une app Express minimale, avec le même rate limiter `express-rate-limit`
 * que `app.js`, pour vérifier que :
 *   1. `req.ip` reflète bien l'IP du client transmise via X-Forwarded-For.
 *   2. Deux IPs distinctes ne partagent pas le même compteur de rate limit.
 */

const express   = require('express');
const supertest = require('supertest');
const rateLimit = require('express-rate-limit');

function createAppAvecTrustProxy(hops) {
  const app = express();
  app.set('trust proxy', hops);

  app.get('/ip', (req, res) => res.json({ ip: req.ip }));

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    message: { succes: false, erreur: 'RATE_LIMIT' },
  });
  app.get('/limitee', limiter, (req, res) => res.json({ ok: true }));

  return app;
}

describe('trust proxy (B1)', () => {
  it('sans trust proxy configuré, req.ip = IP du proxy (comportement par défaut Express)', async () => {
    const app = createAppAvecTrustProxy(0); // équivalent à ne pas faire confiance au proxy
    const res = await supertest(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.7');

    // Sans trust proxy, Express ignore X-Forwarded-For.
    expect(res.body.ip).not.toBe('203.0.113.7');
  });

  it('avec trust proxy=1, req.ip lit la première IP de X-Forwarded-For', async () => {
    const app = createAppAvecTrustProxy(1);
    const res = await supertest(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.7');

    expect(res.body.ip).toBe('203.0.113.7');
  });

  it('avec trust proxy=1, deux IP client différentes ne partagent pas le compteur du rate limiter', async () => {
    const app = createAppAvecTrustProxy(1);
    const request = supertest(app);

    // IP A : 1ère requête OK, 2e requête bloquée (max=1/min)
    await request.get('/limitee').set('X-Forwarded-For', '198.51.100.1').expect(200);
    await request.get('/limitee').set('X-Forwarded-For', '198.51.100.1').expect(429);

    // IP B : doit avoir son propre compteur, donc 200 malgré le blocage de l'IP A
    await request.get('/limitee').set('X-Forwarded-For', '198.51.100.2').expect(200);
  });
});
