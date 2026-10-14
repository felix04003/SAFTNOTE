// @ts-check
const { test, expect } = require('../fixtures');

/**
 * Tests E2E — Création d'un établissement par le wizard inscription.html
 * (seul point d'entrée depuis la fusion des parcours ; l'ancien onglet de login.html n'existe plus).
 *
 * Prérequis : backend sur http://localhost:3010 et dashboard servi avec l'API en même origine
 * (voir README) ; POST /inscription est limité en nombre d'appels par heure.
 */

async function etape1(page, nom = 'Lycée Test E2E') {
  await page.goto('/inscription.html');
  await page.fill('#etab-nom', nom);
  await page.fill('#etab-ville', 'Dakar');
  await page.click('#btn-etape2');
  await expect(page.locator('#panel2')).toHaveClass(/actif/);
}

async function etape2(page, { mdp = 'TestE2E123', mdp2 = mdp } = {}) {
  const uid = Date.now().toString().slice(-7);
  await page.fill('#dir-nom', 'Diallo');
  await page.fill('#dir-prenom', 'Mamadou');
  await page.fill('#dir-email', `directeur.e2e.${uid}@test.sn`);
  await page.fill('#dir-tel', `+22176${uid}`);
  await page.fill('#dir-mdp', mdp);
  await page.fill('#dir-mdp2', mdp2);
  await page.click('#btn-inscrire');
}

test('créer un établissement affiche le code officiel et le compte du directeur', async ({ page }) => {
  await etape1(page);
  await etape2(page);

  await expect(page.locator('#panel3')).toHaveClass(/actif/, { timeout: 15000 });
  const code = (await page.locator('#conf-code').textContent() || '').trim();
  expect(code).toBeTruthy();
  expect(code).not.toBe('—');
  await expect(page.locator('#conf-nom')).not.toHaveText('—');
  await expect(page.locator('a:has-text("Se connecter maintenant")')).toHaveAttribute('href', 'login.html');
});

test('"Se connecter maintenant" ouvre la page de connexion', async ({ page }) => {
  await etape1(page);
  await etape2(page);
  await expect(page.locator('#panel3')).toHaveClass(/actif/, { timeout: 15000 });

  await page.click('a:has-text("Se connecter maintenant")');
  await expect(page).toHaveURL(/login\.html/);
  await expect(page.locator('#login-form')).toBeVisible();
});

test('étape 1 sans nom d\'établissement : message d\'erreur, on reste sur l\'étape 1', async ({ page }) => {
  await page.goto('/inscription.html');
  await page.click('#btn-etape2');
  await expect(page.locator('#ins-err')).toContainText("nom de l'établissement");
  await expect(page.locator('#panel1')).toHaveClass(/actif/);
});

test('mot de passe trop faible : refusé avant tout envoi', async ({ page }) => {
  let envoye = false;
  await page.route('**/inscription', (route) => { envoye = true; route.abort(); });
  await etape1(page);
  await etape2(page, { mdp: 'court' });

  await expect(page.locator('#ins-err')).toBeVisible();
  await expect(page.locator('#panel2')).toHaveClass(/actif/);
  expect(envoye).toBe(false);
});

test('mots de passe différents : message d\'erreur', async ({ page }) => {
  await etape1(page);
  await etape2(page, { mdp: 'TestE2E123', mdp2: 'TestE2E124' });
  await expect(page.locator('#ins-err')).toContainText('ne correspondent pas');
});

test('login.html propose la création d\'un établissement', async ({ page }) => {
  await page.goto('/login.html');
  await page.click('a:has-text("Créer le vôtre")');
  await expect(page).toHaveURL(/inscription\.html/);
});
