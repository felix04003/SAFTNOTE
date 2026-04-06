# Documentation & Organisation du code — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Créer une documentation complète et navigable du projet EcoleManager — INDEX central, CHANGELOG versionné, 4 docs architecture, 5 docs feature.

**Architecture:** 11 fichiers Markdown dans `docs/` organisés par type (architecture/, features/) avec un INDEX.md comme point d'entrée unique. Les specs/plans existants dans `docs/superpowers/` ne sont pas modifiés, juste référencés.

**Tech Stack:** Markdown, Git

---

## Chunk 1 : INDEX.md + CHANGELOG.md

### Task 1 : Créer l'index central

**Files:**
- Create: `docs/INDEX.md`

- [ ] **Step 1 : Créer `docs/INDEX.md`**

```markdown
# EcoleManager — Index de la documentation

> Point d'entrée unique. Tous les liens vers la doc technique.

---

## Navigation rapide

| Document | Description |
|----------|-------------|
| [CHANGELOG](CHANGELOG.md) | Historique des versions et features |
| [Vue d'ensemble](architecture/overview.md) | Stack, décisions clés, schéma global |
| [Backend](architecture/backend.md) | Domaines API, middlewares, patterns |
| [Dashboard](architecture/dashboard.md) | 3 portails, routing hash, conventions JS |
| [Base de données](architecture/database.md) | Schéma SQL, migrations, conventions |

---

## Features

| # | Feature | Version | Sprint | Statut |
|---|---------|---------|--------|--------|
| 1 | [Affectations](features/01-affectations.md) | v0.1.0 | 2026-03-19 | ✅ Livré |
| 2 | [Portail Enseignant](features/02-portail-enseignant.md) | v0.2.0 | 2026-03-21 | ✅ Livré |
| 3 | [Tests, Cache & Monitoring](features/03-tests-cache-monitoring.md) | v0.3.0 | 2026-03-22 | ✅ Livré |
| 4 | [Portail Parents](features/04-portail-parents.md) | v0.4.0 | 2026-03-29 | ✅ Livré |
| 5 | [EDT Enseignant](features/05-edt-enseignant.md) | v0.5.0 | 2026-03-30 | ✅ Livré |

---

## Specs & Plans détaillés

Les specs de design et plans d'implémentation complets sont dans :
→ [`docs/superpowers/specs/`](superpowers/specs/)
→ [`docs/superpowers/plans/`](superpowers/plans/)

---

## Migrations SQL

| Fichier | Domaine |
|---------|---------|
| `migrations/000_extensions.sql` | Extensions PostgreSQL |
| `migrations/000_extensions_types.sql` | Types énumérés |
| `migrations/001_domaine1_identites.sql` | Établissements, classes, années |
| `migrations/002_domaine2_acteurs.sql` | Utilisateurs, rôles, élèves, parents, enseignants |
| `migrations/003_domaine3_pedagogie.sql` | Matières, évaluations, notes, bulletins |
| `migrations/004_domaine4_vie_scolaire.sql` | Appels, présences, discipline, EDT |
| `migrations/005_domaine5_securite.sql` | Sessions, logs d'accès, OTP |
| `migrations/006_donnees_reference.sql` | Données de référence (rôles, permissions) |
| `migrations/007_vues_et_fonctions.sql` | Vues SQL et fonctions PL/pgSQL |
| `migrations/008_index_performance.sql` | Index de performance |
| `migrations/009_fix_statut_checks.sql` | Correction contraintes statut appels/présences |
```

- [ ] **Step 2 : Commit**

```bash
git add docs/INDEX.md
git commit -m "docs: INDEX.md — point d'entrée unique de la documentation"
```

---

### Task 2 : Créer le CHANGELOG

**Files:**
- Create: `docs/CHANGELOG.md`

- [ ] **Step 1 : Créer `docs/CHANGELOG.md`**

```markdown
# Changelog — EcoleManager

Historique des versions par sprint. Format : version sémantique + date + résumé feature + endpoints + fichiers clés.

---

## v0.5.0 — Sprint 5 · 2026-03-30 : EDT Enseignant

**Features :**
- Grille hebdomadaire de l'emploi du temps enseignant (navigation ±semaine)
- Drawer latéral par créneau : appel, historique présences, notes, salle
- Modification ponctuelle de salle (PUT)
- Cache Redis invalidé à chaque modification

**Endpoints :**
| Méthode | Route |
|---------|-------|
| GET | `/enseignants/moi/edt?semaine=YYYY-MM-DD` |
| GET | `/appels/cours?creneau_id=&date=` |
| POST | `/appels` |
| PUT | `/appels/:id/presences` |
| PUT | `/enseignants/moi/edt/:creneau_id/salle` |

**Fichiers clés :**
- Backend : `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`
- Backend : `backend/src/domains/04-vie-scolaire/appels/`
- Dashboard : `dashboard/js/pages/ens-edt.js` (réécrit intégralement)
- Dashboard : `dashboard/enseignant.html` (drawer + nav semaine)
- Migration : `migrations/009_fix_statut_checks.sql`

**Points d'attention :**
- ES5 strict dans ens-edt.js — `_creneauxMap` pour lookup id→objet sans JSON.stringify
- Cache key Redis : `edt_ens:{enseignant_id}*` (glob)
- Ownership check : join `affectations_enseignants` → pas de colonne directe enseignant_id sur EDT

---

## v0.4.0 — Sprint 4 · 2026-03-29 : Portail Parents

**Features :**
- Login OTP SMS en 2 étapes (téléphone + code établissement → code à 6 chiffres)
- Dashboard parent : KPI (moyenne générale, absences, mention), dernières notes, absences récentes
- Notes par matière filtrables par période
- Liste absences/retards avec statut justification
- Bulletins trimestriels avec moyennes par matière
- Sélecteur multi-enfant dans la sidebar

**Endpoints :**
| Méthode | Route |
|---------|-------|
| POST | `/auth/otp/demander` |
| POST | `/auth/otp/valider` |
| GET | `/parents/moi/enfants` |
| GET | `/parents/moi/enfants/:eleve_id/notes` |
| GET | `/parents/moi/enfants/:eleve_id/absences` |
| GET | `/parents/moi/enfants/:eleve_id/bulletins` |

**Fichiers clés :**
- Backend : `backend/src/domains/02-acteurs/auth/auth.routes.js` (routes OTP)
- Backend : `backend/src/domains/02-acteurs/parents/parents.routes.js`
- Dashboard : `dashboard/parent-login.html`, `dashboard/parent.html`
- Dashboard : `dashboard/js/par-app.js`, `dashboard/js/par-router.js`
- Dashboard : `dashboard/js/pages/par-dashboard.js`, `par-notes.js`, `par-absences.js`, `par-bulletins.js`

**Points d'attention :**
- Table `parents_eleves` (pas `parents`) — colonnes `parent_id` / `eleve_id`
- Établissement via `code_officiel` (pas `code`)
- En dev sans `AT_API_KEY` : OTP loggé via `logger.warn` au lieu d'être envoyé par SMS
- OTP stocké hashé SHA-256 dans `otp_verifications.code_hash`

---

## v0.3.0 — Sprint 3 · 2026-03-22 : Tests, Cache & Monitoring

**Features :**
- Suite de tests d'intégration (Jest) sur les 5 domaines
- Cache Redis avec invalidation par pattern
- Logs structurés (Winston) + monitoring erreurs sync mobile
- Script `test-integration.sh` pour lancer les tests en local

**Fichiers clés :**
- `backend/tests/integration/` — suites par domaine
- `backend/tests/integration/jest.integration.config.js`
- `backend/tests/integration/globalSetup.js`
- `backend/src/infrastructure/cache/redis.js`
- `backend/src/infrastructure/monitoring/`
- `scripts/test-integration.sh`

**Points d'attention :**
- Les tests d'intégration utilisent `--config jest.integration.config.js` (pas le config par défaut)
- PostgreSQL de test sur port 5433 (variable `POSTGRES_PORT`)
- `globalSetup.js` applique toutes les migrations dans l'ordre

---

## v0.2.0 — Sprint 2 · 2026-03-21 : Portail Enseignant

**Features :**
- Portail enseignant complet : 6 pages (dashboard, appel, notes, discipline, EDT, classes)
- Routing hash côté client (ens-router.js)
- Modals réutilisables pour les opérations CRUD
- Redirection role-based depuis le login (admin → index.html, enseignant → enseignant.html, parent → parent.html)

**Endpoints clés :**
| Méthode | Route |
|---------|-------|
| GET | `/enseignants/moi/classes` |
| GET | `/enseignants/moi/edt` |
| GET | `/eleves?classe_id=` |
| POST/PUT | `/appels`, `/appels/:id/presences` |
| GET/POST | `/notes`, `/evaluations` |

**Fichiers clés :**
- Dashboard : `dashboard/enseignant.html`
- Dashboard : `dashboard/js/ens-app.js`, `dashboard/js/ens-router.js`
- Dashboard : `dashboard/js/pages/ens-dashboard.js`, `ens-appel.js`, `ens-notes.js`, `ens-discipline.js`, `ens-classes.js`

---

## v0.1.0 — Sprint 1 · 2026-03-19 : Affectations

**Features :**
- Gestion des affectations enseignants–classes–matières (backend + dashboard admin)
- CRUD matières dans les paramètres
- Bouton Affecter depuis la page enseignants

**Endpoints :**
| Méthode | Route |
|---------|-------|
| GET | `/affectations?etablissement_id=` |
| POST | `/affectations` |
| DELETE | `/affectations/:id` |
| GET/POST | `/matieres` |

**Fichiers clés :**
- Backend : `backend/src/domains/01-identites/identites.routes.js`
- Dashboard : `dashboard/js/pages/enseignants.js`, `dashboard/js/pages/parametres.js`
- Dashboard : `dashboard/index.html` (modals m-affectations, m-matiere)

---

## v0.0.1 — Initial commit · 2026-03 : Fondations

**Features :**
- Structure Express + Knex + PostgreSQL + Redis
- 9 domaines de routes, 9 migrations SQL
- Dashboard HTML/CSS/JS vanilla (ES5)
- Login multi-rôle avec session JWT
- Inscription établissement
- App mobile React Native (Expo) — structure de base
```

- [ ] **Step 2 : Commit**

```bash
git add docs/CHANGELOG.md
git commit -m "docs: CHANGELOG.md — historique versionné v0.0.1→v0.5.0"
```

---

## Chunk 2 : Docs architecture (4 fichiers)

### Task 3 : overview.md

**Files:**
- Create: `docs/architecture/overview.md`

- [ ] **Step 1 : Créer `docs/architecture/overview.md`**

```markdown
# Architecture — Vue d'ensemble

## Stack technique

| Couche | Technologie | Version |
|--------|-------------|---------|
| Runtime | Node.js | ≥ 20 |
| Framework backend | Express | ^4.18 |
| ORM/Query builder | Knex | ^3.1 |
| Base de données | PostgreSQL | 15 (Docker) |
| Cache | Redis (ioredis) | ^5.3 |
| Queue | BullMQ | ^5.4 |
| Auth | JWT (jsonwebtoken) | ^9.0 |
| Notifications SMS | Africa's Talking | — |
| Frontend | HTML + CSS + JS ES5 | Vanilla |
| Mobile | React Native (Expo) | — |
| Tests | Jest (intégration) | — |

## Décisions d'architecture clés

**ES5 obligatoire dans le dashboard** — Les fichiers `dashboard/js/` utilisent uniquement du JavaScript ES5 (pas d'arrow functions, pas de `const`/`let`, pas de classes). Raison : compatibilité maximale avec les navigateurs des établissements scolaires africains.

**Multi-tenant par `etablissement_id`** — Chaque requête authentifiée porte un `etablissement_id` en session. Le middleware `isoler` l'injecte dans `req.etablissement_id`. Toutes les requêtes SQL filtrent sur ce champ — jamais de données cross-établissement.

**Permissions granulaires** — Le middleware `perm('code.permission')` vérifie que le rôle de l'utilisateur possède la permission dans `roles_permissions`. Exemple : `perm('edt.modifier_ponctuel')` pour les enseignants.

**Session côté serveur** — JWT stocké en cookie HttpOnly. La table `sessions` enregistre chaque session active (ip, user-agent, expire_at).

## Schéma global des portails

```
┌─────────────────────────────────────────────────────────────────┐
│                         dashboard/                               │
│                                                                  │
│  index.html          enseignant.html        parent.html          │
│  (admin)             (enseignant)           (parent)             │
│  app.js              ens-app.js             par-app.js           │
│  router.js           ens-router.js          par-router.js        │
│  pages/              pages/ens-*.js         pages/par-*.js       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP REST (config.js → API_BASE)
┌──────────────────────────▼──────────────────────────────────────┐
│                     backend/src/                                  │
│                                                                  │
│  app.js (Express)                                                │
│  domains/                                                        │
│    01-identites/     → établissements, classes, années           │
│    02-acteurs/       → auth, élèves, parents, enseignants        │
│    03-pedagogie/     → matières, évaluations, notes, bulletins   │
│    04-vie-scolaire/  → appels, présences, discipline, EDT        │
│    05-securite/      → logs, OTP, sessions                       │
│                                                                  │
│  infrastructure/                                                 │
│    database/pool.js  → Knex + PostgreSQL                         │
│    cache/redis.js    → ioredis + invalidatePattern()             │
│    notifications/    → SMS (Africa's Talking)                    │
│    monitoring/       → logs structurés Winston                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  PostgreSQL (Docker)      Redis (Docker)                         │
│  port 5432 (prod)         port 6379                              │
│  port 5433 (tests)                                               │
└─────────────────────────────────────────────────────────────────┘
```

## Variables d'environnement requises

```env
# Base de données
DATABASE_URL=postgresql://ecole_user:password@localhost:5432/ecole_manager
POSTGRES_PORT=5432          # 5433 pour les tests

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=...
SESSION_SECRET=...

# SMS (optionnel en dev — OTP loggé si absent)
AT_API_KEY=...
AT_USERNAME=...

# Rate limiting
RATE_LIMIT_AUTH_MAX=10
```
```

- [ ] **Step 2 : Commit**

```bash
git add docs/architecture/overview.md
git commit -m "docs: architecture/overview.md — stack, décisions clés, schéma global"
```

---

### Task 4 : backend.md

**Files:**
- Create: `docs/architecture/backend.md`

- [ ] **Step 1 : Créer `docs/architecture/backend.md`**

```markdown
# Architecture — Backend

## Structure des domaines

```
backend/src/
  app.js                          ← Express app, montage des routers
  domains/
    setup/                        ← Inscription établissement (public)
    01-identites/
      identites.routes.js         ← établissements, classes, années, affectations
    02-acteurs/
      auth/auth.routes.js         ← connexion, OTP, reset mdp, déconnexion
      eleves/eleves.routes.js     ← CRUD élèves
      parents/parents.routes.js   ← portail parents (enfants, notes, absences, bulletins)
      enseignants/
        enseignants.routes.js     ← profil, classes, EDT, appels
    03-pedagogie/
      pedagogie.routes.js         ← matières, évaluations, notes, bulletins, moyennes
    04-vie-scolaire/
      vie-scolaire.routes.js      ← appels, présences, discipline, EDT, événements
    05-securite/
      securite.routes.js          ← logs d'accès, gestion sessions
    sync.routes.js                ← sync mobile (delta sync)
  middleware/
    auth.middleware.js            ← `auth` : vérifie JWT, charge session
    permission.middleware.js      ← `perm('code')` : vérifie permission rôle
    validate.middleware.js        ← `valider(zodSchema)` : validation body
    error.middleware.js           ← handler global erreurs
    notFound.middleware.js        ← 404
  infrastructure/
    database/pool.js              ← `getDB()` → instance Knex
    cache/redis.js                ← `getRedis()`, `invalidatePattern(key*)`
    notifications/sms.service.js  ← `envoyerOTP(tel, code, nomEtab)`
    monitoring/                   ← logs structurés Winston
  utils/
    ApiError.js                   ← classes d'erreurs métier (nonTrouve, nonAutorise, etc.)
    logger.js                     ← Winston logger
```

## Middlewares — Usage

```javascript
// Ordre standard sur un endpoint protégé
router.get('/route', auth, isoler, perm('domaine.action'), valider(schema), handler);

// auth      → vérifie JWT cookie, charge req.session.utilisateur_id
// isoler    → injecte req.etablissement_id depuis la session
// perm()    → vérifie que le rôle possède la permission
// valider() → valide req.body contre un schéma Zod, renvoie 422 si invalide
```

## Pattern de réponse

```javascript
const { ok } = require('../../utils/response');   // { succes: true, data: ... }
const ApiError = require('../../utils/ApiError');

// Succès
return ok(res, donnees);

// Erreurs métier
throw ApiError.nonTrouve('Message');       // 404
throw ApiError.nonAutorise('Message');     // 403
throw ApiError.demandeInvalide('Message'); // 400
// → capturées par error.middleware.js → { succes: false, erreur, code }
```

## Pattern getEnseignantConnecte

```javascript
// Récupère l'enseignant depuis utilisateur_id en session
// Utilisé dans tous les endpoints /enseignants/moi/*
const enseignant = await getEnseignantConnecte(db, req.session.utilisateur_id);
// → { id, prenom, nom, ... } ou ApiError.nonTrouve si absent
```

## Cache Redis

```javascript
const { invalidatePattern } = require('../../../infrastructure/cache/redis');

// Invalider toutes les clés d'un enseignant après modification
await invalidatePattern('edt_ens:' + enseignant.id + '*');

// Patterns de cache par domaine
// edt_ens:{enseignant_id}:{semaine}  ← EDT enseignant par semaine
```

## Validation Zod

```javascript
const { z } = require('zod');
const { valider } = require('../../middleware/validate.middleware');

const schema = z.object({
  nom: z.string().min(2).max(100),
  salle: z.string().max(50).nullable().optional(),
});

router.post('/route', auth, isoler, valider(schema), handler);
```

## Conventions SQL (Knex)

```javascript
const db = getDB();

// Toujours filtrer par etablissement_id
const eleves = await db('eleves').where({ etablissement_id: req.etablissement_id });

// Ownership check enseignant → créneau (via join, pas de colonne directe)
const creneau = await db('emplois_du_temps as edt')
  .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
  .where({ 'edt.id': id, 'ae.enseignant_id': enseignant.id })
  .first('edt.id');
```
```

- [ ] **Step 2 : Commit**

```bash
git add docs/architecture/backend.md
git commit -m "docs: architecture/backend.md — domaines, middlewares, patterns"
```

---

### Task 5 : dashboard.md

**Files:**
- Create: `docs/architecture/dashboard.md`

- [ ] **Step 1 : Créer `docs/architecture/dashboard.md`**

```markdown
# Architecture — Dashboard

## Les 3 portails

| Portail | Fichier HTML | App JS | Router JS | Pages |
|---------|-------------|--------|-----------|-------|
| Admin | `index.html` | `app.js` | `router.js` | `pages/*.js` (sans préfixe) |
| Enseignant | `enseignant.html` | `ens-app.js` | `ens-router.js` | `pages/ens-*.js` |
| Parent | `parent.html` | `par-app.js` | `par-router.js` | `pages/par-*.js` |
| Login parent | `parent-login.html` | _(inline)_ | — | — |

## Routing hash

La navigation se fait via `window.location.hash`. Chaque portail a son router :

```javascript
// Exemple ens-router.js
var EnsRouter = {
  init: function() {
    window.addEventListener('hashchange', EnsRouter.route);
    EnsRouter.route();
  },
  route: function() {
    var hash = window.location.hash || '#ens-dashboard';
    // switch sur hash → appel de la page correspondante
  }
};
```

## Convention ES5 OBLIGATOIRE

**Tout le JavaScript du dashboard doit être ES5.** Raison : compatibilité navigateurs anciens en Afrique de l'Ouest.

```javascript
// ✅ Correct — ES5
var PageExample = {
  init: function() { ... },
  charger: function() { ... },
  render: function(data) { ... }
};

// ❌ Interdit
const PageExample = {
  init: () => { ... },    // arrow function
  async charger() { ... } // méthode async ES6
};
```

Règles ES5 :
- `var` uniquement (pas `const`/`let`)
- Pas d'arrow functions `() =>`
- Pas de template literals `` ` ``
- Pas de destructuring
- Pas de classes ES6
- Pas de `async`/`await` — utiliser `.then().catch()`
- Zero-padding : `('0' + n).slice(-2)` (pas `.padStart()`)
- Dates : `getFullYear()`, `getMonth()`, `getDate()` (pas `toISOString()` — décalage UTC)

## Pattern page JS

```javascript
var PageNom = {
  // State
  _data: null,

  // Appelé par le router à chaque navigation vers cette page
  init: function() {
    PageNom._charger();
  },

  _charger: function() {
    Api.get('/route').then(function(res) {
      PageNom._data = res.data;
      PageNom._render();
    }).catch(function(err) {
      console.warn('PageNom: erreur chargement', err.message);
    });
  },

  _render: function() {
    var parts = [];
    // Construire le HTML dans parts[], jamais += dans une boucle
    parts.push('<div>...</div>');
    document.getElementById('contenu').innerHTML = parts.join('');
  }
};
```

## API client

```javascript
// dashboard/js/api.js — fonctions globales
Api.get('/route')                    // GET → Promise
Api.post('/route', body)             // POST → Promise
Api.put('/route', body)              // PUT → Promise
Api.delete('/route')                 // DELETE → Promise

// Toutes les réponses : { succes: true, data: ... } ou { succes: false, erreur: ... }
// La base URL est dans dashboard/js/config.js → CONFIG.API_BASE
```

## Inline onclick — piège JSON.stringify

```javascript
// ❌ Problème : JSON.stringify casse les onclick avec guillemets
parts.push('<button onclick="ouvrir(' + JSON.stringify(obj) + ')">');

// ✅ Solution : stocker dans une map, passer seulement l'id
var _map = {};
_map[obj.id] = obj;
parts.push('<button onclick="ouvrir(\'' + obj.id + '\')">');
function ouvrir(id) { var obj = _map[id]; ... }
```

## Structure fichiers dashboard

```
dashboard/
  index.html              ← portail admin
  enseignant.html         ← portail enseignant
  parent.html             ← portail parent
  parent-login.html       ← login OTP SMS
  css/
    style.css             ← styles globaux (tous les portails)
  js/
    config.js             ← CONFIG.API_BASE, CONFIG.VERSION
    api.js                ← Api.get/post/put/delete
    auth.js               ← vérif token + redirection rôle
    app.js                ← init portail admin
    router.js             ← routing admin
    ens-app.js            ← init portail enseignant
    ens-router.js         ← routing enseignant
    par-app.js            ← init portail parent
    par-router.js         ← routing parent
    ui.js                 ← helpers UI (modals, toasts, loaders)
    data-mock.js          ← données mock pour dev offline
    pages/
      *.js                ← pages admin (absences, bulletins, classes…)
      ens-*.js            ← pages enseignant
      par-*.js            ← pages parent
  .claude/
    launch.json           ← config serveur preview (port 3001, npx serve)
```
```

- [ ] **Step 2 : Commit**

```bash
git add docs/architecture/dashboard.md
git commit -m "docs: architecture/dashboard.md — portails, routing, conventions ES5"
```

---

### Task 6 : database.md

**Files:**
- Create: `docs/architecture/database.md`

- [ ] **Step 1 : Créer `docs/architecture/database.md`**

```markdown
# Architecture — Base de données

## PostgreSQL + Knex

- **Connexion :** `getDB()` depuis `backend/src/infrastructure/database/pool.js`
- **ORM :** Knex (query builder, pas d'ORM complet)
- **Docker :** `ecole_postgres`, port 5432 (prod) / 5433 (tests)
- **DB :** `ecole_manager`, user `ecole_user`

## Schéma par domaine

### Domaine 1 — Identités (`001_domaine1_identites.sql`)

| Table | Description |
|-------|-------------|
| `etablissements` | École/lycée (id, nom, `code_officiel`, actif) |
| `annees_scolaires` | Année scolaire (id, libelle, etablissement_id, actif) |
| `classes` | Classe (id, nom, niveau, annee_scolaire_id, etablissement_id) |
| `affectations_enseignants` | Lien enseignant–classe–matière |

### Domaine 2 — Acteurs (`002_domaine2_acteurs.sql`)

| Table | Description |
|-------|-------------|
| `utilisateurs` | Tous les comptes (id, nom, prenom, telephone, email, actif) |
| `roles` | Rôles disponibles (admin, enseignant, parent…) |
| `permissions` | Permissions atomiques (edt.lire, edt.modifier_ponctuel…) |
| `roles_permissions` | M2M rôles–permissions |
| `utilisateur_roles` | Rôle d'un utilisateur dans un établissement |
| `eleves` | Élève (id, nom, prenom, classe_id, etablissement_id) |
| `parents_eleves` | M2M parents–élèves (parent_id, eleve_id, lien) |
| `otp_verifications` | Codes OTP SMS (telephone, code_hash SHA-256, expire_at, utilise) |
| `sessions` | Sessions JWT actives |

### Domaine 3 — Pédagogie (`003_domaine3_pedagogie.sql`)

| Table | Description |
|-------|-------------|
| `matieres` | Matières (id, nom, etablissement_id) |
| `disciplines_matieres` | Lien affectation–matière + `couleur_affichage` |
| `evaluations` | Évaluation (id, libelle, type, classe_id, matiere_id, date_eval) |
| `notes` | Note d'un élève (eleve_id, evaluation_id, valeur, sur) |
| `configs_systeme_notes` | Configuration notation par établissement |
| `bulletins` | Bulletin trimestriel par élève |
| `moyennes` | Moyennes calculées par matière/trimestre |

### Domaine 4 — Vie scolaire (`004_domaine4_vie_scolaire.sql`)

| Table | Description |
|-------|-------------|
| `emplois_du_temps` | Créneau EDT (affectation_id, jour, heure_debut, heure_fin, salle) |
| `plages_horaires` | Plages standards par établissement |
| `appels` | Appel d'une classe (classe_id, creneau_id, date, statut, enseignant_id) |
| `presences` | Présence d'un élève (appel_id, eleve_id, statut, heure_arrivee) |
| `evenements_discipline` | Incidents disciplinaires |

### Domaine 5 — Sécurité (`005_domaine5_securite.sql`)

| Table | Description |
|-------|-------------|
| `logs_connexion` | Tentatives de connexion (succès/échec, ip, user-agent) |

## Migrations

Appliquer dans l'ordre numérique. Le script `migrations/run_all_migrations.sql` les enchaîne.

Pour les tests d'intégration : `backend/tests/integration/globalSetup.js` applique chaque migration via `fs.readFileSync` + `db.raw()`.

**Ajouter une migration :**
1. Créer `migrations/NNN_description.sql`
2. L'ajouter dans `globalSetup.js` (liste `migrationFiles`)
3. L'appliquer en local : `docker exec ecole_postgres psql -U ecole_user -d ecole_manager -f /migrations/NNN.sql`

## Conventions colonnes

| Convention | Exemple |
|------------|---------|
| Clé primaire | `id UUID DEFAULT gen_random_uuid()` |
| Timestamps | `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at` |
| Booléens actif | `actif BOOLEAN DEFAULT true` |
| FK | `{table_singulier}_id UUID REFERENCES {table}(id)` |
| Enum en CHECK | `CHECK (statut IN ('valeur1', 'valeur2'))` |
| Code officiel | `code_officiel VARCHAR(20) UNIQUE` |

## Clés de cache Redis

| Pattern | Domaine | Invalidation |
|---------|---------|-------------|
| `edt_ens:{enseignant_id}:{semaine}` | EDT enseignant | PUT /edt/:id/salle |
```

- [ ] **Step 2 : Commit**

```bash
git add docs/architecture/database.md
git commit -m "docs: architecture/database.md — schéma 5 domaines, migrations, conventions"
```

---

## Chunk 3 : Feature docs (5 fichiers)

### Task 7 : Feature 01 — Affectations

**Files:**
- Create: `docs/features/01-affectations.md`

- [ ] **Step 1 : Créer `docs/features/01-affectations.md`**

```markdown
# Feature 01 — Affectations

**Version :** v0.1.0 · Sprint 1 · 2026-03-19
**Statut :** ✅ Livré

## Résumé

Permet à l'administrateur de lier un enseignant à une classe et une matière (affectation). Inclut la gestion des matières depuis les paramètres. Point de départ de toute la chaîne pédagogique (EDT, appels, notes sont basés sur les affectations).

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/affectations` | admin | Liste affectations de l'établissement |
| POST | `/affectations` | admin | Créer une affectation |
| DELETE | `/affectations/:id` | admin | Supprimer une affectation |
| GET | `/matieres` | admin | Liste matières de l'établissement |
| POST | `/matieres` | admin | Créer une matière |

## Fichiers concernés

**Backend :**
- `backend/src/domains/01-identites/identites.routes.js` — routes affectations + matières

**Dashboard :**
- `dashboard/js/pages/enseignants.js` — bouton Affecter, modal
- `dashboard/js/pages/parametres.js` — section matières (chargerMatieres, creerMatiere)
- `dashboard/index.html` — modals `m-affectations`, `m-matiere`

## Points d'attention

- Les affectations sont scopées par `etablissement_id` (multi-tenant)
- La table `disciplines_matieres` lie `affectations_enseignants` à `matieres` avec une `couleur_affichage`
- La couleur est utilisée dans la grille EDT enseignant (ens-edt.js)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md`](../superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-19-affectations.md`](../superpowers/plans/2026-03-19-affectations.md)
```

- [ ] **Step 2 : Commit**

```bash
git add docs/features/01-affectations.md
git commit -m "docs: features/01-affectations.md"
```

---

### Task 8 : Feature 02 — Portail Enseignant

**Files:**
- Create: `docs/features/02-portail-enseignant.md`

- [ ] **Step 1 : Créer `docs/features/02-portail-enseignant.md`**

```markdown
# Feature 02 — Portail Enseignant

**Version :** v0.2.0 · Sprint 2 · 2026-03-21
**Statut :** ✅ Livré

## Résumé

Portail dédié aux enseignants avec 6 pages : tableau de bord, appel, notes, discipline, emploi du temps et classes. Séparé du portail admin (HTML + JS distincts). Routing hash côté client. Redirection automatique depuis le login selon le rôle.

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/enseignants/moi` | enseignant | Profil enseignant connecté |
| GET | `/enseignants/moi/classes` | enseignant | Classes affectées |
| GET | `/enseignants/moi/edt` | enseignant | EDT hebdomadaire |
| GET | `/eleves?classe_id=` | enseignant | Élèves d'une classe |
| POST | `/appels` | appel.creer | Créer un appel |
| PUT | `/appels/:id/presences` | appel.saisir | Saisir les présences |
| GET | `/evaluations?classe_id=` | notes.lire | Évaluations d'une classe |
| POST | `/notes/batch` | notes.saisir | Saisir les notes en batch |

## Fichiers concernés

**Dashboard :**
- `dashboard/enseignant.html` — structure HTML complète (6 pages + 3 modals)
- `dashboard/js/ens-app.js` — initialisation portail enseignant
- `dashboard/js/ens-router.js` — routing hash `#ens-*`
- `dashboard/js/auth.js` — redirection `enseignant.html` si rôle=enseignant
- `dashboard/js/pages/ens-dashboard.js` — KPI + actions urgentes
- `dashboard/js/pages/ens-appel.js` — sélecteur classe/créneau + saisie présences
- `dashboard/js/pages/ens-notes.js` — grille de notes par évaluation
- `dashboard/js/pages/ens-discipline.js` — événements disciplinaires
- `dashboard/js/pages/ens-classes.js` — liste classes affectées
- `dashboard/js/pages/ens-edt.js` — grille EDT (réécrit en v0.5.0)

## Points d'attention

- Toutes les pages `ens-*.js` sont des objets ES5 littéraux (pas de classes)
- Le router appelle `PageXxx.init()` à chaque navigation vers la page
- L'appel est lié à un `creneau_id` depuis l'EDT (pas seulement classe + date)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md`](../superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-21-espace-enseignant-dashboard.md`](../superpowers/plans/2026-03-21-espace-enseignant-dashboard.md)
```

- [ ] **Step 2 : Commit**

```bash
git add docs/features/02-portail-enseignant.md
git commit -m "docs: features/02-portail-enseignant.md"
```

---

### Task 9 : Feature 03 — Tests, Cache & Monitoring

**Files:**
- Create: `docs/features/03-tests-cache-monitoring.md`

- [ ] **Step 1 : Créer `docs/features/03-tests-cache-monitoring.md`**

```markdown
# Feature 03 — Tests, Cache & Monitoring

**Version :** v0.3.0 · Sprint 3 · 2026-03-22
**Statut :** ✅ Livré

## Résumé

Mise en place de la suite de tests d'intégration (Jest) couvrant les 5 domaines, du cache Redis avec invalidation par pattern, et des logs structurés Winston pour le monitoring. Permet de valider les endpoints contre une vraie base de données de test.

## Fichiers concernés

**Tests :**
- `backend/tests/integration/` — suites par domaine
- `backend/tests/integration/jest.integration.config.js` — config Jest spécifique
- `backend/tests/integration/globalSetup.js` — applique les 9 migrations avant les tests
- `backend/tests/integration/globalTeardown.js` — nettoyage

**Infrastructure :**
- `backend/src/infrastructure/cache/redis.js` — `getRedis()`, `invalidatePattern()`
- `backend/src/infrastructure/monitoring/` — logs structurés
- `scripts/test-integration.sh` — script one-command pour lancer les tests

## Lancer les tests d'intégration

```bash
# Depuis la racine du projet
bash scripts/test-integration.sh

# Ou directement
cd backend
POSTGRES_PORT=5433 npx jest --config tests/integration/jest.integration.config.js
```

**Important :** Ne pas utiliser `npx jest` sans `--config` — le config par défaut exclut `/tests/integration/`.

## Points d'attention

- PostgreSQL de test sur **port 5433** (variable `POSTGRES_PORT`)
- `globalSetup.js` contient la liste ordonnée des migrations à appliquer — ajouter toute nouvelle migration
- Les tests créent/suppriment leurs propres données (pas de fixtures partagées)
- Le cache Redis est mocké dans les tests ou ignoré (try/catch autour des appels `invalidatePattern`)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-22-tests-cache-monitoring-design.md`](../superpowers/specs/2026-03-22-tests-cache-monitoring-design.md)
- Plan : [`docs/superpowers/plans/2026-03-22-tests-cache-monitoring.md`](../superpowers/plans/2026-03-22-tests-cache-monitoring.md)
```

- [ ] **Step 2 : Commit**

```bash
git add docs/features/03-tests-cache-monitoring.md
git commit -m "docs: features/03-tests-cache-monitoring.md"
```

---

### Task 10 : Feature 04 — Portail Parents

**Files:**
- Create: `docs/features/04-portail-parents.md`

- [ ] **Step 1 : Créer `docs/features/04-portail-parents.md`**

```markdown
# Feature 04 — Portail Parents

**Version :** v0.4.0 · Sprint 4 · 2026-03-29
**Statut :** ✅ Livré

## Résumé

Portail dédié aux parents avec login sans mot de passe (OTP SMS en 2 étapes). Permet de consulter les notes, absences et bulletins de chaque enfant. Supporte les familles multi-enfants avec un sélecteur dans la sidebar.

## Flow OTP SMS

```
1. Parent saisit téléphone + code établissement
   → POST /auth/otp/demander
   → code à 6 chiffres généré, hashé SHA-256, stocké dans otp_verifications
   → SMS envoyé (ou loggé en dev si AT_API_KEY absent)

2. Parent saisit le code à 6 chiffres
   → POST /auth/otp/valider
   → hash comparé, OTP marqué utilisé, session créée
   → redirection vers parent.html
```

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| POST | `/auth/otp/demander` | public | Envoyer OTP SMS |
| POST | `/auth/otp/valider` | public | Valider OTP → session |
| GET | `/parents/moi/enfants` | parent | Liste enfants |
| GET | `/parents/moi/enfants/:id/notes` | parent | Notes d'un enfant |
| GET | `/parents/moi/enfants/:id/absences` | parent | Absences d'un enfant |
| GET | `/parents/moi/enfants/:id/bulletins` | parent | Bulletins d'un enfant |

## Fichiers concernés

**Backend :**
- `backend/src/domains/02-acteurs/auth/auth.routes.js` — routes OTP (lignes ~160–290)
- `backend/src/domains/02-acteurs/parents/parents.routes.js` — routes portail parent
- `backend/src/infrastructure/notifications/sms.service.js` — envoi SMS Africa's Talking

**Dashboard :**
- `dashboard/parent-login.html` — formulaire 2 étapes (step1 tel+code, step2 OTP)
- `dashboard/parent.html` — structure 4 pages
- `dashboard/js/par-app.js` — init + chargement enfants + sélecteur
- `dashboard/js/par-router.js` — routing hash `#par-*`
- `dashboard/js/pages/par-dashboard.js` — KPI + dernières notes + absences récentes
- `dashboard/js/pages/par-notes.js` — notes par matière + filtre période
- `dashboard/js/pages/par-absences.js` — liste absences/retards
- `dashboard/js/pages/par-bulletins.js` — bulletins trimestriels

**Base de données :**
- `otp_verifications` — (telephone, code_hash, objectif, expire_at, utilise, nb_tentatives)
- `parents_eleves` — (parent_id, eleve_id, lien) — **pas** `parent_utilisateur_id`

## Points d'attention

- `etablissements.code_officiel` — pas `.code`
- `parents_eleves` — pas `parents` — colonnes `parent_id` / `eleve_id`
- OTP max **3 tentatives** (contrainte `nb_tentatives <= 3`)
- En dev : si `AT_API_KEY` absent → OTP loggé via `logger.warn` (visible dans console backend)
- OTP valide **10 minutes** (`expire_at = NOW() + INTERVAL '10 minutes'`)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-29-portail-parents-design.md`](../superpowers/specs/2026-03-29-portail-parents-design.md)
- Plan : [`docs/superpowers/plans/2026-03-29-portail-parents.md`](../superpowers/plans/2026-03-29-portail-parents.md)
```

- [ ] **Step 2 : Commit**

```bash
git add docs/features/04-portail-parents.md
git commit -m "docs: features/04-portail-parents.md"
```

---

### Task 11 : Feature 05 — EDT Enseignant

**Files:**
- Create: `docs/features/05-edt-enseignant.md`

- [ ] **Step 1 : Créer `docs/features/05-edt-enseignant.md`**

```markdown
# Feature 05 — EDT Enseignant

**Version :** v0.5.0 · Sprint 5 · 2026-03-30
**Statut :** ✅ Livré

## Résumé

Remplace l'ancienne page EDT statique par une grille hebdomadaire interactive avec navigation ±semaine. Un clic sur un créneau ouvre un drawer latéral avec 4 onglets : appel (saisie présences), historique, notes de cours et modification de salle.

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/enseignants/moi/edt?semaine=YYYY-MM-DD` | enseignant | Créneaux de la semaine |
| GET | `/appels/cours?creneau_id=&date=` | enseignant | Appel du créneau + présences |
| POST | `/appels` | appel.creer | Créer un appel (renvoie `{ appel_id, nb_eleves }`) |
| PUT | `/appels/:id/presences` | appel.saisir | Saisir présences (body: `{ presences[], cloturer }`) |
| PUT | `/enseignants/moi/edt/:creneau_id/salle` | edt.modifier_ponctuel | Modifier salle |

## Fichiers concernés

**Backend :**
- `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`
  - `GET /enseignants/moi/edt` — avec `couleur_affichage` via join `disciplines_matieres`
  - `PUT /enseignants/moi/edt/:creneau_id/salle` — ownership check + invalidation Redis
- `backend/src/domains/04-vie-scolaire/appels/` — routes appels
- `migrations/009_fix_statut_checks.sql` — corrige les CHECK contraintes appels/présences

**Dashboard :**
- `dashboard/js/pages/ens-edt.js` — réécrit intégralement (3 objets ES5 : `PageEnsEdt`, `EdtDrawer`, `EdtAppel`)
- `dashboard/enseignant.html` — nav semaine + drawer HTML (`#edt-overlay`, `#edt-drawer`)
- `dashboard/css/style.css` — styles grille EDT + drawer + onglets + boutons appel

## Architecture ens-edt.js

```
PageEnsEdt          ← page principale, chargement EDT, construction grille
  └── _creneauxMap  ← { [creneau_id]: creneau } — lookup sans JSON.stringify
  └── _lundiDeSemaine() _dateISO() _addDays() _labelSemaine()

EdtDrawer           ← drawer latéral, onglets, rendu par onglet
  └── ouvrir(id)    ← appelé depuis les onclick de la grille
  └── onglet(nom)   ← switche entre appel/historique/notes/salle

EdtAppel            ← logique appel (création, saisie présences, clôture)
  └── render(creneau, date)
  └── _marquer(eleve_id, statut)
  └── _cloturer()
```

## Points d'attention

- **Réponse POST /appels** : renvoie `{ appel_id, nb_eleves }` — utiliser `.appel_id` (pas `.id`)
- **Cache Redis** : clé `edt_ens:{enseignant_id}*` — invalidée après PUT salle
- **Ownership** : join `affectations_enseignants` pour vérifier qu'un créneau appartient à l'enseignant — pas de colonne `enseignant_id` directe sur `emplois_du_temps`
- **Dates** : ne pas utiliser `.toISOString()` (décalage UTC) — construire avec `getFullYear()`, `getMonth()+1`, `getDate()`
- **Zero-padding** : `('0' + n).slice(-2)` — `.padStart()` n'est pas ES5

## Liens

- Spec : [`docs/superpowers/specs/2026-03-30-edt-enseignant-design.md`](../superpowers/specs/2026-03-30-edt-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-30-edt-enseignant.md`](../superpowers/plans/2026-03-30-edt-enseignant.md)
```

- [ ] **Step 2 : Commit**

```bash
git add docs/features/05-edt-enseignant.md
git commit -m "docs: features/05-edt-enseignant.md"
```
