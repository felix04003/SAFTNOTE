// @ts-check
const { test, expect } = require('../fixtures');

/**
 * E2E Phase 4.5 : parcours web des comptes, API entièrement simulée
 * (aucun backend requis, seul le dashboard doit être servi sur le port 3003).
 *  (a) enseignant à mot de passe provisoire → changement → espace
 *  (b) parent : jeton expiré → rafraîchissement silencieux
 *  (c) liens entre pages de connexion
 *  (d) pas de débordement horizontal en 375×667
 */

const OK_VIDE = { succes: true, data: [] };
const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('(a) mot de passe provisoire : connexion → changement obligatoire → espace enseignant', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/auth/connexion')) {
      return json(route, 200, { succes: true, data: {
        token: 't1', refresh_token: 'r1',
        utilisateur: { id: 'u1', prenom: 'Awa', nom: 'Diop', role: 'enseignant', etablissement_nom: 'Lycée Test', doit_changer_mdp: true },
      } });
    }
    if (url.endsWith('/auth/changer-mot-de-passe')) return json(route, 200, { succes: true, data: {} });
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/login.html');
  await page.fill('#login-id', '771110001');
  await page.fill('#login-pwd', 'Provisoire1');
  await page.fill('#login-etab', 'TEST');
  await page.click('#login-btn');

  await page.waitForURL(/changer-mot-de-passe\.html/);
  await page.fill('#mdp-actuel', 'Provisoire1');
  await page.fill('#mdp-nouveau', 'NouveauMdp9');
  await page.fill('#mdp-confirm', 'NouveauMdp9');
  await page.click('#btn-changer');

  await page.waitForURL(/enseignant\.html/);
  // 4.1 : la barre latérale est renseignée
  await expect(page.locator('#sb-user-nom')).toHaveText('Awa Diop');
  await expect(page.locator('#sb-etab-nom')).toHaveText('Lycée Test');
});

test('(b) parent : jeton expiré, rafraîchissement silencieux sans retour à la connexion', async ({ page }) => {
  let refreshes = 0;
  const jetonsVus = [];
  await page.addInitScript(() => {
    sessionStorage.setItem('em_token', 'vieux');
    sessionStorage.setItem('em_refresh_token', 'r1');
    localStorage.setItem('em_user', JSON.stringify({ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Lycée Test' }));
  });
  await page.route('**/api/v1/**', (route) => {
    const req = route.request();
    if (req.url().endsWith('/auth/refresh')) {
      refreshes++;
      return json(route, 200, { succes: true, data: { token: 'neuf', refresh_token: 'r2' } });
    }
    const auth = req.headers()['authorization'] || '';
    jetonsVus.push(auth);
    if (auth === 'Bearer vieux') return json(route, 401, { succes: false, erreur: 'Token expiré', code: 'NON_AUTORISE' });
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/parent.html');
  await expect.poll(() => jetonsVus.includes('Bearer neuf')).toBe(true);
  expect(refreshes).toBeGreaterThanOrEqual(1);
  await expect(page).toHaveURL(/parent\.html/);
  expect(await page.evaluate(() => sessionStorage.getItem('em_token'))).toBe('neuf');
});

test('(b bis) session fermée par la limite d\'appareils : retour à la connexion avec explication', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('em_token', 'vieux');
    sessionStorage.setItem('em_refresh_token', 'r1');
    localStorage.setItem('em_user', JSON.stringify({ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent' }));
  });
  await page.route('**/api/v1/**', (route) => {
    if (route.request().url().endsWith('/auth/refresh')) {
      return json(route, 401, { succes: false, erreur: "Vous avez été déconnecté : trop d'appareils connectés avec ce compte", code: 'SESSION_REVOQUEE' });
    }
    return json(route, 401, { succes: false, erreur: 'Token expiré', code: 'NON_AUTORISE' });
  });

  await page.goto('/parent.html');
  await page.waitForURL(/parent-login\.html/);
  await expect(page.locator('#err1')).toContainText("trop d'appareils");
});

test('(c) les deux pages de connexion se renvoient l\'une à l\'autre', async ({ page }) => {
  await page.goto('/login.html');
  await page.click('#lien-parent');
  await expect(page).toHaveURL(/parent-login\.html/);
  await page.click('a[href="login.html"]');
  await expect(page).toHaveURL(/login\.html/);
});

test.describe('(d) écran de téléphone 375×667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  for (const chemin of ['/login.html', '/parent-login.html', '/inscription.html', '/mot-de-passe-oublie.html']) {
    test(`pas de défilement horizontal : ${chemin}`, async ({ page }) => {
      await page.goto(chemin);
      const { scroll, largeur } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, largeur: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(largeur);
    });
  }

  for (const chemin of ['/changer-mot-de-passe.html', '/parent.html']) {
    test(`pas de défilement horizontal (connecté) : ${chemin}`, async ({ page }) => {
      await page.addInitScript(() => {
        sessionStorage.setItem('em_token', 't');
        localStorage.setItem('em_user', JSON.stringify({ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Lycée Test' }));
      });
      await page.route('**/api/v1/**', (route) => json(route, 200, OK_VIDE));
      await page.goto(chemin);
      await page.waitForLoadState('networkidle');
      const { scroll, largeur } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, largeur: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(largeur);
    });
  }
});

test('(e) parent présent dans deux écoles : code SMS sans code établissement, puis choix de l\'école', async ({ page }) => {
  const corps = [];
  await page.route('**/api/v1/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/auth/otp/demander')) { corps.push(route.request().postDataJSON()); return json(route, 200, { succes: true, data: {} }); }
    if (url.endsWith('/auth/otp/valider')) {
      corps.push(route.request().postDataJSON());
      return json(route, 200, { succes: true, data: {
        choix_requis: true, ticket: 'ticket-signe-0123456789',
        etablissements: [{ code: 'A', nom: 'Lycée A' }, { code: 'B', nom: 'Collège B' }],
      } });
    }
    if (url.endsWith('/auth/otp/choisir')) {
      corps.push(route.request().postDataJSON());
      return json(route, 200, { succes: true, data: {
        token: 't', refresh_token: 'r',
        utilisateur: { id: 'p2', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Collège B' },
      } });
    }
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/parent-login.html');
  await page.fill('#inp-telephone', '77 222 05 01');            // pas de code établissement
  await page.click('#btn-demander');
  const cases = page.locator('#otp-inputs input');
  for (let i = 0; i < 6; i++) await cases.nth(i).fill(String(i + 1));
  await page.click('#btn-valider');

  await expect(page.locator('#liste-etablissements button')).toHaveCount(2);
  await page.click('text=Collège B');
  await page.waitForURL(/parent\.html/);

  expect(corps[0]).toEqual({ telephone: '77 222 05 01' });       // aucune clé etablissement_code envoyée
  expect(corps[2]).toEqual({ ticket: 'ticket-signe-0123456789', etablissement_code: 'B' });
});

test('(f) parent.html : sélecteur d\'école, bascule sans rechargement de la page', async ({ page }) => {
  const bascules = [];
  await page.addInitScript(() => {
    if (sessionStorage.getItem('em_token')) return;
    sessionStorage.setItem('em_token', 't1');
    localStorage.setItem('em_user', JSON.stringify({ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Lycée A' }));
  });
  await page.route('**/api/v1/**', (route) => {
    const req = route.request();
    const url = req.url();
    const dansB = (req.headers()['authorization'] || '') === 'Bearer t2';
    if (url.endsWith('/auth/mes-etablissements')) {
      return json(route, 200, { succes: true, data: [{ code: 'A', nom: 'Lycée A', courant: !dansB }, { code: 'B', nom: 'Collège B', courant: dansB }] });
    }
    if (url.endsWith('/parents/moi/enfants')) {
      // Les enfants dépendent de l'école de la session
      return json(route, 200, { succes: true, data: [dansB
        ? { eleve_utilisateur_id: 'e2', prenom: 'Aida', nom: 'Ndiaye', classe: '5e B' }
        : { eleve_utilisateur_id: 'e1', prenom: 'Moussa', nom: 'Ndiaye', classe: '6e A' }] });
    }
    if (url.endsWith('/auth/changer-etablissement')) {
      const corps = req.postDataJSON();
      bascules.push(corps.etablissement_code);
      const versB = corps.etablissement_code === 'B';
      return json(route, 200, { succes: true, data: { token: versB ? 't2' : 't3', refresh_token: 'r2', utilisateur: { id: versB ? 'p2' : 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: versB ? 'Collège B' : 'Lycée A' } } });
    }
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/parent.html');
  const sel = page.locator('#par-ecole-sel');
  await expect(sel).toBeVisible();
  await expect(sel.locator('option')).toHaveText(['Lycée A', 'Collège B']);
  await expect(sel).toHaveValue('A');
  await expect(page.locator('#par-enfant-wrap')).toContainText('Moussa');

  // Marqueur posé dans la page : s'il survit à la bascule, la page n'a pas été rechargée
  await page.evaluate(() => { window.__avantBascule = true; });

  await sel.selectOption('B');
  await expect(page.locator('#sb-etab-nom')).toHaveText('Collège B');
  await expect(page.locator('#par-enfant-wrap')).toContainText('Aida');       // enfant de la nouvelle école
  await expect(page.locator('#par-enfant-wrap')).not.toContainText('Moussa'); // plus rien de l'ancienne
  await expect(sel).toHaveValue('B');
  await expect(sel).toBeEnabled();
  expect(await page.evaluate(() => window.__avantBascule)).toBe(true);        // pas de rechargement
  expect(await page.evaluate(() => sessionStorage.getItem('em_token'))).toBe('t2');

  // Retour dans la première école : une seule requête par choix (pas d'écouteurs empilés)
  await sel.selectOption('A');
  await expect(page.locator('#sb-etab-nom')).toHaveText('Lycée A');
  await expect(page.locator('#par-enfant-wrap')).toContainText('Moussa');
  expect(bascules).toEqual(['B', 'A']);
  expect(await page.evaluate(() => window.__avantBascule)).toBe(true);
});

test('(f bis) bascule d\'école : une réponse de l\'ancienne école arrivée en retard n\'est pas affichée', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('em_token')) return;
    sessionStorage.setItem('em_token', 't1');
    localStorage.setItem('em_user', JSON.stringify({ id: 'p1', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Lycée A' }));
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const dansB = (req.headers()['authorization'] || '') === 'Bearer t2';
    if (url.endsWith('/auth/mes-etablissements')) {
      return json(route, 200, { succes: true, data: [{ code: 'A', nom: 'Lycée A', courant: !dansB }, { code: 'B', nom: 'Collège B', courant: dansB }] });
    }
    if (url.endsWith('/parents/moi/enfants')) {
      return json(route, 200, { succes: true, data: [{ eleve_utilisateur_id: dansB ? 'e2' : 'e1', prenom: dansB ? 'Aida' : 'Moussa', nom: 'Ndiaye', classe: dansB ? '5e B' : '6e A' }] });
    }
    if (url.endsWith('/auth/changer-etablissement')) {
      return json(route, 200, { succes: true, data: { token: 't2', refresh_token: 'r2', utilisateur: { id: 'p2', prenom: 'Papa', nom: 'Ndiaye', role: 'parent', etablissement_nom: 'Collège B' } } });
    }
    if (url.endsWith('/notifications')) {
      if (dansB) return json(route, 200, { succes: true, data: { total: 0 } });
      await new Promise((r) => setTimeout(r, 1500));            // l'ancienne école répond APRÈS la bascule
      return json(route, 200, { succes: true, data: { total: 9, categories: [] } });
    }
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/parent.html');
  await expect(page.locator('#par-ecole-sel')).toBeVisible();
  await page.locator('#par-ecole-sel').selectOption('B');
  await expect(page.locator('#sb-etab-nom')).toHaveText('Collège B');

  // Laisser arriver la réponse tardive de l'ancienne école (1,5 s) : le badge ne doit jamais passer à 9
  await page.waitForTimeout(2200);
  await expect(page.locator('#notif-badge')).toHaveText('0');
  await expect(page.locator('#notif-badge')).not.toHaveClass(/show/);
});

test('(g) paramètres : le directeur règle la politique de sécurité', async ({ page }) => {
  let envoye;
  await page.addInitScript(() => {
    sessionStorage.setItem('em_token', 't');
    localStorage.setItem('em_user', JSON.stringify({ id: 'd1', prenom: 'Awa', nom: 'Diop', role: 'directeur', etablissement_nom: 'Lycée A' }));
  });
  await page.route('**/api/v1/**', (route) => {
    const req = route.request();
    if (req.url().endsWith('/securite/politique')) {
      if (req.method() === 'PUT') { envoye = req.postDataJSON(); return json(route, 200, { succes: true, data: envoye }); }
      return json(route, 200, { succes: true, data: { mdp_longueur_min: 8, session_max_simultanees: 3, blocage_nb_tentatives: 5, blocage_duree_minutes: 15 } });
    }
    return json(route, 200, OK_VIDE);
  });

  await page.goto('/index.html');
  await page.click('.nav-item[data-page="parametres"]');
  await expect(page.locator('#pol-sessions')).toHaveValue('3');

  await page.fill('#pol-blocage', '4');                         // hors bornes : refusé sans requête
  await page.click('#btn-politique-save');
  await expect(page.locator('#politique-err')).toContainText('durée du blocage');
  expect(envoye).toBeUndefined();

  await page.fill('#pol-blocage', '30');
  await page.fill('#pol-sessions', '5');
  await page.click('#btn-politique-save');
  await expect.poll(() => envoye).toEqual({ mdp_longueur_min: 8, session_max_simultanees: 5, blocage_nb_tentatives: 5, blocage_duree_minutes: 30 });
});
