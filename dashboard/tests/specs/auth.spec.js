// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests E2E — Authentification dashboard EcoleManager
 *
 * Prérequis :
 *   - Backend sur http://localhost:3010
 *   - Dashboard servi sur http://localhost:3003
 *   - Un compte directeur existant dans la base (voir workflow-complet.spec.js)
 */

const CREDENTIALS = {
  identifiant: process.env.TEST_IDENTIFIANT || 'directeur@test.sn',
  mot_de_passe: process.env.TEST_MDP || 'Test1234!',
  etablissement_code: process.env.TEST_CODE_ETAB || 'TEST_LBD',
};

// ── Connexion avec identifiants valides ──────────────────────────
test('connexion avec identifiants valides redirige vers le dashboard', async ({ page }) => {
  await page.goto('/login.html');

  // Vérifier que la page de connexion est chargée
  await expect(page.locator('#login-form')).toBeVisible();

  // Remplir le formulaire
  await page.fill('#login-id', CREDENTIALS.identifiant);
  await page.fill('#login-pwd', CREDENTIALS.mot_de_passe);
  await page.fill('#login-etab', CREDENTIALS.etablissement_code);

  // Soumettre
  await page.click('#login-btn');

  // Après connexion, on est redirigé vers index.html
  await page.waitForURL(/index\.html/, { timeout: 10000 });

  // Le dashboard est affiché : la sidebar et le titre sont présents
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('#tb-titre')).toBeVisible();

  // Le token est stocké dans localStorage
  const token = await page.evaluate(() => localStorage.getItem('em_token'));
  expect(token).toBeTruthy();
  expect(token.split('.').length).toBe(3); // format JWT
});

// ── Connexion avec mauvais mot de passe ──────────────────────────
test('connexion avec mauvais mot de passe affiche un message d\'erreur', async ({ page }) => {
  await page.goto('/login.html');

  await page.fill('#login-id', CREDENTIALS.identifiant);
  await page.fill('#login-pwd', 'mauvais_mot_de_passe_incorrect');
  await page.fill('#login-etab', CREDENTIALS.etablissement_code);

  await page.click('#login-btn');

  // Le message d'erreur doit apparaître
  const errEl = page.locator('#login-err');
  await expect(errEl).toBeVisible({ timeout: 8000 });
  await expect(errEl).toHaveText(/.+/); // contient du texte

  // On reste sur login.html
  expect(page.url()).toContain('login.html');
});

// ── Connexion avec code établissement inconnu ────────────────────
test('connexion avec code établissement inconnu affiche une erreur', async ({ page }) => {
  await page.goto('/login.html');

  await page.fill('#login-id', CREDENTIALS.identifiant);
  await page.fill('#login-pwd', CREDENTIALS.mot_de_passe);
  await page.fill('#login-etab', 'CODE-INEXISTANT-9999');

  await page.click('#login-btn');

  const errEl = page.locator('#login-err');
  await expect(errEl).toBeVisible({ timeout: 8000 });

  expect(page.url()).toContain('login.html');
});

// ── Déconnexion ──────────────────────────────────────────────────
test('déconnexion redirige vers la page login et efface le token', async ({ page }) => {
  // Connexion préalable
  await page.goto('/login.html');
  await page.fill('#login-id', CREDENTIALS.identifiant);
  await page.fill('#login-pwd', CREDENTIALS.mot_de_passe);
  await page.fill('#login-etab', CREDENTIALS.etablissement_code);
  await page.click('#login-btn');
  await page.waitForURL(/index\.html/, { timeout: 10000 });

  // Cliquer sur le bouton déconnexion
  await page.click('#btn-logout');

  // Attendre la redirection vers login
  await page.waitForURL('**/login.html', { timeout: 8000 });

  // Le token doit être supprimé du localStorage
  const token = await page.evaluate(() => localStorage.getItem('em_token'));
  expect(token).toBeNull();

  // La page login est visible
  await expect(page.locator('#login-form')).toBeVisible();
});

// ── Redirection automatique si déjà connecté ────────────────────
test('accéder à login.html quand déjà connecté redirige vers le dashboard', async ({ page }) => {
  // Injecter un faux token valide dans localStorage avant de charger login.html
  await page.goto('/login.html');

  // Forcer un token factice (la page redirige si em_token existe)
  await page.evaluate(() => {
    localStorage.setItem('em_token', 'faux.token.jwt');
  });

  await page.goto('/login.html');

  // Doit être redirigé vers index.html
  await page.waitForURL(/index\.html/, { timeout: 5000 });

  // Nettoyer
  await page.evaluate(() => localStorage.removeItem('em_token'));
});

// ── Page index redirige vers login si non authentifié ────────────
test('accéder à index.html sans token redirige vers login.html', async ({ page }) => {
  // S'assurer qu'il n'y a pas de token
  await page.goto('/index.html');
  await page.evaluate(() => localStorage.removeItem('em_token'));

  await page.goto('/index.html');

  // Doit être redirigé vers login.html
  await page.waitForURL('**/login.html', { timeout: 8000 });
});
