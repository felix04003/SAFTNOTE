// @ts-check
// `test` de Playwright + journal du navigateur joint à tout test en échec.
//
// Le journal (console, erreurs de page, requêtes échouées, réponses HTTP >= 400, navigations, avec l'instant en ms
// depuis le début du test) est écrit dans test-results/<test>/journal-navigateur.txt, donc lisible sans ouvrir de
// trace, et la CI l'affiche dans son journal quand un test échoue.
const fs = require('fs');
const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use, testInfo) => {
    const debut = Date.now();
    /** @type {string[]} */
    const journal = [];
    const note = (/** @type {string} */ ligne) => journal.push(`+${String(Date.now() - debut).padStart(5)}ms ${ligne}`);

    page.on('console', (m) => note(`[console.${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => note(`[erreur de page] ${e.message}`));
    page.on('requestfailed', (r) => note(`[requête échouée] ${r.method()} ${r.url()} : ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) note(`[HTTP ${r.status()}] ${r.request().method()} ${r.url()}`); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) note(`[navigation] ${f.url()}`); });
    page.on('dialog', (d) => note(`[boîte de dialogue ${d.type()}] ${d.message()}`));

    await use(page);

    if (testInfo.status !== testInfo.expectedStatus) {
      // Écrit en vrai fichier (une pièce jointe passée par `body` n'existe que dans le rapport) : c'est ce
      // fichier que l'étape de CI affiche
      const chemin = testInfo.outputPath('journal-navigateur.txt');
      fs.writeFileSync(chemin, journal.length ? journal.join('\n') : '(aucun message)');
      await testInfo.attach('journal-navigateur.txt', { path: chemin, contentType: 'text/plain' });
    }
  },
});

module.exports = { test, expect: base.expect };
