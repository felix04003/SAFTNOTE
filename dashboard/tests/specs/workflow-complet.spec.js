// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Tests E2E — Workflow complet (nécessite un établissement existant)
 *
 * Prérequis :
 *   - Backend sur http://localhost:3010 avec base de données peuplée
 *   - Dashboard servi sur http://localhost:3003
 *   - Variables d'environnement TEST_IDENTIFIANT, TEST_MDP, TEST_CODE_ETAB configurées
 *     (ou valeurs par défaut ci-dessous)
 */

const CREDENTIALS = {
  identifiant: process.env.TEST_IDENTIFIANT || 'directeur@test.sn',
  mot_de_passe: process.env.TEST_MDP || 'Test1234!',
  etablissement_code: process.env.TEST_CODE_ETAB || 'TEST_LBD',
};

/**
 * Helper : se connecter et attendre le dashboard.
 */
async function seConnecter(page) {
  await page.goto('/login.html');
  await page.fill('#login-id', CREDENTIALS.identifiant);
  await page.fill('#login-pwd', CREDENTIALS.mot_de_passe);
  await page.fill('#login-etab', CREDENTIALS.etablissement_code);
  await page.click('#login-btn');
  await page.waitForURL(/index\.html/, { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
}

// ── Étape 1 : connexion ──────────────────────────────────────────
test('étape 1 — connexion directeur', async ({ page }) => {
  await seConnecter(page);

  // Dashboard chargé : titre visible
  await expect(page.locator('#tb-titre')).toHaveText('Tableau de bord');

  // Le nom de l'établissement est dans la sidebar
  const etabNom = page.locator('.sb-etab');
  await expect(etabNom).toBeVisible();

  // Le token est dans localStorage
  const token = await page.evaluate(() => localStorage.getItem('em_token'));
  expect(token).toBeTruthy();
});

// ── Étape 2 : navigation vers les pages ─────────────────────────
test('étape 2 — navigation vers toutes les pages principales', async ({ page }) => {
  await seConnecter(page);

  const pages = [
    { hash: 'eleves',      titre: 'Élèves' },
    { hash: 'enseignants', titre: 'Enseignants' },
    { hash: 'classes',     titre: 'Classes' },
    { hash: 'notes',       titre: 'Notes & Évaluations' },
    { hash: 'bulletins',   titre: 'Bulletins' },
    { hash: 'absences',    titre: 'Absences & Présences' },
    { hash: 'parametres',  titre: 'Paramètres' },
  ];

  for (const p of pages) {
    // Cliquer sur le lien de navigation
    await page.click(`[data-page="${p.hash}"]`);

    // Vérifier que la page active a le bon titre
    await expect(page.locator('#tb-titre')).toHaveText(p.titre, { timeout: 5000 });

    // Vérifier que la page correspondante est active
    const pageEl = page.locator(`#page-${p.hash}`);
    await expect(pageEl).toHaveClass(/active/);

    // Vérifier que le hash dans l'URL est mis à jour
    expect(page.url()).toContain(`#${p.hash}`);
  }
});

// ── Étape 3 : créer une classe ───────────────────────────────────
test('étape 3 — créer une classe via le modal', async ({ page }) => {
  await seConnecter(page);

  // Aller sur la page Classes
  await page.click('[data-page="classes"]');
  await expect(page.locator('#page-classes')).toHaveClass(/active/);

  // Ouvrir le modal "Nouvelle classe"
  await page.click('button:has-text("+ Nouvelle classe")');

  // Vérifier que le modal est ouvert
  const modal = page.locator('#m-classe');
  await expect(modal).toHaveClass(/visible|show|active|open/, { timeout: 3000 });

  // Sélectionner un niveau (le premier disponible)
  const niveauSelect = page.locator('#m-classe-niveau');
  await expect(niveauSelect).toBeVisible();

  // Attendre que les options soient chargées (depuis l'API)
  await page.waitForFunction(() => {
    const sel = document.getElementById('m-classe-niveau');
    return sel && sel.options.length > 1;
  }, { timeout: 8000 });

  // Sélectionner le premier niveau disponible
  const options = await niveauSelect.locator('option').all();
  if (options.length > 1) {
    const firstValue = await options[1].getAttribute('value');
    await niveauSelect.selectOption(firstValue);
  }

  // Remplir le nom de la classe
  await page.fill('#m-classe-nom', 'A');
  await page.fill('#m-classe-salle', 'Salle E2E');
  await page.fill('#m-classe-effectif', '40');

  // Soumettre
  await page.click('#btn-creer-classe');

  // Attendre la fermeture du modal ou un toast de succès
  // (soit le modal se ferme, soit un toast apparaît)
  await page.waitForFunction(() => {
    const modal = document.getElementById('m-classe');
    const toast = document.getElementById('tc');
    const modalClosed = !modal || !modal.classList.contains('visible') && !modal.classList.contains('open');
    const toastVisible = toast && toast.children.length > 0;
    return modalClosed || toastVisible;
  }, { timeout: 8000 });
});

// ── Étape 4 : inscrire un élève ──────────────────────────────────
test('étape 4 — inscrire un élève via le modal', async ({ page }) => {
  await seConnecter(page);

  // Aller sur la page Élèves
  await page.click('[data-page="eleves"]');
  await expect(page.locator('#page-eleves')).toHaveClass(/active/);

  // Ouvrir le modal d'inscription
  await page.click('button:has-text("+ Inscrire")');

  const modal = page.locator('#m-eleve');
  await expect(modal).toBeVisible({ timeout: 3000 });

  // Attendre que les classes soient chargées
  await page.waitForFunction(() => {
    const sel = document.getElementById('m-eleve-classe');
    return sel && sel.options.length > 1;
  }, { timeout: 8000 });

  // Remplir le formulaire
  await page.fill('#m-eleve-prenom', 'Fatou');
  await page.fill('#m-eleve-nom', 'Ndiaye');
  await page.fill('#m-eleve-ddn', '2009-05-20');
  await page.selectOption('#m-eleve-genre', 'F');

  // Sélectionner la première classe disponible
  const classeSelect = page.locator('#m-eleve-classe');
  const options = await classeSelect.locator('option').all();
  if (options.length > 1) {
    const firstValue = await options[1].getAttribute('value');
    await classeSelect.selectOption(firstValue);
  }

  // Soumettre
  await page.click('#btn-inscrire-eleve');

  // Attendre la confirmation (toast ou fermeture modal)
  await page.waitForFunction(() => {
    const modal = document.getElementById('m-eleve');
    const toast = document.getElementById('tc');
    const modalHidden = modal && (
      window.getComputedStyle(modal).display === 'none' ||
      !modal.classList.contains('visible') && !modal.classList.contains('open')
    );
    const toastVisible = toast && toast.children.length > 0;
    return modalHidden || toastVisible;
  }, { timeout: 8000 });
});

// ── Étape 5 : vérifier que les élèves s'affichent ───────────────
test('étape 5 — la liste des élèves se charge et affiche des données', async ({ page }) => {
  await seConnecter(page);

  await page.click('[data-page="eleves"]');
  await expect(page.locator('#page-eleves')).toHaveClass(/active/);

  // Attendre que le tableau soit peuplé (données API ou mock)
  await page.waitForFunction(() => {
    const tbody = document.getElementById('tb-eleves');
    return tbody && tbody.children.length > 0;
  }, { timeout: 10000 });

  // Au moins une ligne dans le tableau
  const rows = page.locator('#tb-eleves tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

// ── Étape 6 : créer une évaluation ──────────────────────────────
test('étape 6 — créer une évaluation via le modal', async ({ page }) => {
  await seConnecter(page);

  // Aller sur la page Notes
  await page.click('[data-page="notes"]');
  await expect(page.locator('#page-notes')).toHaveClass(/active/);

  // Ouvrir le modal "Nouvelle évaluation"
  await page.click('button:has-text("+ Nouvelle évaluation")');

  const modal = page.locator('#m-evaluation');
  await expect(modal).toBeVisible({ timeout: 3000 });

  // Attendre que les classes soient chargées
  await page.waitForFunction(() => {
    const sel = document.getElementById('ev-classe');
    return sel && sel.options.length > 1;
  }, { timeout: 8000 });

  // Sélectionner la première classe
  const classeSelect = page.locator('#ev-classe');
  const classeOptions = await classeSelect.locator('option').all();
  if (classeOptions.length > 1) {
    const firstValue = await classeOptions[1].getAttribute('value');
    await classeSelect.selectOption(firstValue);
    // Déclencher l'event change pour charger les affectations
    await classeSelect.dispatchEvent('change');
  }

  // Attendre que les affectations soient chargées OU qu'on sache qu'il n'y en a pas
  await page.waitForFunction(() => {
    const sel = document.getElementById('ev-affectation');
    if (!sel) return false;
    // Options chargées si : plus d'1 option (avec affectations) OU option indiquant "aucune/chargé"
    const txt = sel.options[0]?.text || '';
    return sel.options.length > 1 ||
      txt.includes('Aucune') || txt.includes('Choisir') || txt.includes('—');
  }, { timeout: 8000 });

  // Vérifier si des affectations sont disponibles
  const affectSelect = page.locator('#ev-affectation');
  const affectOptions = await affectSelect.locator('option').all();
  if (affectOptions.length <= 1) {
    // Pas d'affectations disponibles — fermer le modal et passer le test
    await page.click('button:has-text("Annuler")', { timeout: 2000 }).catch(() => {});
    test.skip(); // Pas d'affectations dans la base de test
    return;
  }

  // Sélectionner la première affectation
  const firstValue = await affectOptions[1].getAttribute('value');
  await affectSelect.selectOption(firstValue);

  // Sélectionner le type et remplir les champs
  await page.selectOption('#ev-type', 'devoir');
  await page.fill('#ev-numero', '1');
  await page.fill('#ev-note-max', '20');
  await page.fill('#ev-date', '2025-03-18');
  await page.fill('#ev-titre', 'Devoir E2E Test');

  // Soumettre
  await page.click('#btn-creer-eval');

  // Attendre la fermeture du modal ou toast
  await page.waitForFunction(() => {
    const modal = document.getElementById('m-evaluation');
    const toast = document.getElementById('tc');
    const modalHidden = modal && !modal.classList.contains('visible') && !modal.classList.contains('open');
    const toastVisible = toast && toast.children.length > 0;
    return modalHidden || toastVisible;
  }, { timeout: 8000 });
});

// ── Étape 7 : saisir des notes ───────────────────────────────────
test('étape 7 — saisir des notes depuis le tableau des évaluations', async ({ page }) => {
  await seConnecter(page);

  await page.click('[data-page="notes"]');
  await expect(page.locator('#page-notes')).toHaveClass(/active/);

  // Attendre que le tableau des évaluations se charge
  await page.waitForFunction(() => {
    const tbody = document.getElementById('tb-eval');
    return tbody && tbody.children.length > 0;
  }, { timeout: 10000 });

  // Cliquer sur le bouton "Saisir notes" de la première évaluation
  const saisirBtn = page.locator('#tb-eval tr:first-child button:has-text("Saisir")');
  const hasSaisir = await saisirBtn.count();

  if (hasSaisir > 0) {
    await saisirBtn.click();

    const notesModal = page.locator('#m-notes');
    await expect(notesModal).toBeVisible({ timeout: 5000 });

    // Attendre que les lignes d'élèves soient chargées
    await page.waitForFunction(() => {
      const tbody = document.getElementById('tb-notes-saisie');
      return tbody && tbody.children.length > 0;
    }, { timeout: 8000 });

    // Saisir une note dans le premier champ
    const premierChamp = page.locator('#tb-notes-saisie tr:first-child input[type="number"]').first();
    await expect(premierChamp).toBeVisible();
    await premierChamp.fill('14');

    // Vérifier que la valeur est bien saisie
    const valeur = await premierChamp.inputValue();
    expect(parseFloat(valeur)).toBe(14);
  } else {
    // Pas de bouton "Saisir" visible → test passé (tableau peut être vide)
    test.skip();
  }
});

// ── Étape 8 : publier les notes ──────────────────────────────────
test('étape 8 — publier les notes d\'une évaluation', async ({ page }) => {
  await seConnecter(page);

  await page.click('[data-page="notes"]');

  // Attendre les évaluations
  await page.waitForFunction(() => {
    const tbody = document.getElementById('tb-eval');
    return tbody && tbody.children.length > 0;
  }, { timeout: 10000 });

  // Chercher un bouton "Publier" dans le tableau
  const publierBtn = page.locator('#tb-eval button:has-text("Publier")').first();
  const hasPublier = await publierBtn.count();

  if (hasPublier > 0) {
    await publierBtn.click();

    // Une confirmation toast ou dialogue doit apparaître
    const toast = page.locator('#tc');
    await expect(toast).not.toBeEmpty({ timeout: 5000 });
  } else {
    test.skip();
  }
});

// ── Routing hash : navigation directe par URL ────────────────────
test('navigation directe via URL avec hash charge la bonne page', async ({ page }) => {
  await seConnecter(page);

  // Naviguer directement vers #classes
  await page.goto('/index.html#classes');

  await expect(page.locator('#page-classes')).toHaveClass(/active/, { timeout: 5000 });
  await expect(page.locator('#tb-titre')).toHaveText('Classes');
});

// ── Paramètres : affichage et modification ───────────────────────
test('page paramètres affiche les informations de l\'établissement', async ({ page }) => {
  await seConnecter(page);

  await page.click('[data-page="parametres"]');
  await expect(page.locator('#page-parametres')).toHaveClass(/active/);

  // Attendre que les données soient chargées
  await page.waitForFunction(() => {
    const input = document.getElementById('param-nom');
    return input && input.value.length > 0;
  }, { timeout: 10000 });

  // Le champ nom est rempli
  const nomInput = page.locator('#param-nom');
  const nomValue = await nomInput.inputValue();
  expect(nomValue.length).toBeGreaterThan(0);

  // Le code officiel est en lecture seule et rempli
  const codeInput = page.locator('#param-code');
  const codeValue = await codeInput.inputValue();
  expect(codeValue.length).toBeGreaterThan(0);
});
