# Notifications in-app Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une cloche 🔔 interactive dans les 3 portails dashboard (admin, enseignant, parent) qui affiche un drawer latéral avec les alertes agrégées en temps réel (polling 60s).

**Architecture:** Un endpoint `GET /notifications` agrège les données existantes (pas de nouvelle table) selon le rôle. Un module ES5 `notifs.js` partage le polling et le drawer entre les 3 portails. Le `.tb-notif` existant devient cliquable.

**Tech Stack:** Node.js/Express/Knex (backend), HTML/CSS/JS ES5 vanilla (dashboard)

---

## Contexte codebase — à lire avant de commencer

### Patterns existants à suivre

**Backend :**
- Pattern route : `const auth = authentifier; const isoler = isolerEtablissement; const perm = exigerPermission;`
- Réponse succès : `return ok(res, donnees);` — import depuis `../utils/reponse`
- Erreurs : `throw ApiError.nonTrouve('msg')` — capturées par `error.middleware.js`
- DB : `const db = getDB();` — import depuis `../infrastructure/database/pool`

**Dashboard :**
- **ES5 STRICT** — `var` uniquement, pas d'arrow functions, pas de `const`/`let`, pas de template literals
- Pattern objet page : `var MonModule = { init: function() {}, _helper: function() {} };`
- API client : `Api.get('/route').then(function(res){ ... }).catch(function(err){ ... })`
- Pattern drawer existant (à copier) : `#edt-drawer` + `#edt-overlay` dans `enseignant.html` et `css/style.css`

**HTML existant :**
Les 3 portails ont déjà ce placeholder dans le header (`<header class="topbar">`) :
```html
<div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
```
Ce `div` devient cliquable — on ajoute `onclick="Notifs.toggle()"` et on remplace `.notif-dot` par `#notif-badge`.

### Tables SQL utilisées (données déjà en base)

| Type notif | Table | Colonnes clés |
|------------|-------|---------------|
| Appels manqués | `emplois_du_temps` LEFT JOIN `appels` | `appels.id IS NULL`, dates passées 7j |
| Absences injustifiées | `presences` | `statut='absent'`, `est_justifie=false` |
| Notes publiées | `evaluations` | `notes_publiees=true`, `date_evaluation` |
| Bulletins disponibles | `moyennes_generales` | `bulletin_genere=true` |
| Incidents discipline | `incidents_discipline` | `created_at`, `statut != 'clos'` |

---

## Fichiers créés / modifiés

| Action | Fichier | Rôle |
|--------|---------|------|
| **Créer** | `backend/src/domains/notifications.routes.js` | `GET /notifications` |
| **Modifier** | `backend/src/app.js` | Monter le router |
| **Créer** | `backend/tests/integration/notifications.integration.test.js` | Tests intégration |
| **Créer** | `dashboard/js/notifs.js` | Module ES5 polling + drawer |
| **Modifier** | `dashboard/css/style.css` | Styles drawer + badge |
| **Modifier** | `dashboard/index.html` | Wiring (3 lignes header + drawer HTML + script) |
| **Modifier** | `dashboard/enseignant.html` | Idem |
| **Modifier** | `dashboard/parent.html` | Idem |

---

## Chunk 1 : Backend `GET /notifications`

### Task 1 : Route notifications backend

**Files:**
- Create: `backend/src/domains/notifications.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1 : Créer `backend/src/domains/notifications.routes.js`**

```javascript
'use strict';

const express = require('express');
const { getDB }    = require('../infrastructure/database/pool');
const { authentifier }                        = require('../middleware/auth.middleware');
const { isolerEtablissement }                 = require('../middleware/permission.middleware');
const { ok }       = require('../utils/reponse');

const router = express.Router();
const auth   = authentifier;
const isoler = isolerEtablissement;

// ── Helpers ────────────────────────────────────────────────────

var FENETRE_JOURS = 7;
var MAX_ITEMS     = 10;

async function notifsAdmin(db, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  // 1. Appels manqués : créneaux passés sans appel (7 derniers jours)
  var appelsManques = await db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .leftJoin('appels as ap', function() {
      this.on('ap.emploi_du_temps_id', '=', 'edt.id')
          .andOnVal('ap.statut', '!=', 'annule');
    })
    .where('ae.etablissement_id', etablissementId)
    .where('edt.date_debut', '>=', depuisISO)
    .where('edt.date_debut', '<', db.raw('CURRENT_DATE'))
    .whereNull('ap.id')
    .limit(MAX_ITEMS)
    .select(
      'cl.nom as classe',
      'm.nom as matiere',
      'edt.date_debut as date',
      'edt.heure_debut as heure'
    );

  // 2. Absences injustifiées (7 derniers jours)
  var absences = await db('presences as p')
    .join('appels as ap', 'ap.id', 'p.appel_id')
    .join('inscriptions as i', 'i.id', 'p.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .where('ap.etablissement_id', etablissementId)
    .where('p.statut', 'absent')
    .where('p.est_justifie', false)
    .where('ap.date', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'ap.date as date'
    );

  // 3. Notes publiées (7 derniers jours)
  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .where('ae.etablissement_id', etablissementId)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'cl.nom as classe', 'ev.date_evaluation as date');

  // 4. Bulletins disponibles (7 derniers jours)
  var bulletins = await db('moyennes_generales as mg')
    .join('inscriptions as i', 'i.id', 'mg.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .join('periodes as per', 'per.id', 'mg.periode_id')
    .join('annees_scolaires as an', 'an.id', 'per.annee_scolaire_id')
    .where('an.etablissement_id', etablissementId)
    .where('mg.bulletin_genere', true)
    .where('mg.updated_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'per.nom as periode'
    );

  // 5. Incidents discipline (7 derniers jours)
  var incidents = await db('incidents_discipline as id')
    .join('inscriptions as i', 'i.id', 'id.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .join('annees_scolaires as an', 'an.id', function() {
      this.on(db.raw("an.id = (SELECT annee_scolaire_id FROM classes WHERE id = i.classe_id)"));
    })
    .where('an.etablissement_id', etablissementId)
    .where('id.statut', '!=', 'clos')
    .where('id.created_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'cl.nom as classe',
      'id.type',
      'id.gravite',
      db.raw("id.created_at::date as date")
    );

  return { appelsManques, absences, notes, bulletins, incidents };
}

async function notifsEnseignant(db, utilisateurId, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  // Trouver l'enseignant
  var enseignant = await db('enseignants')
    .where({ utilisateur_id: utilisateurId, etablissement_id: etablissementId })
    .first('id');
  if (!enseignant) return { appelsManques: [], notes: [] };

  // Appels manqués de SES cours
  var appelsManques = await db('emplois_du_temps as edt')
    .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .leftJoin('appels as ap', function() {
      this.on('ap.emploi_du_temps_id', '=', 'edt.id')
          .andOnVal('ap.statut', '!=', 'annule');
    })
    .where('ae.enseignant_id', enseignant.id)
    .where('edt.date_debut', '>=', depuisISO)
    .where('edt.date_debut', '<', db.raw('CURRENT_DATE'))
    .whereNull('ap.id')
    .limit(MAX_ITEMS)
    .select('cl.nom as classe', 'm.nom as matiere', 'edt.date_debut as date', 'edt.heure_debut as heure');

  // Ses notes récemment publiées
  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .where('ae.enseignant_id', enseignant.id)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'cl.nom as classe', 'ev.date_evaluation as date');

  return { appelsManques, notes };
}

async function notifsParent(db, utilisateurId, etablissementId) {
  var depuis = new Date();
  depuis.setDate(depuis.getDate() - FENETRE_JOURS);
  var depuisISO = depuis.toISOString().split('T')[0];

  // Trouver le parent et ses enfants
  var parent = await db('parents_eleves as pe')
    .join('eleves as el', 'el.id', 'pe.eleve_id')
    .join('inscriptions as i', function() {
      this.on('i.eleve_id', '=', 'el.id').andOn(function() {
        this.on('i.statut', db.raw("'actif'"));
      });
    })
    .join('annees_scolaires as an', 'an.id', 'i.annee_scolaire_id')
    .where('pe.parent_id', utilisateurId)
    .where('an.etablissement_id', etablissementId)
    .where('an.est_courante', true)
    .select('i.id as inscription_id', 'el.id as eleve_id');

  if (!parent.length) return { absences: [], notes: [], bulletins: [], incidents: [] };

  var inscriptionIds = parent.map(function(r) { return r.inscription_id; });

  // Absences injustifiées de ses enfants
  var absences = await db('presences as p')
    .join('appels as ap', 'ap.id', 'p.appel_id')
    .join('inscriptions as i', 'i.id', 'p.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .join('classes as cl', 'cl.id', 'i.classe_id')
    .whereIn('p.inscription_id', inscriptionIds)
    .where('p.statut', 'absent')
    .where('p.est_justifie', false)
    .where('ap.date', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"), 'cl.nom as classe', 'ap.date as date');

  // Notes publiées pour ses enfants
  var notes = await db('evaluations as ev')
    .join('affectations_enseignants as ae', 'ae.id', 'ev.affectation_id')
    .join('disciplines_matieres as dm', 'dm.affectation_id', 'ae.id')
    .join('matieres as m', 'm.id', 'dm.matiere_id')
    .join('classes as cl', 'cl.id', 'ae.classe_id')
    .join('inscriptions as i', 'i.classe_id', 'ae.classe_id')
    .whereIn('i.id', inscriptionIds)
    .where('ev.notes_publiees', true)
    .where('ev.date_evaluation', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('m.nom as matiere', 'cl.nom as classe', 'ev.date_evaluation as date');

  // Bulletins disponibles
  var bulletins = await db('moyennes_generales as mg')
    .join('periodes as per', 'per.id', 'mg.periode_id')
    .whereIn('mg.inscription_id', inscriptionIds)
    .where('mg.bulletin_genere', true)
    .where('mg.updated_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select('per.nom as periode', 'mg.updated_at as date');

  // Incidents discipline
  var incidents = await db('incidents_discipline as inc')
    .join('inscriptions as i', 'i.id', 'inc.inscription_id')
    .join('eleves as el', 'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'el.utilisateur_id')
    .whereIn('inc.inscription_id', inscriptionIds)
    .where('inc.statut', '!=', 'clos')
    .where('inc.created_at', '>=', depuisISO)
    .limit(MAX_ITEMS)
    .select(
      db.raw("CONCAT(u.prenom, ' ', u.nom) as eleve"),
      'inc.type',
      'inc.gravite',
      db.raw("inc.created_at::date as date")
    );

  return { absences, notes, bulletins, incidents };
}

// ── Route ──────────────────────────────────────────────────────

router.get('/notifications', auth, isoler, async function(req, res, next) {
  var db     = getDB();
  var userId = req.session.utilisateur_id;
  var etabId = req.etablissement_id;
  var role   = req.session.role;

  try {
    var raw;
    if (role === 'parent') {
      raw = await notifsParent(db, userId, etabId);
    } else if (role === 'enseignant') {
      raw = await notifsEnseignant(db, userId, etabId);
    } else {
      // admin, directeur, censeur, etc.
      raw = await notifsAdmin(db, etabId);
    }

    // Construire les catégories
    var categories = [];

    function ajouterCategorie(type, label, items) {
      categories.push({ type: type, label: label, count: items.length, items: items });
    }

    if (raw.appelsManques)  ajouterCategorie('appels_manques',        'Appels non effectués',    raw.appelsManques);
    if (raw.absences)       ajouterCategorie('absences_injustifiees', 'Absences injustifiées',   raw.absences);
    if (raw.notes)          ajouterCategorie('notes_publiees',        'Notes publiées',          raw.notes);
    if (raw.bulletins)      ajouterCategorie('bulletins_disponibles', 'Bulletins disponibles',   raw.bulletins);
    if (raw.incidents)      ajouterCategorie('incidents_discipline',  'Incidents disciplinaires', raw.incidents);

    var total = categories.reduce(function(sum, c) { return sum + c.count; }, 0);

    return ok(res, { total: total, categories: categories });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
```

- [ ] **Step 2 : Monter le router dans `backend/src/app.js`**

Trouver la section `// ── Domaines ───` et ajouter après les imports existants :

```javascript
const notificationsRouter  = require('./domains/notifications.routes');
```

Trouver la section de montage des routes (où sont les `app.use('/api/v1', ...)`) et ajouter :

```javascript
app.use('/api/v1', notificationsRouter);
```

- [ ] **Step 3 : Commit**

```bash
cd backend && git add src/domains/notifications.routes.js src/app.js
git commit -m "feat(backend): GET /notifications — agrégat 5 types, filtrage par rôle"
```

---

### Task 2 : Test d'intégration `GET /notifications`

**Files:**
- Create: `backend/tests/integration/notifications.integration.test.js`

- [ ] **Step 1 : Écrire le test**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenDir;

beforeAll(async () => {
  app     = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed    = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
});

afterAll(async () => { await closeTestDB(); });

describe('GET /notifications', () => {
  it('200 — retourne la structure attendue pour un admin', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Cookie', 'token=' + tokenDir);

    expect(res.status).toBe(200);
    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('total');
    expect(res.body.data).toHaveProperty('categories');
    expect(Array.isArray(res.body.data.categories)).toBe(true);
  });

  it('401 — sans token', async () => {
    const res = await request.get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  it('chaque catégorie a type, label, count, items', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Cookie', 'token=' + tokenDir);

    res.body.data.categories.forEach(cat => {
      expect(cat).toHaveProperty('type');
      expect(cat).toHaveProperty('label');
      expect(cat).toHaveProperty('count');
      expect(cat).toHaveProperty('items');
      expect(Array.isArray(cat.items)).toBe(true);
      expect(cat.count).toBe(cat.items.length);
    });
  });

  it('total = somme des counts', async () => {
    const res = await request
      .get('/api/v1/notifications')
      .set('Cookie', 'token=' + tokenDir);

    const { total, categories } = res.body.data;
    const sommeCounts = categories.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(sommeCounts);
  });
});
```

- [ ] **Step 2 : Lancer les tests**

```bash
cd backend
POSTGRES_PORT=5433 npx jest --config tests/integration/jest.integration.config.js \
  tests/integration/notifications.integration.test.js --verbose
```

Expected: 4 tests PASS

- [ ] **Step 3 : Commit**

```bash
git add tests/integration/notifications.integration.test.js
git commit -m "test(integration): notifications — 4 tests GET /notifications"
```

---

## Chunk 2 : CSS + Module JS frontend

### Task 3 : Styles CSS notification drawer

**Files:**
- Modify: `dashboard/css/style.css`

- [ ] **Step 1 : Ajouter les styles à la fin de `dashboard/css/style.css`**

```css
/* ── Notifications drawer ──────────────────────────────────────── */
#notif-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:199}
#notif-overlay.show{display:block}
#notif-drawer{position:fixed;top:0;right:0;height:100vh;width:380px;max-width:100vw;background:var(--blanc);z-index:200;transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column;box-shadow:-4px 0 24px rgba(0,0,0,.15)}
#notif-drawer.open{transform:translateX(0)}
#notif-drawer-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--vert);color:#fff}
#notif-drawer-header span{font-weight:700;font-size:15px}
#notif-drawer-close{background:none;border:none;color:#fff;font-size:20px;cursor:pointer;padding:0;line-height:1}
#notif-drawer-body{flex:1;overflow-y:auto;padding:0}
.notif-section{border-bottom:1px solid var(--g100)}
.notif-section-header{display:flex;align-items:center;gap:8px;padding:12px 16px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--g500)}
.notif-section-header .notif-count{background:var(--rouge);color:#fff;border-radius:10px;padding:1px 6px;font-size:10px}
.notif-item{padding:8px 16px;font-size:13px;color:var(--g700);border-bottom:1px solid var(--g50)}
.notif-item:last-child{border-bottom:none}
.notif-item strong{color:var(--g900);font-weight:600}
.notif-item .notif-meta{font-size:11px;color:var(--g400);margin-top:2px}
.notif-empty{padding:32px 16px;text-align:center;color:var(--g400);font-size:13px}
/* Badge cloche */
.tb-notif{cursor:pointer}
#notif-badge{display:none;position:absolute;top:4px;right:4px;background:var(--rouge);color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;font-weight:700;align-items:center;justify-content:center;border:2px solid var(--blanc)}
#notif-badge.visible{display:flex}
@media(max-width:480px){#notif-drawer{width:100vw}}
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/css/style.css
git commit -m "feat(css): styles notification drawer + badge"
```

---

### Task 4 : Module `dashboard/js/notifs.js`

**Files:**
- Create: `dashboard/js/notifs.js`

- [ ] **Step 1 : Créer `dashboard/js/notifs.js`**

```javascript
'use strict';

/* ── Notifs — module notifications in-app ──────────────────────
 * Partagé entre les 3 portails (index.html, enseignant.html, parent.html)
 * Polling toutes les 60s. Drawer latéral.
 * ES5 strict — pas d'arrow functions, pas de const/let.
 * ─────────────────────────────────────────────────────────────── */

var Notifs = {
  _timer:   null,
  _data:    null,
  _ouvert:  false,

  // ── Labels par type ────────────────────────────────────────
  _labels: {
    appels_manques:        { icone: '⚠️',  label: 'Appels non effectués'  },
    absences_injustifiees: { icone: '🚨',  label: 'Absences injustifiées' },
    notes_publiees:        { icone: '📝',  label: 'Notes publiées'        },
    bulletins_disponibles: { icone: '📄',  label: 'Bulletins disponibles' },
    incidents_discipline:  { icone: '🔴',  label: 'Incidents discipl.'    },
  },

  // ── Init : appelé une fois au chargement de la page ────────
  init: function() {
    Notifs._charger();
    Notifs._timer = setInterval(Notifs._charger, 60000);

    // Fermer le drawer avec Échap
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && Notifs._ouvert) Notifs.fermer();
    });
  },

  // ── Chargement depuis l'API ────────────────────────────────
  _charger: function() {
    Api.get('/notifications').then(function(res) {
      Notifs._data = res.data;
      Notifs._updateBadge(res.data.total);
      // Si drawer ouvert, rafraîchir le contenu
      if (Notifs._ouvert) Notifs._renderDrawer();
    }).catch(function() {
      // Silencieux — pas de notification si offline
    });
  },

  // ── Badge ──────────────────────────────────────────────────
  _updateBadge: function(count) {
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    if (count > 0) {
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  },

  // ── Toggle drawer ──────────────────────────────────────────
  toggle: function() {
    if (Notifs._ouvert) {
      Notifs.fermer();
    } else {
      Notifs.ouvrir();
    }
  },

  ouvrir: function() {
    var drawer  = document.getElementById('notif-drawer');
    var overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    Notifs._renderDrawer();
    drawer.classList.add('open');
    overlay.classList.add('show');
    Notifs._ouvert = true;
  },

  fermer: function() {
    var drawer  = document.getElementById('notif-drawer');
    var overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    drawer.classList.remove('open');
    overlay.classList.remove('show');
    Notifs._ouvert = false;
  },

  // ── Rendu du contenu du drawer ─────────────────────────────
  _renderDrawer: function() {
    var body = document.getElementById('notif-drawer-body');
    if (!body) return;

    if (!Notifs._data) {
      body.innerHTML = '<div class="notif-empty">Chargement…</div>';
      return;
    }

    var categories = Notifs._data.categories;
    var nonVides   = categories.filter(function(c) { return c.count > 0; });

    if (!nonVides.length) {
      body.innerHTML = '<div class="notif-empty">✅ Tout est en ordre — aucune alerte</div>';
      return;
    }

    var parts = [];
    nonVides.forEach(function(cat) {
      var meta = Notifs._labels[cat.type] || { icone: '•', label: cat.label };
      parts.push('<div class="notif-section">');
      parts.push(
        '<div class="notif-section-header">' +
        meta.icone + ' ' + meta.label +
        ' <span class="notif-count">' + cat.count + '</span>' +
        '</div>'
      );
      cat.items.forEach(function(item) {
        parts.push('<div class="notif-item">');
        parts.push(Notifs._renderItem(cat.type, item));
        parts.push('</div>');
      });
      parts.push('</div>');
    });

    body.innerHTML = parts.join('');
  },

  // ── Rendu d'un item selon le type ─────────────────────────
  _renderItem: function(type, item) {
    switch (type) {
      case 'appels_manques':
        return '<strong>' + (item.matiere || '—') + '</strong> · ' + (item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + (item.heure ? ' · ' + item.heure : '') + '</div>';

      case 'absences_injustifiees':
        return '<strong>' + (item.eleve || '—') + '</strong> · ' + (item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + '</div>';

      case 'notes_publiees':
        return '<strong>' + (item.matiere || '—') + '</strong> · ' + (item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + '</div>';

      case 'bulletins_disponibles':
        return '<strong>' + (item.eleve || item.periode || '—') + '</strong>' +
               '<div class="notif-meta">' + (item.periode || '') + ' · ' + Notifs._fmtDate(item.date) + '</div>';

      case 'incidents_discipline':
        return '<strong>' + (item.eleve || '—') + '</strong> · ' +
               '<span style="color:var(--rouge)">' + (item.gravite || '') + '</span>' +
               '<div class="notif-meta">' + (item.type || '') + ' · ' + Notifs._fmtDate(item.date) + '</div>';

      default:
        return JSON.stringify(item);
    }
  },

  // ── Formatage date DD/MM ───────────────────────────────────
  _fmtDate: function(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  },
};
```

- [ ] **Step 2 : Commit**

```bash
git add dashboard/js/notifs.js
git commit -m "feat(dashboard): notifs.js — module ES5 polling + drawer notifications"
```

---

## Chunk 3 : Wiring HTML dans les 3 portails

### Task 5 : index.html (portail admin)

**Files:**
- Modify: `dashboard/index.html`

- [ ] **Step 1 : Mettre à jour `.tb-notif` dans le header**

Trouver :
```html
<div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
```

Remplacer par :
```html
<div class="tb-notif" title="Notifications" onclick="Notifs.toggle()" style="position:relative">🔔<span id="notif-badge"></span></div>
```

- [ ] **Step 2 : Ajouter le drawer juste avant `</body>`**

```html
<div id="notif-overlay" onclick="Notifs.fermer()"></div>
<div id="notif-drawer">
  <div id="notif-drawer-header">
    <span>🔔 Notifications</span>
    <button id="notif-drawer-close" onclick="Notifs.fermer()">✕</button>
  </div>
  <div id="notif-drawer-body"></div>
</div>
<script src="js/notifs.js"></script>
```

- [ ] **Step 3 : Appeler `Notifs.init()` dans `app.js`**

Dans `dashboard/js/app.js`, trouver l'initialisation principale (fonction appelée au `DOMContentLoaded`) et ajouter :
```javascript
Notifs.init();
```

- [ ] **Step 4 : Commit**

```bash
git add dashboard/index.html dashboard/js/app.js
git commit -m "feat(dashboard): notifications wiring portail admin"
```

---

### Task 6 : enseignant.html (portail enseignant)

**Files:**
- Modify: `dashboard/enseignant.html`
- Modify: `dashboard/js/ens-app.js`

- [ ] **Step 1 : Mettre à jour `.tb-notif` dans le header**

Trouver (ligne ~41) :
```html
<div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
```

Remplacer par :
```html
<div class="tb-notif" title="Notifications" onclick="Notifs.toggle()" style="position:relative">🔔<span id="notif-badge"></span></div>
```

- [ ] **Step 2 : Ajouter le drawer juste avant `</body>` (après `#edt-drawer` existant)**

```html
<div id="notif-overlay" onclick="Notifs.fermer()"></div>
<div id="notif-drawer">
  <div id="notif-drawer-header">
    <span>🔔 Notifications</span>
    <button id="notif-drawer-close" onclick="Notifs.fermer()">✕</button>
  </div>
  <div id="notif-drawer-body"></div>
</div>
<script src="js/notifs.js"></script>
```

- [ ] **Step 3 : Appeler `Notifs.init()` dans `ens-app.js`**

Dans `dashboard/js/ens-app.js`, trouver la fonction d'initialisation et ajouter :
```javascript
Notifs.init();
```

- [ ] **Step 4 : Commit**

```bash
git add dashboard/enseignant.html dashboard/js/ens-app.js
git commit -m "feat(dashboard): notifications wiring portail enseignant"
```

---

### Task 7 : parent.html (portail parent)

**Files:**
- Modify: `dashboard/parent.html`
- Modify: `dashboard/js/par-app.js`

- [ ] **Step 1 : Mettre à jour `.tb-notif` dans le header**

Trouver (ligne ~47) :
```html
<div class="tb-notif" title="Notifications">🔔<span class="notif-dot"></span></div>
```

Remplacer par :
```html
<div class="tb-notif" title="Notifications" onclick="Notifs.toggle()" style="position:relative">🔔<span id="notif-badge"></span></div>
```

- [ ] **Step 2 : Ajouter le drawer juste avant `</body>`**

```html
<div id="notif-overlay" onclick="Notifs.fermer()"></div>
<div id="notif-drawer">
  <div id="notif-drawer-header">
    <span>🔔 Notifications</span>
    <button id="notif-drawer-close" onclick="Notifs.fermer()">✕</button>
  </div>
  <div id="notif-drawer-body"></div>
</div>
<script src="js/notifs.js"></script>
```

- [ ] **Step 3 : Appeler `Notifs.init()` dans `par-app.js`**

Dans `dashboard/js/par-app.js`, trouver la fonction d'initialisation et ajouter :
```javascript
Notifs.init();
```

- [ ] **Step 4 : Commit**

```bash
git add dashboard/parent.html dashboard/js/par-app.js
git commit -m "feat(dashboard): notifications wiring portail parent"
```
