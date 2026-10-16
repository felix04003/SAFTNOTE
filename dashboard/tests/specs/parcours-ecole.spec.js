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
    // « Mes données » : consentements et suppression du compte (le personnel est averti)
    await aller(page, 'ens-donnees');
    await expect(page.locator('input[data-consentement="notifications_sms"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#ens-donnees-conteneur')).toContainText('membre du personnel');
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
    // « Mes données » du parent : pas d'avertissement réservé au personnel
    await aller(page, 'par-donnees');
    await expect(page.locator('input[data-consentement="notifications_sms"]')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#par-donnees-conteneur')).not.toContainText('membre du personnel');
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

// ── 13. Bulletins : génération depuis le tableau de bord, puis validation ───

test('13. le directeur génère les bulletins de toutes les classes, puis les valide', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'bulletins');

  // Les notes ont été saisies sur la première période de l'année (étape 8)
  await expect(page.locator('#bull-periode option').first()).toBeAttached({ timeout: 8000 });
  const premiere = await page.locator('#bull-periode option').first().getAttribute('value');
  await page.selectOption('#bull-periode', premiere);

  const ligne = (classe) => page.locator('#tb-bull tr', { hasText: classe });
  await expect(ligne('6ème A')).toContainText('0/2', { timeout: 8000 });         // rien de généré au départ

  page.once('dialog', (d) => d.accept());                                         // « Calculer les moyennes et générer… ? »
  await page.click('button:has-text("Générer tous")');
  await expect(ligne('6ème A')).toContainText('2/2', { timeout: 15000 });
  await expect(ligne('5ème B')).toContainText('2/2');

  // Moyennes et rangs réellement calculés : 6ème A (coefficients égaux) = Awa (12,5 et 16) devant Fatou (15 et 13)
  const bulletins = await lire(request, `/bulletins?periode_id=${premiere}&limite=100`);
  const de = (prenom) => bulletins.find((b) => b.prenom === prenom);
  expect(Number(de('Awa').moyenne_generale)).toBeCloseTo(14.25, 2);
  expect(Number(de('Fatou').moyenne_generale)).toBeCloseTo(14, 2);
  expect([de('Awa').rang, de('Fatou').rang]).toEqual([1, 2]);
  expect(de('Cheikh').rang).toBe(1);                                              // 5ème B : 17 devant 9
  await expect(page.locator('#bull-kpi-generes')).toHaveText('4');

  // Validation d'une classe depuis la page
  page.once('dialog', (d) => d.accept());
  await ligne('6ème A').locator('button:has-text("Valider")').click();
  await expect(ligne('6ème A')).toContainText('2', { timeout: 8000 });
  await expect.poll(async () =>
    (await lire(request, `/bulletins?periode_id=${premiere}&limite=100`)).filter((b) => b.valide_at).length, { timeout: 8000 }).toBe(2);
});

// ── 14. Administration : plages horaires, SMS, agenda, sécurité, données personnelles ───

test('14. le directeur règle les horaires et le plafond SMS, tient l\'agenda, surveille la sécurité et exerce ses droits RGPD', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);

  // ── Plages horaires (Paramètres) : celles de l'école neuve, puis ajout et suppression ──
  await aller(page, 'parametres');
  const plages = page.locator('#param-plages-liste');
  await expect(plages).toContainText('1ère heure', { timeout: 8000 });
  await expect(plages).toContainText('Récréation');
  await page.click('button:has-text("+ Nouvelle plage")');
  await page.fill('#plage-numero', '12');
  await page.fill('#plage-libelle', 'Étude du soir');
  await page.fill('#plage-debut', '17:00');
  await page.fill('#plage-fin', '18:00');
  await page.click('#btn-plage-save');
  await expect(plages).toContainText('Étude du soir', { timeout: 8000 });
  expect((await lire(request, '/plages-horaires')).some((p) => p.libelle === 'Étude du soir')).toBe(true);

  page.once('dialog', (d) => d.accept());
  await plages.locator('tr', { hasText: 'Étude du soir' }).locator('button:has-text("Supprimer")').click();
  await expect(plages).not.toContainText('Étude du soir', { timeout: 8000 });

  // ── Plafond mensuel de SMS ──
  await page.fill('#sms-plafond', '500');
  await page.click('#btn-sms-plafond');
  await expect(page.locator('#sms-etat')).toContainText('/ 500 SMS', { timeout: 8000 });

  // ── Agenda : créer, modifier, supprimer ──
  await aller(page, 'agenda');
  await page.click('button:has-text("+ Nouvel événement")');
  await page.fill('#agd-titre', 'Réunion de parents du 1er trimestre');
  await page.fill('#agd-lieu', 'Salle des fêtes');
  await page.click('#btn-evenement-save');
  const agenda = page.locator('#tb-agenda');
  await expect(agenda).toContainText('Réunion de parents du 1er trimestre', { timeout: 8000 });
  await expect(agenda).toContainText('Salle des fêtes');

  await agenda.locator('tr', { hasText: 'Réunion de parents' }).locator('button:has-text("Modifier")').click();
  await page.fill('#agd-titre', 'Réunion de parents (reportée)');
  await page.fill('#agd-lieu', '');                                   // un champ vidé doit être effacé côté serveur
  await page.click('#btn-evenement-save');
  await expect(agenda).toContainText('reportée', { timeout: 8000 });
  await expect(agenda).not.toContainText('Salle des fêtes');

  page.once('dialog', (d) => d.accept());
  await agenda.locator('tr', { hasText: 'reportée' }).locator('button:has-text("Supprimer")').click();
  await expect(agenda).not.toContainText('reportée', { timeout: 8000 });

  // ── Sécurité : appareils connectés, blocage puis déblocage, journal ──
  await aller(page, 'securite');
  const sessions = page.locator('#tb-sessions');
  await expect(sessions).toContainText('Diallo', { timeout: 8000 });
  // Ses propres appareils (plusieurs : une session par connexion du parcours) : repérés « vous », jamais bloquables
  const miennes = sessions.locator('tr', { hasText: 'Diallo' });
  expect(await miennes.count()).toBeGreaterThanOrEqual(1);
  await expect(miennes.first()).toContainText('vous');
  await expect(miennes.locator('button:has-text("Bloquer")')).toHaveCount(0);
  const enseignante = sessions.locator('tr', { hasText: 'Sow' }).first();
  await expect(enseignante).toBeVisible();

  page.once('dialog', (d) => d.accept('Absence prolongée'));
  await enseignante.locator('button:has-text("Bloquer le compte")').click();
  const bloques = page.locator('#tb-bloques');
  await expect(bloques).toContainText('Sow', { timeout: 8000 });
  await expect(sessions).not.toContainText('Sow');
  await expect(page.locator('#tb-audit')).toContainText('Compte bloqué');

  page.once('dialog', (d) => d.accept('Compte rétabli'));
  await bloques.locator('tr', { hasText: 'Sow' }).locator('button:has-text("Débloquer")').click();
  await expect(bloques).toContainText('Aucun compte bloqué', { timeout: 8000 });
  await expect(page.locator('#tb-audit')).toContainText('Compte débloqué');

  // ── Mes données (RGPD) : consentement enregistré côté serveur, export téléchargé ──
  await aller(page, 'donnees');
  await page.check('input[data-consentement="notifications_sms"]');
  await expect.poll(async () =>
    (await lire(request, '/utilisateurs/moi/consentements')).find((c) => c.type === 'notifications_sms')?.accorde, { timeout: 8000 }).toBe(true);
  const [telechargement] = await Promise.all([page.waitForEvent('download'), page.click('#btn-donnees-export')]);
  expect(telechargement.suggestedFilename()).toMatch(/^mes-donnees-\d{4}-\d{2}-\d{2}\.json$/);
  // La suppression du compte reste verrouillée tant que le mot n'est pas tapé
  await expect(page.locator('#btn-donnees-supprimer')).toBeDisabled();
});

// ── 15. Fiche élève ─────────────────────────────────────────────────────────

test('15. la fiche d\'un élève réunit identité, parents, résultats, notes et absences', async ({ page }) => {
  const fatou = jeu.eleves.find((e) => e.prenom === 'Fatou');
  await seConnecterEnDirecteur(page);
  await aller(page, 'eleves');
  await page.locator('#tb-eleves tr', { hasText: 'Fatou' }).locator('button:has-text("Fiche")').click();

  const fiche = page.locator('#fiche-eleve-contenu');
  await expect(page.locator('#page-fiche-eleve')).toHaveClass(/active/);
  await expect(fiche).toContainText('Fatou Ndiaye', { timeout: 10000 });
  await expect(fiche).toContainText('6ème A');
  await expect(fiche).toContainText('14/03/2013');                                   // date de naissance (profil)
  await expect(fiche).toContainText(`${fatou.parent.prenom} ${fatou.parent.nom}`);   // parent / tuteur
  await expect(fiche).toContainText(fatou.parent.telephone);
  await expect(fiche).toContainText('Contact principal');
  await expect(fiche).toContainText('Aucune donnée médicale renseignée');           // la direction voit la section

  // Résultats calculés à l'étape 13 : Maths 15, Français 13 → 14 ; Awa (14,25) est devant : Fatou 2e sur 2
  await expect(fiche).toContainText('14/20');
  await expect(fiche).toContainText('Rang 2/2');
  await expect(fiche).toContainText('Mathématiques');
  await expect(fiche).toContainText('15/20');                                        // note publiée du devoir de maths
  await expect(fiche).toContainText('Aucune absence enregistrée');

  // Retour à la liste
  await page.click('button:has-text("Retour aux élèves")');
  await expect(page.locator('#page-eleves')).toHaveClass(/active/);
});

// ── 16. Nomination d'un second directeur ────────────────────────────────────

test('16. le directeur nomme un second directeur, qui se connecte et change son mot de passe provisoire', async ({ page, request }) => {
  const d2 = jeu.directeur2;
  await seConnecterEnDirecteur(page);
  await aller(page, 'securite');

  // Champs incomplets : rien n'est envoyé
  await page.click('#dir-creer');
  await expect(page.locator('#toast-container')).toContainText('obligatoires', { timeout: 5000 });

  await page.fill('#dir-prenom', d2.prenom);
  await page.fill('#dir-nom', d2.nom);
  await page.fill('#dir-tel', d2.telephone);
  await page.fill('#dir-email', d2.email);

  // Confirmation, puis (pas de SMS en test) alerte qui contient le mot de passe provisoire
  const messages = [];
  page.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
  await page.click('#dir-creer');
  await expect.poll(() => messages.length, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  expect(messages[0]).toContain(`${d2.prenom} ${d2.nom}`);
  const mdpProvisoire = (messages[1].match(/Mot de passe provisoire : (\S+)/) || [])[1];
  expect(mdpProvisoire, 'mot de passe provisoire absent de l\'alerte').toBeTruthy();
  page.removeAllListeners('dialog');

  await expect(page.locator('#dir-nom')).toHaveValue('');                       // formulaire vidé
  await expect(page.locator('#tb-audit')).toContainText('Directeur nommé', { timeout: 8000 });

  // Le même numéro ne peut pas être nommé deux fois
  await page.fill('#dir-prenom', d2.prenom);
  await page.fill('#dir-nom', d2.nom);
  await page.fill('#dir-tel', d2.telephone);
  page.once('dialog', (d) => d.accept());
  await page.click('#dir-creer');
  await expect(page.locator('#toast-container')).toContainText('existe déjà', { timeout: 8000 });

  // Le nouveau directeur se connecte (mot de passe provisoire → changement obligatoire) puis arrive au tableau de bord
  await page.evaluate(() => sessionStorage.clear());
  const nouveauMdp = 'Succession2026x';
  await seConnecter(page, { identifiant: d2.email, mdp: mdpProvisoire });
  await page.waitForURL(/changer-mot-de-passe/, { timeout: 10000 });
  await page.fill('#mdp-actuel', mdpProvisoire);
  await page.fill('#mdp-nouveau', nouveauMdp);
  await page.fill('#mdp-confirm', nouveauMdp);
  await page.click('#btn-changer');
  await page.waitForURL(/index\.html/, { timeout: 10000 });
  await expect(page.locator('#sb-user-nom')).toContainText(d2.nom);
  await aller(page, 'securite');                                                  // il a bien les droits de direction
  await expect(page.locator('#tb-audit')).toContainText('Directeur nommé', { timeout: 8000 });
});

// ── 17. Corriger l'inscription : élèves, classes, matières ─────────────────

test('17. le directeur modifie et retire un élève, modifie et archive une classe et une matière', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  const toasts = page.locator('#toast-container');

  // ── Élève : changer sa classe et corriger son prénom ──
  await aller(page, 'eleves');
  const ligne = (texte) => page.locator('#tb-eleves tr', { hasText: texte });
  await expect(ligne('Cheikh')).toBeVisible({ timeout: 8000 });
  const cheikh = (await lire(request, '/eleves?recherche=Cheikh'))[0];
  const avant = await lire(request, `/eleves/${cheikh.id}`);
  expect(avant.classe).toContain('5ème B');

  await ligne('Cheikh').locator('button:has-text("Modifier")').click();
  await expect(page.locator('#m-eleve-modif')).toHaveClass(/open/);
  await expect(page.locator('#emod-nom')).toHaveValue('Fall', { timeout: 8000 });
  await page.fill('#emod-prenom', 'Cheikh Omar');
  await choisir(page, '#emod-classe', '6ème A');
  await page.click('#btn-eleve-modif');
  await expect(page.locator('#m-eleve-modif')).not.toHaveClass(/open/, { timeout: 8000 });
  await expect(ligne('Cheikh Omar')).toContainText('6ème A', { timeout: 8000 });
  const apres = await lire(request, `/eleves/${cheikh.id}`);
  expect(apres.prenom).toBe('Cheikh Omar');
  expect(apres.classe).toContain('6ème A');

  // ── Élève : retrait (transfert), visible dans « Retirés », puis réintégration ──
  await ligne('Cheikh Omar').locator('button:has-text("Retirer")').click();
  await page.click('#btn-eleve-retrait');                                   // sans motif : refusé
  await expect(toasts).toContainText('motif', { timeout: 5000 });
  await page.fill('#ret-motif', 'Déménagement à Dakar');
  await page.click('#btn-eleve-retrait');
  await expect(ligne('Cheikh Omar')).toHaveCount(0, { timeout: 8000 });

  await page.selectOption('#sel-statut-eleves', 'retires');
  await expect(ligne('Cheikh Omar')).toContainText('Transféré', { timeout: 8000 });
  await expect(ligne('Cheikh Omar').locator('button:has-text("Modifier")')).toHaveCount(0);
  page.once('dialog', (d) => d.accept());
  await ligne('Cheikh Omar').locator('button:has-text("Réintégrer")').click();
  await expect(ligne('Cheikh Omar')).toHaveCount(0, { timeout: 8000 });
  await page.selectOption('#sel-statut-eleves', '');
  await expect(ligne('Cheikh Omar')).toContainText('Inscrit', { timeout: 8000 });

  // ── Classe : créer une classe vide, la modifier, refuser l'archivage d'une classe pleine, archiver la vide ──
  await aller(page, 'classes');
  await page.click('button:has-text("+ Nouvelle classe")');
  await page.waitForFunction(() => (document.getElementById('m-classe-niveau')?.children.length || 0) > 1);
  await choisir(page, '#m-classe-niveau', '6ème');
  await page.fill('#m-classe-nom', 'Z');
  await page.fill('#m-classe-salle', 'Salle provisoire');
  await page.click('#btn-creer-classe');
  const grille = page.locator('#cls-grid');
  const carteZ = () => grille.locator('.carte', { hasText: 'Salle provisoire' });
  await expect(carteZ()).toBeVisible({ timeout: 8000 });

  await carteZ().locator('button:has-text("Modifier")').click();
  await expect(page.locator('#m-classe-niveau')).toBeDisabled();
  await page.fill('#m-classe-salle', 'Salle 99');
  await page.click('#btn-creer-classe');
  await expect(grille).toContainText('Salle 99', { timeout: 8000 });
  await expect(grille).not.toContainText('Salle provisoire');

  page.once('dialog', (d) => d.accept());
  await grille.locator('.carte', { hasText: 'Salle 1' }).locator('button:has-text("Archiver")').click();   // 6ème A : élèves inscrits
  await expect(toasts).toContainText('élève', { timeout: 8000 });
  await expect(grille).toContainText('Salle 1');

  page.once('dialog', (d) => d.accept());
  await grille.locator('.carte', { hasText: 'Salle 99' }).locator('button:has-text("Archiver")').click();
  await expect(grille).not.toContainText('Salle 99', { timeout: 8000 });
  expect((await lire(request, '/classes')).some((c) => c.salle_principale === 'Salle 99')).toBe(false);

  // ── Matière : créer, renommer, archiver (masquée), réactiver ; une matière enseignée ne s'archive pas ──
  await aller(page, 'parametres');
  const matieres = page.locator('#param-matieres-liste');
  await page.click('button:has-text("+ Nouvelle matière")');
  await page.fill('#m-mat-nom', 'Histoire');
  await page.fill('#m-mat-code', 'HIST');
  await page.click('#btn-creer-matiere');
  const rangee = (texte) => matieres.locator('> div', { hasText: texte });
  await expect(rangee('Histoire')).toBeVisible({ timeout: 8000 });

  await rangee('Histoire').locator('button:has-text("Modifier")').click();
  await expect(page.locator('#m-mat-code')).toHaveValue('HIST');
  await page.fill('#m-mat-nom', 'Histoire-Géographie');
  await page.click('#btn-creer-matiere');
  await expect(rangee('Histoire-Géographie')).toBeVisible({ timeout: 8000 });

  page.once('dialog', (d) => d.accept());
  await rangee('Mathématiques').locator('button:has-text("Archiver")').click();
  await expect(toasts).toContainText('affectation', { timeout: 8000 });

  page.once('dialog', (d) => d.accept());
  await rangee('Histoire-Géographie').locator('button:has-text("Archiver")').click();
  await expect(rangee('Histoire-Géographie')).toContainText('Inactif', { timeout: 8000 });
  await rangee('Histoire-Géographie').locator('button:has-text("Réactiver")').click();
  await expect(rangee('Histoire-Géographie')).not.toContainText('Inactif', { timeout: 8000 });
});

// ── 18. Fin d'année et réinscription ────────────────────────────────────────

test('18. le directeur clôture l\'année et réinscrit les élèves dans la nouvelle', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  const ancienne = await lire(request, '/annees-scolaires/courante');
  await page.click('[data-page="passage"]');
  await expect(page.locator('#page-passage')).toHaveClass(/active/);

  // Aperçu : l'année suivante est proposée, chaque élève inscrit a une ligne et une décision
  const lignes = page.locator('#psg-classes tbody tr');
  await expect(lignes.first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#psg-annee-courante')).toHaveText(ancienne.libelle);
  const [debutAnnee, finAnnee] = ancienne.libelle.split('-').map(Number);
  const suivante = `${debutAnnee + 1}-${finAnnee + 1}`;
  await expect(page.locator('#psg-libelle')).toHaveValue(suivante);
  await expect(page.locator('#psg-resume')).toContainText('4 élèves');
  const ligne = (texte) => page.locator('#psg-classes tbody tr', { hasText: texte });
  await expect(ligne('Fatou')).toBeVisible();

  // Décisions explicites (indépendantes des moyennes calculées) ; chaque changement réaffiche la liste
  await ligne('Awa Traoré').locator('select').first().selectOption('redouble');
  await ligne('Moussa').locator('select').first().selectOption('admis');
  await ligne('Cheikh').locator('select').first().selectOption('transfere');
  await expect(page.locator('#psg-resume')).toContainText('1 sortie');

  // Confirmation
  const messages = [];
  page.once('dialog', (d) => { messages.push(d.message()); d.accept(); });
  await page.click('#psg-confirmer');
  await expect(page.locator('#page-dashboard')).toHaveClass(/active/, { timeout: 15000 });
  expect(messages[0]).toContain(`Clôturer l'année ${ancienne.libelle}`);
  expect(messages[0]).toContain('ne peut pas être annulée');

  // Effets côté serveur
  const courante = await lire(request, '/annees-scolaires/courante');
  expect(courante.libelle).toBe(suivante);
  expect(courante.periodes).toHaveLength(3);
  const annees = await lire(request, '/annees-scolaires');
  expect(annees.find((a) => a.libelle === ancienne.libelle).cloturee_at).not.toBeNull();

  const eleves = await lire(request, '/eleves?limite=50');
  const classeDe = (prenom) => (eleves.find((e) => e.prenom.startsWith(prenom)) || {}).classe;
  expect(classeDe('Fatou')).toBe('5ème A');             // 6ème A -> 5ème (même lettre, classe créée)
  expect(classeDe('Awa')).toBe('6ème A');               // redouble
  expect(classeDe('Moussa')).toBe('4ème B');            // 5ème B -> 4ème B
  expect(classeDe('Cheikh')).toBeUndefined();           // transféré : pas réinscrit
  const libelles = (await lire(request, '/classes')).map((c) => c.nom_classe);
  for (const attendu of ['6ème A', '5ème B', '5ème A', '4ème B']) expect(libelles).toContain(attendu);

  // L'écran Élèves reflète la nouvelle année
  await aller(page, 'eleves');
  await expect(page.locator('#tb-eleves tr', { hasText: 'Fatou' })).toContainText('5ème A', { timeout: 8000 });
});

// ── 19. Parents d'un élève après l'inscription ──────────────────────────────

test('19. le directeur ajoute, corrige et retire un parent depuis la fiche d\'un élève', async ({ page, request }) => {
  const supp = jeu.parentSupplementaire;
  await seConnecterEnDirecteur(page);
  await aller(page, 'eleves');
  await page.locator('#tb-eleves tr', { hasText: 'Fatou' }).locator('button:has-text("Fiche")').click();
  const fiche = page.locator('#fiche-eleve-contenu');
  const ligne = (texte) => fiche.locator('tr', { hasText: texte });
  await expect(ligne('Papa Ndiaye')).toContainText('Contact principal', { timeout: 10000 });

  // ── Ajouter un second parent, contact principal ──
  await page.click('button:has-text("+ Ajouter")');
  await expect(page.locator('#m-parent')).toHaveClass(/open/);
  await page.fill('#fpar-prenom', supp.prenom);
  await page.fill('#fpar-nom', supp.nom);
  await page.fill('#fpar-tel', supp.telephone);
  await page.selectOption('#fpar-lien', supp.lien);
  await page.check('#fpar-principal');
  await page.click('#fpar-enregistrer');
  await expect(page.locator('#m-parent')).not.toHaveClass(/open/, { timeout: 8000 });
  await expect(ligne('Aminata Ndiaye')).toContainText('Contact principal', { timeout: 8000 });
  await expect(ligne('Papa Ndiaye')).not.toContainText('Contact principal');         // un seul principal

  // ── Corriger son numéro : le compte change, pour tous ses enfants ──
  await ligne('Aminata Ndiaye').locator('button:has-text("Modifier")').click();
  await expect(page.locator('#fpar-tel')).toHaveValue(/\+221/);
  await page.fill('#fpar-tel', supp.nouveauTelephone);
  await page.click('#fpar-enregistrer');
  await expect(ligne('Aminata Ndiaye')).toContainText(supp.nouveauTelephone, { timeout: 8000 });
  const fatou = (await lire(request, '/eleves?recherche=Fatou'))[0];
  const parents = (await lire(request, `/eleves/${fatou.id}`)).parents;
  expect(parents.map((p) => p.telephone)).toContain(supp.nouveauTelephone);
  expect(parents.map((p) => p.telephone)).not.toContain(supp.telephone);

  // ── Un numéro déjà connu est réutilisé : Papa Ndiaye devient aussi le tuteur d'Awa, sans second compte ──
  await aller(page, 'eleves');
  await page.locator('#tb-eleves tr', { hasText: 'Awa' }).locator('button:has-text("Fiche")').click();
  await expect(fiche).toContainText('Awa', { timeout: 10000 });
  await page.click('button:has-text("+ Ajouter")');
  await page.fill('#fpar-prenom', 'Autre');
  await page.fill('#fpar-nom', 'Nom');
  await page.fill('#fpar-tel', jeu.parents.ndiaye.telephone);
  await page.click('#fpar-enregistrer');
  await expect(page.locator('#toast-container')).toContainText('déjà celui de Papa Ndiaye', { timeout: 8000 });
  await expect(ligne('Papa Ndiaye')).toBeVisible({ timeout: 8000 });
  await expect(fiche).not.toContainText('Autre Nom');                                  // les noms saisis sont ignorés

  // ── Retirer Aminata de Fatou : confirmation, Papa redevient le contact principal ──
  await aller(page, 'eleves');
  await page.locator('#tb-eleves tr', { hasText: 'Fatou' }).locator('button:has-text("Fiche")').click();
  await expect(ligne('Aminata Ndiaye')).toBeVisible({ timeout: 10000 });
  page.once('dialog', (d) => d.accept());
  await ligne('Aminata Ndiaye').locator('button:has-text("Retirer")').click();
  await expect(fiche).not.toContainText('Aminata Ndiaye', { timeout: 8000 });
  await expect(ligne('Papa Ndiaye')).toContainText('Contact principal');
  const apres = (await lire(request, `/eleves/${fatou.id}`)).parents;
  expect(apres.map((p) => `${p.prenom} ${p.nom}`)).toEqual(['Papa Ndiaye']);
});

// ── 20. Discipline côté direction ───────────────────────────────────────────

test('20. le directeur prononce une sanction, la retrouve dans la liste et en corrige le motif', async ({ page, request }) => {
  await seConnecterEnDirecteur(page);
  await aller(page, 'discipline');
  await expect(page.locator('#tb-discipline')).toContainText('Aucune sanction', { timeout: 10000 });

  // ── Prononcer : la classe d'Awa a pu changer à la fin d'année, on la cherche parmi les classes de l'année ──
  await page.click('button:has-text("+ Prononcer une sanction")');
  await expect(page.locator('#m-sanction')).toHaveClass(/open/);
  const classes = await page.locator('#dsc-classe option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
  for (const classe of classes) {
    await page.selectOption('#dsc-classe', classe);
    await page.waitForFunction(() => !(document.getElementById('dsc-eleve')?.textContent || '').includes('Chargement'));
    if (await page.locator('#dsc-eleve option', { hasText: 'Awa' }).count()) break;
  }
  await choisir(page, '#dsc-eleve', 'Awa');
  await page.selectOption('#dsc-type', 'retenue');
  await page.fill('#dsc-motif', 'ab');                                              // trop court : refusé avant tout appel
  await page.click('#btn-sanction-save');
  await expect(page.locator('#dsc-err')).toContainText('motif');
  await page.fill('#dsc-motif', 'Bavardages répétés en cours');
  await page.fill('#dsc-jours', '2');
  await page.click('#btn-sanction-save');
  await expect(page.locator('#m-sanction')).not.toHaveClass(/open/, { timeout: 8000 });
  const ligne = page.locator('#tb-discipline tr', { hasText: 'Awa' });
  await expect(ligne).toContainText('Retenue', { timeout: 8000 });
  await expect(ligne).toContainText('Bavardages répétés en cours');

  // ── Corriger le motif : l'élève et le type restent ──
  await ligne.locator('button:has-text("Modifier")').click();
  await expect(page.locator('#dsc-bloc-creation')).toBeHidden();
  await page.fill('#dsc-motif', 'Bavardages répétés, deuxième fois');
  await page.click('#btn-sanction-save');
  await expect(ligne).toContainText('deuxième fois', { timeout: 8000 });
  const sanctions = await lire(request, '/discipline/sanctions');
  expect(sanctions).toHaveLength(1);
  expect(sanctions[0]).toMatchObject({ type: 'retenue', nb_jours: 2, motif: 'Bavardages répétés, deuxième fois' });

  // ── Filtre par type : un autre type ne montre rien ──
  await page.selectOption('#dsc-fil-type', 'exclusion_definitive');
  await expect(page.locator('#tb-discipline')).toContainText('Aucune sanction', { timeout: 8000 });
});

// ── 21. Bulletins des années clôturées, côté parent ─────────────────────────

test('21. après la fin d\'année, le parent retrouve les bulletins de l\'année clôturée', async ({ page }) => {
  test.skip(!psqlDisponible, 'psql est nécessaire pour fixer le code SMS (variables POSTGRES_* de la base de test)');
  const papa = jeu.parents.ndiaye;
  await page.goto('/parent-login.html');
  await page.fill('#inp-telephone', papa.telephone);
  await page.click('#btn-demander');
  await expect(page.locator('#etape2')).toBeVisible({ timeout: 10000 });
  fixerCodeSms(papa.telephone, '424242');
  const cases = page.locator('#otp-inputs input');
  for (let i = 0; i < 6; i++) await cases.nth(i).fill('424242'[i]);
  await page.click('#btn-valider');
  await page.waitForURL(/parent\.html/, { timeout: 10000 });

  await choisir(page, '#par-enfant-sel', 'Fatou');
  await aller(page, 'par-bulletins');
  // Nouvelle année : rien de validé, mais le sélecteur propose l'année clôturée
  const annees = page.locator('#par-bulletins-annee option');
  await expect(annees).toHaveCount(2, { timeout: 8000 });
  await expect(page.locator('#par-bulletins-liste')).toContainText('Aucun bulletin');
  await page.selectOption('#par-bulletins-annee', { index: 1 });                  // la plus ancienne vient en dernier
  await expect(page.locator('#par-bulletins-liste')).not.toContainText('Aucun bulletin', { timeout: 8000 });
  await expect(page.locator('#par-bulletins-liste')).toContainText('Trimestre 1');
  await expect(page.locator('#par-bulletins-liste')).toContainText('Mathématiques');   // détail des matières de l'ancienne année
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
});
