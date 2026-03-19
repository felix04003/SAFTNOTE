// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests E2E — Création d'un établissement depuis la page login
 *
 * Prérequis :
 *   - Backend sur http://localhost:3010
 *   - Dashboard servi sur http://localhost:3003
 */

// ── Création d'un nouvel établissement ──────────────────────────
test('créer un établissement affiche le code officiel en message de succès', async ({ page }) => {
  await page.goto('/login.html');

  // Cliquer sur l'onglet "Créer un établissement"
  await page.click('button:has-text("Créer un établissement")');

  // Vérifier que le panneau d'inscription est visible
  await expect(page.locator('#panel-inscription')).toHaveClass(/actif/);
  await expect(page.locator('#inscription-form-wrap')).toBeVisible();

  // Remplir le formulaire — informations école
  await page.fill('#ins-nom', 'Lycée Test E2E');
  await page.selectOption('#ins-type', 'lycee');
  await page.selectOption('#ins-pays', 'Sénégal');
  await page.fill('#ins-ville', 'Dakar');

  // Informations directeur
  const uid = Date.now().toString().slice(-6);
  await page.fill('#ins-prenom', 'Mamadou');
  await page.fill('#ins-nom-dir', 'Diallo');
  await page.fill('#ins-tel', `+22177${uid}`);
  await page.fill('#ins-email', `directeur.e2e.${uid}@test.sn`);
  await page.fill('#ins-mdp', 'TestE2E123');

  // Soumettre
  await page.click('#ins-btn');

  // Attendre l'affichage du succès
  const successBox = page.locator('#inscription-success');
  await expect(successBox).toBeVisible({ timeout: 15000 });

  // Le code officiel est affiché et non vide
  const codeOfficiel = page.locator('#code-officiel');
  await expect(codeOfficiel).toBeVisible();
  const codeText = await codeOfficiel.textContent();
  expect(codeText).toBeTruthy();
  expect(codeText.trim()).not.toBe('—');
  // Le code suit le pattern : INITIALES-VILLE-XXXX
  expect(codeText.trim()).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);

  // Le formulaire est masqué
  await expect(page.locator('#inscription-form-wrap')).not.toBeVisible();

  // Le bouton "Se connecter maintenant" est visible
  await expect(page.locator('button:has-text("Se connecter maintenant")')).toBeVisible();
});

// ── Retour connexion après création ─────────────────────────────
test('cliquer "Se connecter maintenant" après création revient sur le formulaire connexion', async ({ page }) => {
  await page.goto('/login.html');

  // Basculer sur inscription
  await page.click('button:has-text("Créer un établissement")');

  // Remplir et soumettre
  const uid = Date.now().toString().slice(-6);
  await page.fill('#ins-nom', 'Lycée Test E2E 2');
  await page.fill('#ins-ville', 'Abidjan');
  await page.fill('#ins-prenom', 'Kouassi');
  await page.fill('#ins-nom-dir', 'Yao');
  await page.fill('#ins-tel', `+22507${uid}`);
  await page.fill('#ins-mdp', 'MotDePasse123');

  await page.click('#ins-btn');

  // Attendre le succès
  await expect(page.locator('#inscription-success')).toBeVisible({ timeout: 15000 });

  // Cliquer "Se connecter maintenant"
  await page.click('button:has-text("Se connecter maintenant")');

  // Doit revenir sur le panneau connexion
  await expect(page.locator('#panel-connexion')).toHaveClass(/actif/);
  await expect(page.locator('#login-form')).toBeVisible();

  // Les champs identifiant et code établissement sont pré-remplis
  const loginId = await page.inputValue('#login-id');
  const loginEtab = await page.inputValue('#login-etab');
  expect(loginId).toBeTruthy();  // le champ est pré-rempli (valeur dynamique)
  expect(loginEtab).toBeTruthy();
  expect(loginEtab).toMatch(/^[A-Z]+-[A-Z]+-\d{4}$/);
});

// ── Validation : champs obligatoires manquants ──────────────────
test('soumettre le formulaire sans champs obligatoires affiche une erreur', async ({ page }) => {
  await page.goto('/login.html');

  await page.click('button:has-text("Créer un établissement")');

  // Cliquer directement sans remplir
  await page.click('#ins-btn');

  // Le message d'erreur doit apparaître
  const errEl = page.locator('#inscription-err');
  await expect(errEl).toBeVisible();
  await expect(errEl).toHaveText(/obligatoires/i);
});

// ── Validation : mot de passe trop court ────────────────────────
test('mot de passe trop court affiche une erreur de validation', async ({ page }) => {
  await page.goto('/login.html');

  await page.click('button:has-text("Créer un établissement")');

  await page.fill('#ins-nom', 'Lycée Test');
  await page.fill('#ins-ville', 'Dakar');
  await page.fill('#ins-prenom', 'Moussa');
  await page.fill('#ins-nom-dir', 'Sow');
  await page.fill('#ins-tel', '+221771234567');
  await page.fill('#ins-mdp', 'ab'); // trop court

  await page.click('#ins-btn');

  const errEl = page.locator('#inscription-err');
  await expect(errEl).toBeVisible();
  await expect(errEl).toHaveText(/6 caractères/i);
});

// ── Navigation entre onglets ─────────────────────────────────────
test('basculer entre les onglets connexion / inscription fonctionne', async ({ page }) => {
  await page.goto('/login.html');

  // Vérifier état initial : onglet connexion actif
  await expect(page.locator('#panel-connexion')).toHaveClass(/actif/);
  await expect(page.locator('#panel-inscription')).not.toHaveClass(/actif/);

  // Passer à l'inscription
  await page.click('button:has-text("Créer un établissement")');
  await expect(page.locator('#panel-inscription')).toHaveClass(/actif/);
  await expect(page.locator('#panel-connexion')).not.toHaveClass(/actif/);

  // Revenir à la connexion
  await page.click('button:has-text("Se connecter")');
  await expect(page.locator('#panel-connexion')).toHaveClass(/actif/);
  await expect(page.locator('#panel-inscription')).not.toHaveClass(/actif/);
});
