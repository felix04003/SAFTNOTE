# Génération PDF bulletins — Plan d'implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter la génération asynchrone de PDFs de bulletins scolaires via BullMQ + Puppeteer avec upload sur Cloudflare R2.

**Architecture:** `POST /bulletins/generer` enqueue un job BullMQ. Le worker récupère les données de chaque élève, génère un HTML via un template, le convertit en PDF via Puppeteer, l'uploade sur R2 et met à jour `bulletin_url` en DB. Le client poll `GET /bulletins/:id/download` jusqu'à ce que l'URL soit disponible.

**Tech Stack:** Node.js 20, Express, Knex/PostgreSQL, BullMQ, Puppeteer 22, @aws-sdk/client-s3 (R2-compatible), Jest, Supertest.

---

## Chunk 1 : Infrastructure R2 + dépendance

### Task 1 : Installer @aws-sdk/client-s3

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1 : Installer la dépendance**

```bash
cd backend
npm install @aws-sdk/client-s3 --no-workspaces
```

Expected output : `added N packages` sans erreur.

- [ ] **Step 2 : Vérifier l'installation**

```bash
node -e "require('@aws-sdk/client-s3'); console.log('OK')"
```

Expected : `OK`

- [ ] **Step 3 : Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "chore: add @aws-sdk/client-s3 for Cloudflare R2"
```

---

### Task 2 : Service R2 (r2.service.js)

**Files:**
- Create: `backend/src/infrastructure/storage/r2.service.js`
- Create: `backend/tests/infrastructure/r2.service.test.js`

- [ ] **Step 1 : Écrire le test unitaire**

Créer `backend/tests/infrastructure/r2.service.test.js` :

```js
'use strict';

// Mock AWS SDK avant tout require
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));

describe('r2.service', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...OLD_ENV,
      R2_ACCOUNT_ID:       'test-account',
      R2_ACCESS_KEY_ID:    'test-key',
      R2_SECRET_ACCESS_KEY:'test-secret',
      R2_BUCKET_NAME:      'test-bucket',
      R2_PUBLIC_URL:       'https://r2.example.com',
    };
  });

  afterEach(() => { process.env = OLD_ENV; });

  test('uploadPDF retourne une URL publique R2', async () => {
    const { uploadPDF } = require('../../src/infrastructure/storage/r2.service');
    const buffer = Buffer.from('%PDF-1.4 fake pdf content');
    const key = 'bulletins/bul-001.pdf';

    const url = await uploadPDF(buffer, key);

    expect(url).toBe('https://r2.example.com/bulletins/bul-001.pdf');
  });

  test('uploadPDF sans config R2 écrit en local et retourne chemin local', async () => {
    delete process.env.R2_ACCOUNT_ID;
    const { uploadPDF } = require('../../src/infrastructure/storage/r2.service');
    const buffer = Buffer.from('%PDF-1.4 fake pdf content');

    const url = await uploadPDF(buffer, 'bulletins/bul-local.pdf');

    expect(url).toMatch(/^local:\/\//);
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd backend
npx jest --testPathPattern="r2.service" --no-coverage --verbose 2>&1
```

Expected : `FAIL` — `Cannot find module '../../src/infrastructure/storage/r2.service'`

- [ ] **Step 3 : Implémenter r2.service.js**

Créer `backend/src/infrastructure/storage/r2.service.js` :

```js
'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('../../utils/logger');

/**
 * Upload un buffer PDF vers Cloudflare R2 (compatible S3).
 * En mode dev sans config R2, écrit le fichier dans /tmp/bulletins/.
 *
 * @param {Buffer} buffer  - Contenu du PDF
 * @param {string} key     - Chemin dans le bucket, ex: "bulletins/bul-001.pdf"
 * @returns {Promise<string>} URL publique du fichier
 */
async function uploadPDF(buffer, key) {
  const {
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME, R2_PUBLIC_URL,
  } = process.env;

  // Mode dev : pas de config R2 → écriture locale
  if (!R2_ACCOUNT_ID) {
    const localDir = '/tmp/bulletins';
    if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, path.basename(key));
    fs.writeFileSync(localPath, buffer);
    logger.warn('R2 non configuré — PDF écrit localement', { path: localPath });
    return `local://${localPath}`;
  }

  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  await client.send(new PutObjectCommand({
    Bucket:      R2_BUCKET_NAME,
    Key:         key,
    Body:        buffer,
    ContentType: 'application/pdf',
  }));

  const url = `${R2_PUBLIC_URL}/${key}`;
  logger.info('PDF uploadé sur R2', { key, url });
  return url;
}

module.exports = { uploadPDF };
```

- [ ] **Step 4 : Vérifier que le test passe**

```bash
cd backend
npx jest --testPathPattern="r2.service" --no-coverage --verbose 2>&1
```

Expected : `PASS` — 2 tests passent.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/infrastructure/storage/r2.service.js \
        backend/tests/infrastructure/r2.service.test.js
git commit -m "feat: service Cloudflare R2 pour upload PDF bulletins"
```

---

## Chunk 2 : Template HTML + Worker

### Task 3 : Template HTML du bulletin (bulletin.template.js)

**Files:**
- Create: `backend/src/templates/bulletin.template.js`
- Create: `backend/tests/templates/bulletin.template.test.js`

- [ ] **Step 1 : Écrire le test unitaire**

Créer `backend/tests/templates/bulletin.template.test.js` :

```js
'use strict';

const { genererHTML } = require('../../src/templates/bulletin.template');

const donneesTest = {
  etablissement: {
    nom: 'Lycée Delafosse',
    code_officiel: 'LYC-001',
    ville: 'Dakar',
    telephone: '+221 33 123 45 67',
    logo_url: null,
  },
  eleve: {
    nom: 'TRAORÉ',
    prenom: 'Aminata',
    date_naissance: '2008-03-15',
    genre: 'F',
    matricule: 'ELV-001',
    classe: 'Terminale S1',
    niveau: 'Terminale',
  },
  periode: {
    trimestre: 1,
    libelle: 'Trimestre 1',
    annee_scolaire: '2024-2025',
  },
  matieres: [
    {
      matiere: 'Mathématiques', matiere_code: 'MATH', discipline: 'Sciences',
      moyenne: 14.5, coefficient: 5, points: 72.5,
      appreciation_enseignant: 'Bon travail', est_complete: true,
    },
    {
      matiere: 'Physique-Chimie', matiere_code: 'PC', discipline: 'Sciences',
      moyenne: 12.0, coefficient: 4, points: 48,
      appreciation_enseignant: 'Assez bien', est_complete: true,
    },
  ],
  conduite: { valeur: 18, appreciation: 'Très bien' },
  resultat: {
    total_points: 290,
    total_coefficients: 20,
    moyenne_generale: 14.5,
    rang: 3,
    rang_sur: 35,
    mention: 'Bien',
    decision_conseil: 'encouragements',
    appreciation_conseil: 'Bon trimestre, continuez ainsi.',
  },
  absences: { justifiees: 2, injustifiees: 1, retards: 0 },
};

describe('bulletin.template', () => {
  test('genererHTML retourne une chaîne HTML non vide', () => {
    const html = genererHTML(donneesTest);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toContain('<!DOCTYPE html>');
  });

  test('le HTML contient le nom de l\'élève', () => {
    const html = genererHTML(donneesTest);
    expect(html).toContain('TRAORÉ');
    expect(html).toContain('Aminata');
  });

  test('le HTML contient le nom de l\'établissement', () => {
    const html = genererHTML(donneesTest);
    expect(html).toContain('Lycée Delafosse');
  });

  test('le HTML contient la moyenne générale', () => {
    const html = genererHTML(donneesTest);
    expect(html).toContain('14.5');
  });

  test('le HTML contient les matières', () => {
    const html = genererHTML(donneesTest);
    expect(html).toContain('Mathématiques');
    expect(html).toContain('Physique-Chimie');
  });

  test('genererHTML sans logo affiche les initiales de l\'établissement', () => {
    const html = genererHTML(donneesTest);
    // Pas de balise <img> pour le logo quand logo_url est null
    expect(html).not.toContain('<img');
  });
});
```

- [ ] **Step 2 : Vérifier que les tests échouent**

```bash
cd backend
npx jest --testPathPattern="bulletin.template" --no-coverage --verbose 2>&1
```

Expected : `FAIL` — `Cannot find module '../../src/templates/bulletin.template'`

- [ ] **Step 3 : Implémenter bulletin.template.js**

Créer `backend/src/templates/bulletin.template.js` :

```js
'use strict';

/**
 * Génère le HTML complet d'un bulletin scolaire pour rendu Puppeteer.
 * Tout le CSS est inline (Puppeteer ne charge pas de fichiers externes).
 *
 * @param {object} data
 * @param {object} data.etablissement
 * @param {object} data.eleve
 * @param {object} data.periode
 * @param {Array}  data.matieres
 * @param {object|null} data.conduite
 * @param {object} data.resultat
 * @param {object} data.absences
 * @returns {string} HTML complet
 */
function genererHTML({ etablissement, eleve, periode, matieres, conduite, resultat, absences }) {
  const mentionLibelle = {
    excellent:    'Excellent',
    tres_bien:    'Très Bien',
    bien:         'Bien',
    assez_bien:   'Assez Bien',
    passable:     'Passable',
    insuffisant:  'Insuffisant',
  };

  const decisionLibelle = {
    felicitations:    'Félicitations du conseil',
    encouragements:   'Encouragements du conseil',
    tableau_honneur:  'Tableau d\'honneur',
    avert_travail:    'Avertissement travail',
    avert_conduite:   'Avertissement conduite',
    aucune:           '',
  };

  const lignesMatieres = matieres.map((m, i) => `
    <tr style="background:${i % 2 === 0 ? '#f8f9fa' : '#ffffff'}">
      <td style="padding:6px 8px;border:1px solid #dee2e6">${m.matiere}</td>
      <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">${m.coefficient}</td>
      <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center;font-weight:bold">
        ${m.moyenne !== null ? Number(m.moyenne).toFixed(2) : '—'}
      </td>
      <td style="padding:6px 8px;border:1px solid #dee2e6;text-align:center">
        ${m.points !== null ? Number(m.points).toFixed(2) : '—'}
      </td>
      <td style="padding:6px 8px;border:1px solid #dee2e6;font-size:11px;color:#555">
        ${m.appreciation_enseignant || ''}
      </td>
    </tr>
  `).join('');

  const logoHTML = etablissement.logo_url
    ? `<img src="${etablissement.logo_url}" alt="Logo" style="height:60px;object-fit:contain">`
    : `<div style="width:60px;height:60px;background:#1a5276;border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;font-size:20px">${etablissement.nom.charAt(0)}</div>`;

  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bulletin — ${eleve.prenom} ${eleve.nom}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #212529; }
    .page { width: 210mm; min-height: 297mm; padding: 15mm; }
  </style>
</head>
<body>
<div class="page">

  <!-- En-tête établissement -->
  <div style="display:flex;align-items:center;gap:16px;padding-bottom:12px;border-bottom:3px solid #1a5276;margin-bottom:12px">
    ${logoHTML}
    <div style="flex:1">
      <div style="font-size:18px;font-weight:bold;color:#1a5276;text-transform:uppercase">${etablissement.nom}</div>
      <div style="font-size:12px;color:#555;margin-top:2px">${etablissement.ville || ''} ${etablissement.telephone ? '• ' + etablissement.telephone : ''}</div>
      <div style="font-size:12px;color:#555">Année scolaire : <strong>${periode.annee_scolaire}</strong></div>
    </div>
    <div style="text-align:right">
      <div style="font-size:14px;font-weight:bold;color:#1a5276">BULLETIN DE NOTES</div>
      <div style="font-size:13px;margin-top:4px">${periode.libelle}</div>
    </div>
  </div>

  <!-- Identité élève -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px;background:#eaf0fb;border-radius:4px;margin-bottom:14px">
    <div><span style="color:#555;font-size:12px">Élève</span><br><strong>${eleve.prenom} ${eleve.nom}</strong></div>
    <div><span style="color:#555;font-size:12px">Matricule</span><br><strong>${eleve.matricule}</strong></div>
    <div><span style="color:#555;font-size:12px">Classe</span><br><strong>${eleve.classe}</strong></div>
    <div><span style="color:#555;font-size:12px">Rang</span><br><strong>${resultat.rang} / ${resultat.rang_sur}</strong></div>
  </div>

  <!-- Tableau des notes -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <thead>
      <tr style="background:#1a5276;color:white">
        <th style="padding:8px;border:1px solid #1a5276;text-align:left">Matière</th>
        <th style="padding:8px;border:1px solid #1a5276;text-align:center">Coef.</th>
        <th style="padding:8px;border:1px solid #1a5276;text-align:center">Note /20</th>
        <th style="padding:8px;border:1px solid #1a5276;text-align:center">Points</th>
        <th style="padding:8px;border:1px solid #1a5276;text-align:left">Appréciation</th>
      </tr>
    </thead>
    <tbody>${lignesMatieres}</tbody>
  </table>

  <!-- Résultat général -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
    <div style="padding:10px;background:#1a5276;color:white;border-radius:4px;text-align:center">
      <div style="font-size:11px;opacity:.8">Moyenne générale</div>
      <div style="font-size:22px;font-weight:bold">${Number(resultat.moyenne_generale).toFixed(2)}<span style="font-size:13px">/20</span></div>
    </div>
    <div style="padding:10px;background:#eaf0fb;border-radius:4px;text-align:center">
      <div style="font-size:11px;color:#555">Mention</div>
      <div style="font-size:16px;font-weight:bold;color:#1a5276">${mentionLibelle[resultat.mention] || resultat.mention || '—'}</div>
    </div>
    <div style="padding:10px;background:#eaf0fb;border-radius:4px;text-align:center">
      <div style="font-size:11px;color:#555">Absences</div>
      <div style="font-size:13px;margin-top:2px">
        Just. : <strong>${absences.justifiees || 0}</strong> •
        Injust. : <strong>${absences.injustifiees || 0}</strong> •
        Retards : <strong>${absences.retards || 0}</strong>
      </div>
    </div>
  </div>

  <!-- Appréciation conseil -->
  ${resultat.appreciation_conseil || resultat.decision_conseil ? `
  <div style="padding:10px;border-left:4px solid #1a5276;background:#f8f9fa;margin-bottom:14px;border-radius:0 4px 4px 0">
    ${resultat.decision_conseil && decisionLibelle[resultat.decision_conseil] ? `<div style="font-weight:bold;color:#1a5276;margin-bottom:4px">${decisionLibelle[resultat.decision_conseil]}</div>` : ''}
    ${resultat.appreciation_conseil ? `<div style="font-style:italic">"${resultat.appreciation_conseil}"</div>` : ''}
  </div>
  ` : ''}

  <!-- Conduite -->
  ${conduite ? `
  <div style="margin-bottom:14px;font-size:12px;color:#555">
    Conduite : <strong>${conduite.valeur}/20</strong>${conduite.appreciation ? ' — ' + conduite.appreciation : ''}
  </div>
  ` : ''}

  <!-- Signature -->
  <div style="display:flex;justify-content:space-between;margin-top:30px;padding-top:14px;border-top:1px solid #dee2e6">
    <div style="font-size:12px;color:#555">Fait le ${dateStr}</div>
    <div style="text-align:center">
      <div style="font-size:12px;color:#555;margin-bottom:20px">Le Directeur(trice)</div>
      <div style="width:140px;border-top:1px solid #212529;margin:0 auto"></div>
    </div>
  </div>

</div>
</body>
</html>`;
}

module.exports = { genererHTML };
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend
npx jest --testPathPattern="bulletin.template" --no-coverage --verbose 2>&1
```

Expected : `PASS` — 6 tests passent.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/templates/bulletin.template.js \
        backend/tests/templates/bulletin.template.test.js
git commit -m "feat: template HTML bulletin scolaire (A4, CSS inline)"
```

---

### Task 4 : Worker de génération PDF (generation-bulletins.worker.js)

**Files:**
- Modify: `backend/src/workers/generation-bulletins.worker.js` (remplace le stub)
- Create: `backend/tests/workers/generation-bulletins.worker.test.js`

- [ ] **Step 1 : Écrire le test du worker**

Créer `backend/tests/workers/generation-bulletins.worker.test.js` :

```js
'use strict';

// Mocks déclarés avant tout require
jest.mock('../../src/infrastructure/database/pool', () => ({
  connectDB: jest.fn().mockResolvedValue(undefined),
  getDB:     jest.fn(),
}));
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis:     jest.fn().mockReturnValue({}),
}));
jest.mock('../../src/infrastructure/storage/r2.service', () => ({
  uploadPDF: jest.fn().mockResolvedValue('https://r2.example.com/bulletins/bul-001.pdf'),
}));
jest.mock('../../src/templates/bulletin.template', () => ({
  genererHTML: jest.fn().mockReturnValue('<html>bulletin</html>'),
}));
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setContent:   jest.fn().mockResolvedValue(undefined),
      pdf:          jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
      close:        jest.fn().mockResolvedValue(undefined),
    }),
    close: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));
jest.mock('bullmq', () => ({ Worker: jest.fn() }));

const { getDB }    = require('../../src/infrastructure/database/pool');
const { uploadPDF } = require('../../src/infrastructure/storage/r2.service');
const { genererHTML } = require('../../src/templates/bulletin.template');
const { traiterJobBulletins } = require('../../src/workers/generation-bulletins.worker');

// Helpers pour créer un mock DB minimal
function mockChain(result) {
  const c = {};
  ['where','join','leftJoin','select','first','update','returning','orderBy'].forEach(m => {
    c[m] = jest.fn().mockReturnValue(c);
  });
  c.then = (resolve) => resolve(result);
  return c;
}

describe('traiterJobBulletins', () => {
  let db;

  beforeEach(() => {
    jest.clearAllMocks();
    db = jest.fn();
    db.raw = jest.fn().mockReturnValue('NOW()');
    getDB.mockReturnValue(db);
  });

  test('génère un PDF et met à jour bulletin_url en DB', async () => {
    const inscription = { id: 'insc-001', eleve_id: 'elv-001' };
    const moyenneGenerale = { id: 'mg-001', inscription_id: 'insc-001' };

    // 1. inscriptions actives de la classe
    db.mockReturnValueOnce(mockChain([inscription]));
    // 2. moyenne_generale pour l'inscription
    db.mockReturnValueOnce(mockChain(moyenneGenerale));
    // 3. données complètes bulletin (élève, établissement, etc.)
    db.mockReturnValueOnce(mockChain({
      id: 'mg-001', inscription_id: 'insc-001', periode_id: 'per-001',
      nom: 'TRAORÉ', prenom: 'Aminata', date_naissance: '2008-03-15',
      genre: 'F', matricule: 'ELV-001', classe: 'Term S1', niveau: 'Terminale',
      trimestre: 1, periode: 'Trimestre 1', annee_scolaire: '2024-2025',
      moyenne_generale: 14.5, rang: 3, rang_sur: 35, mention: 'bien',
      decision_conseil: 'encouragements', appreciation_conseil: 'Bon trimestre',
      nb_absences_justifiees: 2, nb_absences_injustifiees: 1, nb_retards: 0,
      total_points: 290, total_coefficients: 20,
    }));
    // 4. matieres
    db.mockReturnValueOnce(mockChain([
      { matiere: 'Maths', coefficient: 5, moyenne: 14.5, points: 72.5, appreciation_enseignant: 'Bien' },
    ]));
    // 5. conduite
    db.mockReturnValueOnce(mockChain(null));
    // 6. etablissement
    db.mockReturnValueOnce(mockChain({ nom: 'Lycée Delafosse', ville: 'Dakar', logo_url: null }));
    // 7. UPDATE bulletin_url
    db.mockReturnValueOnce(mockChain(1));

    const job = { data: { classe_id: 'cls-001', periode_id: 'per-001', etablissement_id: 'etb-001' } };
    await traiterJobBulletins(job);

    expect(genererHTML).toHaveBeenCalledTimes(1);
    expect(uploadPDF).toHaveBeenCalledTimes(1);

    // Vérifie que l'UPDATE a été appelé (7e appel db)
    expect(db).toHaveBeenCalledTimes(7);
  });

  test('skip proprement un élève sans moyenne_generale', async () => {
    const inscription = { id: 'insc-002', eleve_id: 'elv-002' };

    // 1. inscriptions actives
    db.mockReturnValueOnce(mockChain([inscription]));
    // 2. moyenne_generale = null (pas de moyenne)
    db.mockReturnValueOnce(mockChain(null));

    const job = { data: { classe_id: 'cls-001', periode_id: 'per-001', etablissement_id: 'etb-001' } };
    await traiterJobBulletins(job);

    expect(genererHTML).not.toHaveBeenCalled();
    expect(uploadPDF).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue**

```bash
cd backend
npx jest --testPathPattern="generation-bulletins.worker" --no-coverage --verbose 2>&1
```

Expected : `FAIL` — `traiterJobBulletins is not a function` (stub vide n'exporte rien).

- [ ] **Step 3 : Implémenter le worker**

Remplacer `backend/src/workers/generation-bulletins.worker.js` par :

```js
'use strict';

require('dotenv').config();

const { Worker }  = require('bullmq');
const puppeteer   = require('puppeteer');

const { connectDB, getDB } = require('../infrastructure/database/pool');
const { connectRedis, getRedis } = require('../infrastructure/cache/redis');
const { uploadPDF }  = require('../infrastructure/storage/r2.service');
const { genererHTML } = require('../templates/bulletin.template');
const logger = require('../utils/logger');

/**
 * Traite un job de génération PDF.
 * Exporté séparément pour les tests unitaires.
 *
 * @param {object} job - Job BullMQ avec job.data = { classe_id, periode_id, etablissement_id }
 */
async function traiterJobBulletins(job) {
  const db = getDB();
  const { classe_id, periode_id, etablissement_id } = job.data;

  // 1. Récupérer toutes les inscriptions actives de la classe
  const inscriptions = await db('inscriptions')
    .where({ classe_id, statut: 'actif' })
    .select('id', 'eleve_id');

  logger.info('Génération PDF démarrée', { classe_id, periode_id, nb: inscriptions.length });

  for (const insc of inscriptions) {
    // 2. Vérifier qu'une moyenne existe pour cette inscription
    const mg = await db('moyennes_generales')
      .where({ inscription_id: insc.id, periode_id })
      .first('id', 'inscription_id');

    if (!mg) {
      logger.warn('Pas de moyenne — bulletin ignoré', { inscription_id: insc.id });
      continue;
    }

    try {
      // 3. Fetch toutes les données du bulletin
      const [bulletin, matieres, conduite, etablissement] = await Promise.all([
        db('moyennes_generales as mg')
          .join('inscriptions as i',     'i.id', 'mg.inscription_id')
          .join('eleves as el',          'el.id', 'i.eleve_id')
          .join('utilisateurs as u',     'u.id', 'el.utilisateur_id')
          .join('classes as c',          'c.id', 'i.classe_id')
          .join('niveaux as n',          'n.id', 'c.niveau_id')
          .join('periodes as p',         'p.id', 'mg.periode_id')
          .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
          .where({ 'mg.id': mg.id })
          .first(
            'mg.*',
            'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre',
            'el.matricule',
            db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
            'n.nom as niveau',
            'p.numero as trimestre', 'p.libelle as periode',
            'a.libelle as annee_scolaire'
          ),

        db('moyennes_matieres as mm')
          .join('matieres as m', 'm.id', 'mm.matiere_id')
          .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
          .where({ 'mm.inscription_id': insc.id, 'mm.periode_id': periode_id })
          .orderBy(['dm.ordre', 'm.nom'])
          .select(
            'm.nom as matiere', 'm.code as matiere_code',
            'dm.nom as discipline',
            'mm.moyenne', 'mm.coefficient', 'mm.points',
            'mm.appreciation_enseignant', 'mm.est_complete'
          ),

        db('notes_conduite')
          .where({ inscription_id: insc.id, periode_id })
          .first('valeur', 'appreciation'),

        db('etablissements')
          .where({ id: etablissement_id })
          .first('nom', 'code_officiel', 'ville', 'telephone', 'logo_url'),
      ]);

      // 4. Générer le HTML
      const html = genererHTML({
        etablissement,
        eleve: {
          nom: bulletin.nom, prenom: bulletin.prenom,
          date_naissance: bulletin.date_naissance, genre: bulletin.genre,
          matricule: bulletin.matricule, classe: bulletin.classe, niveau: bulletin.niveau,
        },
        periode: {
          trimestre: bulletin.trimestre,
          libelle: bulletin.periode,
          annee_scolaire: bulletin.annee_scolaire,
        },
        matieres,
        conduite: conduite || null,
        resultat: {
          total_points: bulletin.total_points,
          total_coefficients: bulletin.total_coefficients,
          moyenne_generale: bulletin.moyenne_generale,
          rang: bulletin.rang,
          rang_sur: bulletin.rang_sur,
          mention: bulletin.mention,
          decision_conseil: bulletin.decision_conseil,
          appreciation_conseil: bulletin.appreciation_conseil,
        },
        absences: {
          justifiees: bulletin.nb_absences_justifiees || 0,
          injustifiees: bulletin.nb_absences_injustifiees || 0,
          retards: bulletin.nb_retards || 0,
        },
      });

      // 5. Puppeteer : HTML → PDF buffer
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      await page.close();
      await browser.close();

      // 6. Upload R2
      const key = `bulletins/${etablissement_id}/${periode_id}/${mg.id}.pdf`;
      const url  = await uploadPDF(pdfBuffer, key);

      // 7. Mettre à jour bulletin_url en DB
      await db('moyennes_generales')
        .where({ id: mg.id })
        .update({ bulletin_url: url, updated_at: db.raw('NOW()') });

      logger.info('PDF généré et uploadé', { mg_id: mg.id, url });

    } catch (err) {
      logger.error('Erreur génération PDF pour inscription', {
        inscription_id: insc.id, error: err.message,
      });
      // Ne pas throw — continue avec l'élève suivant
      // BullMQ retry gérera les échecs globaux du job
    }
  }

  logger.info('Génération PDF terminée', { classe_id, periode_id });
}

// ── Démarrage du worker (hors tests) ──────────────────────────────
async function init() {
  await connectDB();
  await connectRedis();
}

// N'exécuter que si lancé directement (pas lors des tests)
if (require.main === module) {
  init().then(() => {
    const worker = new Worker('generation-bulletins', traiterJobBulletins, {
      connection:  getRedis(),
      concurrency: 1,  // Puppeteer est lourd — une instance à la fois
    });

    worker.on('completed', (job) =>
      logger.info('Job bulletins terminé', { jobId: job.id })
    );
    worker.on('failed', (job, err) =>
      logger.error('Job bulletins échoué', { jobId: job?.id, error: err.message })
    );

    logger.info('Worker generation-bulletins démarré');
  });
}

module.exports = { traiterJobBulletins };
```

- [ ] **Step 4 : Vérifier que les tests passent**

```bash
cd backend
npx jest --testPathPattern="generation-bulletins.worker" --no-coverage --verbose 2>&1
```

Expected : `PASS` — 2 tests passent.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/workers/generation-bulletins.worker.js \
        backend/tests/workers/generation-bulletins.worker.test.js
git commit -m "feat: worker génération PDF bulletins (Puppeteer + R2)"
```

---

## Chunk 3 : Modifications routes + tests complets

### Task 5 : Modifier bulletins.routes.js

**Files:**
- Modify: `backend/src/domains/03-pedagogie/bulletins/bulletins.routes.js`
- Modify: `backend/tests/domains/bulletins.routes.test.js`

- [ ] **Step 1 : Écrire les nouveaux cas de test**

Ajouter dans `backend/tests/domains/bulletins.routes.test.js`, **après** les imports existants et dans le bloc `describe` existant :

Dans le mock BullMQ en haut du fichier, vérifier que `enqueuerGenerationBulletins` est déjà mocké (c'est le cas : `.mockResolvedValue({ id: 'job-001' })`).

Ajouter après `describe('PUT /bulletins/:id/valider', ...)` :

```js
  // ── POST /bulletins/generer — enqueue BullMQ ────────────────────
  describe('POST /bulletins/generer — enqueue BullMQ', () => {
    test('appelle enqueuerGenerationBulletins après la transaction', async () => {
      const { enqueuerGenerationBulletins } = require('../../src/infrastructure/queue/bullmq');

      db.mockReturnValueOnce(mockQuery({ id: IDS.classe, classe: 'Term S1' }));
      db.mockReturnValueOnce(mockQuery([{ id: 'mg-1', inscription_id: IDS.inscription }]));
      db.transaction.mockImplementation(async (fn) => {
        const trx = jest.fn()
          .mockReturnValueOnce(mockQuery(null))
          .mockReturnValueOnce(mockQuery(1));
        trx.raw = jest.fn().mockReturnValue('NOW()');
        await fn(trx);
      });

      await request(app)
        .post('/bulletins/generer')
        .send({ classe_id: IDS.classe, periode_id: IDS.periode })
        .expect(201);

      expect(enqueuerGenerationBulletins).toHaveBeenCalledWith({
        classe_id:        IDS.classe,
        periode_id:       IDS.periode,
        etablissement_id: expect.any(String),
      });
    });
  });

  // ── GET /bulletins/:id/download — messages d'erreur ─────────────
  describe('GET /bulletins/:id/download — messages erreur', () => {
    test('retourne 404 avec message "en cours de génération" si url null', async () => {
      db.mockReturnValueOnce(mockQuery({
        bulletin_url: null,
        valide_at: '2025-01-21T14:00:00Z',
        bulletin_genere: true,
      }));

      const res = await request(app)
        .get(`/bulletins/${bulletin.id}/download`)
        .expect(404);

      expect(res.body.message || res.body.error).toMatch(/cours de génération/i);
    });
  });
```

- [ ] **Step 2 : Vérifier que les nouveaux tests échouent**

```bash
cd backend
npx jest --testPathPattern="bulletins.routes" --no-coverage --verbose 2>&1
```

Expected : les 7 tests existants passent, les 2 nouveaux échouent.

- [ ] **Step 3 : Modifier bulletins.routes.js**

**Modification 1** — Ajouter l'import BullMQ en haut de `bulletins.routes.js` (après les imports existants) :

```js
const { enqueuerGenerationBulletins } = require('../../../infrastructure/queue/bullmq');
```

**Modification 2** — Dans `POST /bulletins/generer`, ajouter l'enqueue juste après le `await db.transaction(...)` et avant le `return cree(...)` :

```js
      // Enqueue job BullMQ pour génération PDF asynchrone
      await enqueuerGenerationBulletins({
        classe_id,
        periode_id,
        etablissement_id: req.etablissement_id,
      });
```

**Modification 3** — Dans `GET /bulletins/:id/download`, remplacer le message du 404 `bulletin_url` null :

Remplacer :
```js
    if (!bulletin.bulletin_url) throw ApiError.nonTrouve('Le fichier PDF n\'est pas encore disponible');
```

Par :
```js
    if (!bulletin.bulletin_url) throw ApiError.nonTrouve('PDF en cours de génération, veuillez réessayer dans quelques instants');
```

- [ ] **Step 4 : Vérifier que tous les tests passent**

```bash
cd backend
npx jest --testPathPattern="bulletins.routes" --no-coverage --verbose 2>&1
```

Expected : `PASS` — 9 tests passent.

- [ ] **Step 5 : Commit**

```bash
git add backend/src/domains/03-pedagogie/bulletins/bulletins.routes.js \
        backend/tests/domains/bulletins.routes.test.js
git commit -m "feat: bulletins/generer enqueue BullMQ PDF + message download amélioré"
```

---

### Task 6 : Suite de tests complète + vérification finale

**Files:**
- No new files

- [ ] **Step 1 : Lancer toute la suite de tests**

```bash
cd backend
npx jest --no-coverage --verbose 2>&1
```

Expected : tous les tests passent (60 existants + nouveaux).

- [ ] **Step 2 : Vérifier le lint**

```bash
cd backend
npm run lint 2>&1
```

Expected : 0 erreur, <50 warnings.

- [ ] **Step 3 : Test manuel du template (sans Docker)**

```bash
cd backend
node -e "
const { genererHTML } = require('./src/templates/bulletin.template');
const html = genererHTML({
  etablissement: { nom: 'Test École', ville: 'Dakar', telephone: '+221 77 000 00 00', logo_url: null },
  eleve: { nom: 'DIALLO', prenom: 'Oumar', matricule: 'ELV-001', classe: 'Term S1', niveau: 'Terminale', date_naissance: '2007-01-01', genre: 'M' },
  periode: { trimestre: 1, libelle: 'Trimestre 1', annee_scolaire: '2024-2025' },
  matieres: [{ matiere: 'Mathématiques', coefficient: 5, moyenne: 15.5, points: 77.5, appreciation_enseignant: 'Excellent travail', discipline: 'Sciences' }],
  conduite: { valeur: 18, appreciation: 'Très bien' },
  resultat: { moyenne_generale: 15.5, rang: 1, rang_sur: 40, mention: 'bien', decision_conseil: 'encouragements', appreciation_conseil: 'Excellent trimestre', total_points: 310, total_coefficients: 20 },
  absences: { justifiees: 0, injustifiees: 0, retards: 1 },
});
require('fs').writeFileSync('/tmp/bulletin-test.html', html);
console.log('HTML écrit dans /tmp/bulletin-test.html');
"
```

Ouvrir `/tmp/bulletin-test.html` dans un navigateur pour valider le rendu visuel.

- [ ] **Step 4 : Commit final**

```bash
git add -A
git commit -m "feat: génération PDF bulletins — implémentation complète (R2 + Puppeteer + BullMQ)"
```

---

## Variables d'environnement à configurer (prod)

Ajouter dans `backend/.env` :

```env
R2_ACCOUNT_ID=<votre_account_id_cloudflare>
R2_ACCESS_KEY_ID=<clé_access_R2>
R2_SECRET_ACCESS_KEY=<clé_secrète_R2>
R2_BUCKET_NAME=ecolemanager-bulletins
R2_PUBLIC_URL=https://bulletins.<votre-domaine>.com
```

En dev, ces variables peuvent rester vides — le service écrit les PDFs dans `/tmp/bulletins/`.
