// @ts-check
const { test, expect } = require('../fixtures');
const { execFileSync } = require('child_process');
const { creerJeuDeProfils } = require('../data/profils-parcours');

/**
 * Parcours « école complète » côté web : création de l'école et de son directeur, puis, connecté en directeur, des
 * matières, classes, enseignants (avec affectations), élèves et parents ; enfin évaluations, notes et publication.
 * Les profils viennent de data/profils-parcours.js (uniques à chaque exécution).
 *
 * Tests dépendants et dans l'ordre (mode serial) : chacun suppose les précédents. Les créations passent par
 * l'interface ; l'API sert aux vérifications côté serveur et aux données de contrôle.
 * Prérequis : voir README (backend + dashboard servi par serve-e2e.js, rôle PostgreSQL ecole_app_rls configuré).
 */
test.describe.configure({ mode: 'serial' });

const jeu = creerJeuDeProfils();
/** État partagé entre les tests du parcours */
const etat = { codeEtablissement: '', tokenDirecteur: '' };

// ── Aides ───────────────────────────────────────────────────────────────────

/** Connexion par l'interface ; renvoie quand le tableau de bord est affiché. */
async function seConnecter(page, { identifiant, mdp }) {
  await page.goto('/login.html');
  await page.fill('#login-id', identifiant);
  await page.fill('#login-pwd', mdp);
  await page.fill('#login-etab', etat.codeEtablissement);
  await page.click('#login-btn');
}

async function seConnecterEnDirecteur(page) {
  await seConnecter(page, { identifiant: jeu.directeur.email, mdp: jeu.directeur.mdp });
  await page.waitForURL(/index\.html/, { timeout: 10000 });
  await expect(page.locator('.sidebar')).toBeVisible();
}

/** Sélectionne dans un <select> l'option dont le texte contient tous les fragments donnés. */
async function choisir(page, selecteur, ...fragments) {
  const valeur = await page.locator(`${selecteur} option`).evaluateAll(
    (options, frags) => (options.find((o) => frags.every((f) => (o.textContent || '').includes(f))) || {}).value || null,
    fragments,
  );
  expect(valeur, `aucune option contenant ${JSON.stringify(fragments)} dans ${selecteur}`).toBeTruthy();
  await page.selectOption(selecteur, valeur);
}

async function aller(page, pageId) {
  await page.click(`[data-page="${pageId}"]`);
  await expect(page.locator(`#page-${pageId}`)).toHaveClass(/active/);
}

/** En-têtes de l'API avec le jeton du directeur (connexion API faite une fois pour tout le parcours). */
async function api(request) {
  if (!etat.tokenDirecteur) {
    const res = await request.post('/api/v1/auth/connexion', {
      data: { identifiant: jeu.directeur.email, mot_de_passe: jeu.directeur.mdp, etablissement_code: etat.codeEtablissement },
    });
    expect(res.ok()).toBeTruthy();
    etat.tokenDirecteur = (await res.json()).data.token;
  }
  return { Authorization: `Bearer ${etat.tokenDirecteur}` };
}

const lire = async (request, chemin) => (await (await request.get(`/api/v1${chemin}`, { headers: await api(request) })).json()).data;

// ── 1. École et directeur ───────────────────────────────────────────────────

test('1. création de l\'école et de son directeur par le formulaire d\'inscription', async ({ page }) => {
  await page.goto('/inscription.html');

  await page.fill('#etab-nom', jeu.ecole.nom);
  await page.fill('#etab-ville', jeu.ecole.ville);
  await page.click('#btn-etape2');
  await expect(page.locator('#panel2')).toHaveClass(/actif/);

  await page.fill('#dir-nom', jeu.directeur.nom);
  await page.fill('#dir-prenom', jeu.directeur.prenom);
  await page.fill('#dir-email', jeu.directeur.email);
  await page.fill('#dir-tel', jeu.directeur.telephone);
  await page.fill('#dir-mdp', jeu.directeur.mdp);
  await page.fill('#dir-mdp2', jeu.directeur.mdp);
  await page.click('#btn-inscrire');

  await expect(page.locator('#panel3')).toHaveClass(/actif/, { timeout: 15000 });
  etat.codeEtablissement = ((await page.locator('#conf-code').textContent()) || '').trim();
  expect(etat.codeEtablissement).toMatch(/^[A-Z0-9-]+$/);
  await expect(page.locator('#conf-email')).toHaveText(jeu.directeur.email);
});

test('2. le directeur se connecte : tableau de bord de SON école', async ({ page }) => {
  await seConnecterEnDirecteur(page);
  await expect(page.locator('#sb-etab-nom')).toContainText(jeu.ecole.nom);
  await expect(page.locator('#sb-user-nom')).toContainText(jeu.directeur.nom);
});

// ── 3. Matières ─────────────────────────────────────────────────────────────

test('3. création des matières', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'parametres');

  for (const m of jeu.matieres) {
    await page.click('button:has-text("+ Nouvelle matière")');
    await expect(page.locator('#m-matiere')).toHaveClass(/open/);
    await page.fill('#m-mat-nom', m.nom);
    await page.fill('#m-mat-court', m.court);
    await page.fill('#m-mat-code', m.code);
    await page.click('#btn-creer-matiere');
    await expect(page.locator('#m-matiere')).not.toHaveClass(/open/, { timeout: 8000 });
    await expect(page.locator('#param-matieres-liste')).toContainText(m.nom, { timeout: 8000 });
  }

  const noms = (await lire(request, '/configs/matieres')).map((m) => m.nom);
  for (const m of jeu.matieres) expect(noms).toContain(m.nom);
});

// ── 4. Classes ──────────────────────────────────────────────────────────────

test('4. création des classes', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'classes');

  for (const c of jeu.classes) {
    await page.click('button:has-text("+ Nouvelle classe")');
    await expect(page.locator('#m-classe')).toHaveClass(/open/);
    await page.waitForFunction(() => (document.getElementById('m-classe-niveau')?.children.length || 0) > 1);
    await choisir(page, '#m-classe-niveau', c.niveau);
    await page.fill('#m-classe-nom', c.lettre);
    await page.fill('#m-classe-salle', c.salle);
    await page.fill('#m-classe-effectif', String(c.effectif));
    await page.click('#btn-creer-classe');
    await expect(page.locator('#m-classe')).not.toHaveClass(/open/, { timeout: 8000 });
    await expect(page.locator('#cls-grid')).toContainText(c.salle, { timeout: 8000 });
  }

  const classes = await lire(request, '/classes');
  expect(classes).toHaveLength(jeu.classes.length);
});

// ── 5. Enseignants ──────────────────────────────────────────────────────────

test('5. création des enseignants (comptes avec mot de passe provisoire)', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'enseignants');

  for (const e of jeu.enseignants) {
    await page.click('#page-enseignants button:has-text("+ Ajouter")');
    await expect(page.locator('#m-enseignant')).toHaveClass(/open/);
    await page.fill('#m-ens-prenom', e.prenom);
    await page.fill('#m-ens-nom', e.nom);
    await page.fill('#m-ens-tel', e.telephone);
    await page.fill('#m-ens-email', e.email);
    await page.fill('#m-ens-specialite', e.specialite);
    await page.selectOption('#m-ens-contrat', e.contrat);
    await page.fill('#m-ens-mdp', e.mdp);
    await page.click('#btn-ajouter-ens');   // sans SMS, l'application montre le mot de passe dans un prompt(), fermé par la fixture
    await expect(page.locator('#m-enseignant')).not.toHaveClass(/open/, { timeout: 8000 });
    await expect(page.locator('#page-enseignants')).toContainText(e.nom, { timeout: 8000 });
  }

  const enseignants = JSON.stringify(await lire(request, '/enseignants'));
  for (const e of jeu.enseignants) expect(enseignants).toContain(e.nom);
});

test('6. affectation des enseignants (matière × classe)', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'enseignants');

  for (const e of jeu.enseignants) {
    await page.locator('#page-enseignants tr', { hasText: e.nom }).locator('button:has-text("Affecter")').click();
    await expect(page.locator('#m-affectations')).toHaveClass(/open/);
    await page.waitForFunction(() => (document.getElementById('m-aff-classe')?.children.length || 0) > 1);
    await page.waitForFunction(() => (document.getElementById('m-aff-matiere')?.children.length || 0) > 1);

    for (const a of e.affectations) {
      await choisir(page, '#m-aff-classe', a.classe);
      await choisir(page, '#m-aff-matiere', a.matiere);
      await page.locator('#m-aff-titulaire').setChecked(a.titulaire);
      await page.click('#btn-ajouter-aff');
      await expect(page.locator('#m-aff-liste')).toContainText(a.matiere, { timeout: 8000 });
    }
    await page.click('#m-affectations button:has-text("Fermer")');
    await expect(page.locator('#m-affectations')).not.toHaveClass(/open/);
  }

  // Côté serveur : chaque enseignant a exactement les affectations prévues
  const liste = await lire(request, '/enseignants');
  for (const e of jeu.enseignants) {
    const fiche = liste.find((x) => JSON.stringify(x).includes(e.nom));
    const { affectations } = await lire(request, `/enseignants/${fiche.id}/affectations`);
    const obtenues = affectations.map((a) => `${a.niveau} ${a.classe} | ${a.matiere}`).sort();
    const attendues = e.affectations.map((a) => `${a.classe} | ${a.matiere}`).sort();
    expect(obtenues, `affectations de ${e.nom}`).toEqual(attendues);
  }
});

// ── 7. Élèves et parents ────────────────────────────────────────────────────

test('7. inscription des élèves avec leurs parents (dont une fratrie)', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'eleves');

  for (const el of jeu.eleves) {
    await page.click('#page-eleves button:has-text("+ Inscrire")');
    await expect(page.locator('#m-eleve')).toHaveClass(/open/);
    await page.waitForFunction(() => (document.getElementById('m-eleve-classe')?.children.length || 0) > 1);

    await page.fill('#m-eleve-prenom', el.prenom);
    await page.fill('#m-eleve-nom', el.nom);
    await page.fill('#m-eleve-ddn', el.naissance);
    await page.selectOption('#m-eleve-genre', el.genre);
    await choisir(page, '#m-eleve-classe', el.classe);
    await page.fill('#m-eleve-parent-prenom', el.parent.prenom);
    await page.fill('#m-eleve-parent-nom', el.parent.nom);
    await page.fill('#m-eleve-parent-tel', el.parent.telephone);
    await page.selectOption('#m-eleve-parent-lien', el.parent.lien);
    await page.click('#btn-inscrire-eleve');

    await expect(page.locator('#m-eleve')).not.toHaveClass(/open/, { timeout: 8000 });
  }

  // La liste affichée contient chaque élève (recherche par prénom : la liste est paginée)
  for (const el of jeu.eleves) {
    await page.locator('#page-eleves input[placeholder="Rechercher…"]').fill(el.prenom);
    await expect(page.locator('#tb-eleves tr', { hasText: `${el.prenom} ${el.nom}` })).toBeVisible({ timeout: 8000 });
  }

  // Côté serveur : 4 élèves, répartis comme prévu ; 3 comptes parents seulement (la fratrie partage le sien)
  const eleves = await lire(request, '/eleves?limite=100');
  expect(eleves).toHaveLength(jeu.eleves.length);
  for (const el of jeu.eleves) {
    const fiche = eleves.find((x) => x.prenom === el.prenom && x.nom === el.nom);
    expect(fiche, `${el.prenom} ${el.nom}`).toBeTruthy();
    expect(JSON.stringify(fiche)).toContain(el.classe.split(' ')[0]);
  }
});

// ── 8. Évaluations ──────────────────────────────────────────────────────────

test('8. création des évaluations (une par couple classe × matière prévu)', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'notes');

  for (const ev of jeu.evaluations) {
    await page.click('button:has-text("+ Nouvelle évaluation")');
    await expect(page.locator('#m-evaluation')).toHaveClass(/open/);
    await page.waitForFunction(() => (document.getElementById('ev-classe')?.children.length || 0) > 1);

    await choisir(page, '#ev-classe', ev.classe);
    await page.locator('#ev-classe').dispatchEvent('change');           // charge les affectations de la classe
    await page.waitForFunction(() => (document.getElementById('ev-affectation')?.children.length || 0) > 1);
    await choisir(page, '#ev-affectation', ev.matiere);

    // Première période de l'année (créée avec l'école)
    const periode = await page.locator('#ev-periode option').first().getAttribute('value');
    expect(periode, 'aucune période proposée').toBeTruthy();
    await page.selectOption('#ev-periode', periode);

    await page.selectOption('#ev-type', ev.type);
    await page.fill('#ev-numero', String(ev.numero));
    await page.fill('#ev-note-max', String(ev.noteMax));
    await page.fill('#ev-date', ev.date);
    await page.fill('#ev-titre', ev.titre);
    await page.click('#btn-creer-eval');
    await expect(page.locator('#m-evaluation')).not.toHaveClass(/open/, { timeout: 8000 });
  }

  const evaluations = await lire(request, '/evaluations?limite=100');
  expect(evaluations).toHaveLength(jeu.evaluations.length);
  for (const ev of jeu.evaluations) {
    const fiche = evaluations.find((x) => x.titre === ev.titre);
    expect(fiche, ev.titre).toBeTruthy();
    expect(fiche.type).toBe(ev.type);
    expect(fiche.matiere).toBe(ev.matiere);
  }
});

// ── 9. Notes et publication ─────────────────────────────────────────────────

test('9. saisie des notes depuis le tableau, puis publication', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'notes');

  for (const ev of jeu.evaluations) {
    const evaluationId = (await lire(request, '/evaluations?limite=100')).find((x) => x.titre === ev.titre).id;

    await page.locator(`#tb-eval tr[onclick*="${evaluationId}"] button:has-text("Saisir")`).click();
    await expect(page.locator('#m-notes')).toBeVisible({ timeout: 5000 });
    await page.waitForFunction(
      (n) => (document.getElementById('tb-notes-saisie')?.children.length || 0) >= n, Object.keys(ev.notes).length, { timeout: 8000 });

    // Une ligne par élève de la classe : on saisit la note prévue pour chacun
    for (const [eleve, note] of Object.entries(ev.notes)) {
      // La grille affiche « NOM Prénom » ; les profils notent « Prénom Nom »
      const [prenom, ...reste] = eleve.split(' ');
      await page.locator('#tb-notes-saisie tr', { hasText: `${reste.join(' ')} ${prenom}` }).locator('input[type="number"]').fill(String(note));
    }
    await page.click('#btn-sauver-notes');

    // Notes réellement stockées côté serveur, avant publication
    await expect.poll(async () => {
      const lignes = await lire(request, `/evaluations/${evaluationId}/notes`);
      return Object.fromEntries(lignes.filter((l) => l.valeur != null).map((l) => [`${l.prenom} ${l.nom}`, Number(l.valeur)]));
    }, { timeout: 8000 }).toEqual(ev.notes);

    if (ev.publiee === false) {                                       // brouillon : on referme sans publier
      await page.evaluate(() => document.getElementById('m-notes')?.classList.remove('open'));
      continue;
    }
    page.once('dialog', (d) => d.accept());                           // confirm("Publier les notes ? …")
    await page.click('#btn-publier-notes');
    await expect(page.locator('#m-notes')).not.toBeVisible({ timeout: 8000 });

    await expect.poll(async () =>
      (await lire(request, '/evaluations?limite=100')).find((x) => x.id === evaluationId)?.statut, { timeout: 8000 }).toBe('publiee');
    await expect(page.locator(`#tb-eval tr[onclick*="${evaluationId}"]`)).toContainText('Publiée');
  }
});

// ── 10. Les enseignants créés peuvent se connecter ──────────────────────────

test('10. chaque enseignant se connecte et ne voit que ses classes', async ({ page }) => {
  const nouveauMdp = 'Zebre2026Pluie';

  for (const e of jeu.enseignants) {
    await seConnecter(page, { identifiant: e.telephone, mdp: e.mdp });          // connexion par numéro de téléphone

    // Compte à mot de passe provisoire : changement obligatoire avant tout usage (règle 8)
    await page.waitForURL(/changer-mot-de-passe|enseignant\.html/, { timeout: 10000 });
    if (/changer-mot-de-passe/.test(page.url())) {
      await page.fill('#mdp-actuel', e.mdp);
      await page.fill('#mdp-nouveau', nouveauMdp);
      await page.fill('#mdp-confirm', nouveauMdp);
      await page.click('#btn-changer');
      await page.waitForURL(/enseignant\.html/, { timeout: 10000 });
    }

    await expect(page.locator('#sb-user-nom')).toContainText(e.nom);
    await expect(page.locator('#sb-etab-nom')).toContainText(jeu.ecole.nom);

    await aller(page, 'ens-classes');
    const grille = page.locator('#ens-classes-grid');
    for (const a of e.affectations) await expect(grille).toContainText(a.classe, { timeout: 8000 });
    for (const c of jeu.classes) {
      const label = `${c.niveau} ${c.lettre}`;
      if (!e.affectations.some((a) => a.classe === label)) await expect(grille).not.toContainText(label);
    }
    await page.evaluate(() => sessionStorage.clear());                           // déconnexion pour le suivant
  }
});

// ── 11. Les parents créés peuvent se connecter (code SMS) ───────────────────

/** Les codes SMS ne sont pas lisibles : on les remplace en base par un code connu (psql, comme les autres variables PG* du job). */
const psqlDisponible = (() => { try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
function fixerCodeSms(telephone, code) {
  if (!/^\+?\d+$/.test(telephone) || !/^\d{6}$/.test(code)) throw new Error('numéro ou code invalide');
  const sql = `UPDATE otp_verifications SET code_hash = encode(sha256('${code}'::bytea), 'hex') ` +
    `WHERE utilise = false AND utilisateur_id IN (SELECT id FROM utilisateurs WHERE telephone = '${telephone}')`;
  execFileSync('psql', ['-h', process.env.POSTGRES_HOST || 'localhost', '-p', process.env.POSTGRES_PORT || '5432',
    '-U', process.env.POSTGRES_USER || 'ecole_user', '-d', process.env.POSTGRES_DB || 'ecole_manager',
    '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD || '' }, stdio: 'ignore' });
}

/** Les enfants (Prénom) attendus par parent, d'après les profils */
const enfantsDe = (parent) => jeu.eleves.filter((el) => el.parent.telephone === parent.telephone);

test('11. chaque parent se connecte par code SMS et ne voit que ses enfants et leurs notes publiées', async ({ page }) => {
  test.skip(!psqlDisponible, 'psql est nécessaire pour fixer le code SMS (variables POSTGRES_* de la base de test)');

  for (const parent of Object.values(jeu.parents)) {
    await page.goto('/parent-login.html');
    await page.fill('#inp-telephone', parent.telephone);                          // sans code établissement (3.4)
    await page.click('#btn-demander');
    await expect(page.locator('#etape2')).toBeVisible({ timeout: 10000 });

    fixerCodeSms(parent.telephone, '424242');
    const cases = page.locator('#otp-inputs input');
    for (let i = 0; i < 6; i++) await cases.nth(i).fill('424242'[i]);
    await page.click('#btn-valider');
    await page.waitForURL(/parent\.html/, { timeout: 10000 });

    await expect(page.locator('#sb-etab-nom')).toContainText(jeu.ecole.nom);

    // Ses enfants, et seulement eux (la fratrie partage un seul compte parent)
    const enfants = enfantsDe(parent);
    const wrap = page.locator('#par-enfant-wrap');
    for (const el of enfants) await expect(wrap).toContainText(el.prenom);
    for (const el of jeu.eleves) if (!enfants.includes(el)) await expect(wrap).not.toContainText(el.prenom);
    if (enfants.length > 1) await expect(page.locator('#par-enfant-sel option')).toHaveCount(enfants.length);

    // Notes publiées de chaque enfant (le sélecteur ne s'affiche que pour plusieurs enfants)
    for (const el of enfants) {
      if (enfants.length > 1) await choisir(page, '#par-enfant-sel', el.prenom);
      await aller(page, 'par-notes');
      const conteneur = page.locator('#par-notes-container');
      const nomComplet = `${el.prenom} ${el.nom}`;
      const siennes = jeu.evaluations.filter((ev) => ev.publiee !== false && ev.notes[nomComplet] !== undefined);
      for (const ev of siennes) {
        await expect(conteneur).toContainText(ev.matiere, { timeout: 8000 });
        // Affichage : « 12.50/20.00 » (note et barème avec deux décimales)
        await expect(conteneur).toContainText(`${ev.notes[nomComplet].toFixed(2)}/${ev.noteMax.toFixed(2)}`);
      }
      // Les notes d'une évaluation non publiée ne doivent apparaître nulle part
      for (const ev of jeu.evaluations.filter((x) => x.publiee === false && x.notes[nomComplet] !== undefined)) {
        await expect(conteneur).not.toContainText(`${ev.notes[nomComplet].toFixed(2)}/`);
      }
    }

    // Même contrôle côté API, avec le jeton de ce parent : ses enfants (publiées seulement) ; ceux des autres, refusés
    const jeton = await page.evaluate(() => sessionStorage.getItem('em_token'));
    const appel = (chemin) => page.request.get(`/api/v1${chemin}`, { headers: { Authorization: `Bearer ${jeton}` } });
    const idsEleves = Object.fromEntries((await lire(page.request, '/eleves?limite=100')).map((e) => [`${e.prenom} ${e.nom}`, e.id]));
    for (const el of jeu.eleves) {
      const nomComplet = `${el.prenom} ${el.nom}`;
      expect(idsEleves[nomComplet], `élève ${nomComplet} introuvable côté directeur`).toBeTruthy();
      const reponse = await appel(`/parents/moi/enfants/${idsEleves[nomComplet]}/notes`);
      if (!enfants.includes(el)) {
        expect(reponse.status(), `${parent.prenom} ${parent.nom} ne doit pas lire les notes de ${el.prenom}`).toBe(403);
        continue;
      }
      expect(reponse.status()).toBe(200);
      const texte = JSON.stringify(await reponse.json());
      for (const ev of jeu.evaluations.filter((x) => x.publiee === false && x.notes[nomComplet] !== undefined)) {
        expect(texte, `brouillon « ${ev.titre} » visible par le parent de ${el.prenom}`).not.toMatch(new RegExp(`${ev.date}|"${ev.notes[nomComplet]}"|:${ev.notes[nomComplet]}[,}]`));
      }
    }
    await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  }
});

// ── 12. Isolation entre écoles ──────────────────────────────────────────────

test('12. une seconde école ne voit rien de la première (et inversement)', async ({ request }) => {
  const autre = creerJeuDeProfils(String(Number(jeu.suffixe) + 1).padStart(7, '0'));
  const creation = await request.post('/api/v1/inscription', {
    data: {
      etablissement: { nom: autre.ecole.nom, ville: autre.ecole.ville },
      directeur: { nom: autre.directeur.nom, prenom: autre.directeur.prenom, email: autre.directeur.email, telephone: autre.directeur.telephone, mot_de_passe: autre.directeur.mdp },
    },
  });
  expect(creation.status()).toBe(201);
  const codeAutre = (await creation.json()).data.etablissement.code_officiel;
  expect(codeAutre).not.toBe(etat.codeEtablissement);

  const connexion = await request.post('/api/v1/auth/connexion', {
    data: { identifiant: autre.directeur.email, mot_de_passe: autre.directeur.mdp, etablissement_code: codeAutre },
  });
  const enAutre = { Authorization: `Bearer ${(await connexion.json()).data.token}` };

  // Rien de la première école n'est visible
  for (const chemin of ['/eleves?limite=100', '/classes', '/enseignants', '/evaluations?limite=100']) {
    const res = await request.get(`/api/v1${chemin}`, { headers: enAutre });
    expect((await res.json()).data, chemin).toHaveLength(0);
  }
  // Un identifiant de la première école est introuvable depuis la seconde
  const premier = (await lire(request, '/eleves?limite=100'))[0];
  expect((await request.get(`/api/v1/eleves/${premier.id}`, { headers: enAutre })).status()).toBe(404);

  // Les identifiants du directeur de la première école ne valent rien dans la seconde
  const croise = await request.post('/api/v1/auth/connexion', {
    data: { identifiant: jeu.directeur.email, mot_de_passe: jeu.directeur.mdp, etablissement_code: codeAutre },
  });
  expect(croise.status()).toBe(401);
});
