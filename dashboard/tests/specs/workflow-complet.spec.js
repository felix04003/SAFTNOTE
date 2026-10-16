// @ts-check
const { test, expect } = require('../fixtures');

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

// ── Aides API (création de données de test indépendantes de l'interface) ─────────
// Une évaluation est unique par (affectation, type, numéro 1 à 5, période) : 7 types × 5 numéros.
// Chaque test qui en crée une cherche un créneau libre, pour rester rejouable sur une base conservée.
const TYPES_EVALUATION = ['devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet'];

async function entetesApi(request) {
  const connexion = await request.post('/api/v1/auth/connexion', {
    data: { identifiant: CREDENTIALS.identifiant, mot_de_passe: CREDENTIALS.mot_de_passe, etablissement_code: CREDENTIALS.etablissement_code },
  });
  expect(connexion.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await connexion.json()).data.token}` };
}

async function listerEvaluations(request, entetes) {
  const res = await request.get('/api/v1/evaluations?limite=100', { headers: entetes });
  return (await res.json()).data || [];
}

async function creneauEvaluationLibre(request, entetes) {
  const pris = new Set((await listerEvaluations(request, entetes)).map((e) => `${e.type}|${e.numero}`));
  for (let numero = 1; numero <= 5; numero++) {
    for (const type of TYPES_EVALUATION) if (!pris.has(`${type}|${numero}`)) return { type, numero };
  }
  return null;
}

const AFFECTATION_SEED = '77777777-7777-7777-7777-777777777777';
const PERIODE_SEED = '88888888-8888-8888-8888-888888888888';

// Évaluation neuve (non publiée) créée par l'API sur un créneau libre ; échoue explicitement si les 35 sont pris
async function creerEvaluationApi(request, entetes, titre) {
  const creneau = await creneauEvaluationLibre(request, entetes);
  expect(creneau, 'Les 35 créneaux (type, numéro) de l\'affectation de test sont pris : repartir d\'une base neuve ou supprimer les évaluations E2E (voir README)').not.toBeNull();
  const creation = await request.post('/api/v1/evaluations', {
    headers: entetes,
    data: { affectation_id: AFFECTATION_SEED, periode_id: PERIODE_SEED, type: creneau.type, numero: creneau.numero, note_max: 20, titre, date_evaluation: '2025-11-20' },
  });
  expect(creation.status()).toBe(201);
  return (await creation.json()).data.id;
}

// ── Étape 1 : connexion ──────────────────────────────────────────
test('étape 1 — connexion directeur', async ({ page }) => {
  await seConnecter(page);

  // Dashboard chargé : titre visible
  await expect(page.locator('#tb-titre')).toHaveText('Tableau de bord');

  // Le nom de l'établissement est dans la sidebar
  const etabNom = page.locator('.sb-etab');
  await expect(etabNom).toBeVisible();

  // Le jeton est dans sessionStorage
  const token = await page.evaluate(() => sessionStorage.getItem('em_token'));
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
  // Nom unique : la base est conservée entre deux exécutions (contrainte d'unicité année/niveau/nom)
  const nomClasse = 'E' + (Date.now() % 100000);
  await page.fill('#m-classe-nom', nomClasse);
  await page.fill('#m-classe-salle', 'Salle E2E');
  await page.fill('#m-classe-effectif', '40');

  // Soumettre
  await page.click('#btn-creer-classe');

  // Succès réel : la fenêtre se ferme (elle reste ouverte sur une erreur serveur)
  await expect(page.locator('#m-classe')).not.toHaveClass(/open/, { timeout: 8000 });

  // Et la liste affichée contient la nouvelle classe (la grille est rechargée après la création)
  await expect(page.locator('#cls-grid')).toContainText(nomClasse, { timeout: 8000 });
});

// ── Étape 4 : inscrire un élève ──────────────────────────────────
test('étape 4 — inscrire un élève via le modal', async ({ page, request }) => {
  const entetes = await entetesApi(request);
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
  // Nom unique : une inscription par exécution, retrouvée ensuite côté serveur
  const prenom = 'Fatou' + (Date.now() % 100000);
  await page.fill('#m-eleve-prenom', prenom);
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

  // Succès réel : la fenêtre se ferme (elle reste ouverte sur une erreur) ET l'élève existe côté serveur
  await expect(page.locator('#m-eleve')).not.toHaveClass(/open/, { timeout: 8000 });
  await expect.poll(async () => {
    const res = await request.get(`/api/v1/eleves?recherche=${prenom}`, { headers: entetes });
    return JSON.stringify((await res.json()).data || []).includes(prenom);
  }, { timeout: 8000 }).toBe(true);

  // Et la liste affichée : on cherche l'élève par son prénom (la liste est paginée) et sa ligne apparaît
  await page.locator('#page-eleves input[placeholder="Rechercher…"]').fill(prenom);
  await expect(page.locator('#tb-eleves tr', { hasText: prenom })).toBeVisible({ timeout: 8000 });
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
test('étape 6 — créer une évaluation via le modal', async ({ page, request }) => {
  const entetes = await entetesApi(request);
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

  // Le seed 02 crée une affectation (enseignant × matière × classe) : son absence est une anomalie, pas un cas à ignorer
  const affectSelect = page.locator('#ev-affectation');
  const affectOptions = await affectSelect.locator('option').all();
  expect(affectOptions.length, 'aucune affectation proposée : seeds de test non appliqués ?').toBeGreaterThan(1);

  // Sélectionner la première affectation
  const firstValue = await affectOptions[1].getAttribute('value');
  await affectSelect.selectOption(firstValue);

  // Créneau (type, numéro) encore libre : la base est conservée entre deux exécutions
  const creneau = await creneauEvaluationLibre(request, entetes);
  expect(creneau, 'Les 35 créneaux (type, numéro) de l\'affectation de test sont pris : repartir d\'une base neuve ou supprimer les évaluations E2E (voir README)').not.toBeNull();
  const titre = `Devoir E2E ${creneau.type} ${creneau.numero}`;
  await page.selectOption('#ev-type', creneau.type);
  await page.fill('#ev-numero', String(creneau.numero));
  await page.fill('#ev-note-max', '20');
  await page.fill('#ev-date', '2025-03-18');
  await page.fill('#ev-titre', titre);

  // Soumettre
  await page.click('#btn-creer-eval');

  // Succès réel : la fenêtre se ferme (elle reste ouverte sur une erreur) ET l'évaluation existe côté serveur
  await expect(page.locator('#m-evaluation')).not.toHaveClass(/open/, { timeout: 8000 });
  let evaluationId;
  await expect.poll(async () => {
    evaluationId = (await listerEvaluations(request, entetes)).find((e) => e.titre === titre)?.id;
    return !!evaluationId;
  }, { timeout: 8000 }).toBe(true);

  // Et le tableau affiché la montre : sa ligne (identifiée par son id), non saisie, avec son type
  const ligne = page.locator(`#tb-eval tr[onclick*="${evaluationId}"]`);
  await expect(ligne).toBeVisible({ timeout: 8000 });
  await expect(ligne).toContainText('Non saisie');
  await expect(ligne).toContainText(creneau.type);
});

// ── Étape 7 : saisir des notes ───────────────────────────────────
test('étape 7 — saisir des notes depuis le tableau des évaluations', async ({ page, request }) => {
  // Évaluation neuve et non publiée : le bouton "Saisir" de sa ligne existe forcément
  const entetes = await entetesApi(request);
  const evaluationId = await creerEvaluationApi(request, entetes, 'Devoir saisie E2E');

  await seConnecter(page);
  await page.click('[data-page="notes"]');
  await expect(page.locator('#page-notes')).toHaveClass(/active/);

  // Sa ligne dans le tableau (le gestionnaire de clic porte l'identifiant), puis son bouton "Saisir"
  const saisirBtn = page.locator(`#tb-eval tr[onclick*="${evaluationId}"] button:has-text("Saisir")`);
  await expect(saisirBtn).toBeVisible({ timeout: 10000 });
  await saisirBtn.click();
  await expect(page.locator('#m-notes')).toBeVisible({ timeout: 5000 });

  await page.waitForFunction(() => document.getElementById('tb-notes-saisie')?.children.length, null, { timeout: 8000 });
  const premierChamp = page.locator('#tb-notes-saisie tr:first-child input[type="number"]').first();
  await expect(premierChamp).toBeVisible();
  await premierChamp.fill('14');
  expect(parseFloat(await premierChamp.inputValue())).toBe(14);

  // Enregistrer, puis vérifier que la note est réellement stockée côté serveur
  await page.click('#btn-sauver-notes');
  await expect.poll(async () => {
    const res = await request.get(`/api/v1/evaluations/${evaluationId}/notes`, { headers: entetes });
    return JSON.stringify((await res.json()).data || []);
  }, { timeout: 8000 }).toMatch(/"valeur":\s*"?14/);
});

// ── Étape 8 : publier les notes ──────────────────────────────────
// La publication se fait dans la fenêtre de saisie (#btn-publier-notes), pas dans le tableau.
// Chaque exécution crée sa propre évaluation (API) : la publication est irréversible, le test
// reste donc rejouable sur une base conservée. Dépend des seeds 01 à 03 (affectation et période fixes).
test('étape 8 — publier les notes d\'une évaluation', async ({ page, request }) => {
  // 1. Évaluation neuve, créée par l'API avec le compte du directeur
  const entetes = await entetesApi(request);
  const evaluationId = await creerEvaluationApi(request, entetes, 'Devoir à publier E2E');

  // 2. Ouvrir sa fenêtre de saisie, saisir une note, publier
  await seConnecter(page);
  await page.click('[data-page="notes"]');
  await expect(page.locator('#page-notes')).toHaveClass(/active/);
  await page.waitForFunction(() => document.getElementById('tb-eval')?.children.length);

  await page.evaluate((id) => window.PageNotes.ouvrirSaisie(id), evaluationId);
  await expect(page.locator('#m-notes')).toBeVisible({ timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('tb-notes-saisie')?.children.length, null, { timeout: 8000 });
  await page.locator('#tb-notes-saisie tr:first-child input[type="number"]').first().fill('15');

  page.once('dialog', (dialogue) => dialogue.accept());     // confirm("Publier les notes ? …")
  await page.click('#btn-publier-notes');

  // 3. Toast de succès et évaluation réellement publiée côté serveur
  await expect(page.locator('#toast-container')).toContainText('publiées', { timeout: 8000 });
  await expect.poll(async () => {
    const ev = (await listerEvaluations(request, entetes)).find((e) => e.id === evaluationId);
    return ev && (ev.statut || (ev.notes_publiees ? 'publiee' : ''));
  }, { timeout: 8000 }).toBe('publiee');
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

