# EcoleManager — CLAUDE.md

> Ce fichier est le point d'entrée principal pour Claude Code.
> Lis-le entièrement avant toute action sur ce projet.

---

## 🎯 Contexte du projet

**EcoleManager** est un système de gestion scolaire offline-first pour les établissements
d'Afrique de l'Ouest francophone (Sénégal, Côte d'Ivoire, Mali, Burkina Faso…).

**Contraintes terrain critiques :**
- Connexion internet intermittente (2G/3G) → toute l'appli doit fonctionner hors ligne
- Enseignants peu habitués aux smartphones → UX ultra-simplifiée
- Parents contactés par SMS ou WhatsApp (pas d'email)
- Numéros de téléphone locaux : +221 (SN), +225 (CI), +223 (ML), +226 (BF)…

**Stack technique :**
- Backend : Node.js 20 + Express + PostgreSQL 15 + Redis + BullMQ
- Mobile : React Native 0.76 + Expo SDK 52 + SQLite (offline-first)
- Dashboard : HTML/CSS/JS vanilla (aucune dépendance NPM)
- Infra : Docker Compose (dev) + PM2 + Nginx (prod)

---

## 🗂️ Structure du monorepo

```
ecolemanager/
├── CLAUDE.md               ← tu es ici
├── .env.example            ← variables globales
├── .gitignore
├── .github/workflows/
│   └── ci.yml              ✅ CI — lint, tests, Docker build, TypeScript check
├── docker-compose.yml      ← PostgreSQL + Redis + API (dev)
│
├── backend/                ← API Node.js/Express
│   ├── src/
│   │   ├── app.js          ← entry point Express + Swagger UI
│   │   ├── swagger.js      ✅ OpenAPI 3.0.3 — 60 endpoints documentés
│   │   ├── domains/        ← logique métier par domaine
│   │   │   ├── 01-identites/       ✅ COMPLET
│   │   │   ├── 02-acteurs/
│   │   │   │   ├── auth/           ✅ COMPLET
│   │   │   │   ├── eleves/         ✅ COMPLET
│   │   │   │   ├── enseignants/    ✅ COMPLET (370 lignes — classes, EDT, affectations, profil)
│   │   │   │   └── parents/        ✅ COMPLET (335 lignes — enfants, tableau de bord, notes, absences, bulletins)
│   │   │   ├── 03-pedagogie/
│   │   │   │   ├── evaluations/    ✅ COMPLET
│   │   │   │   ├── notes/          ✅ COMPLET (dans evaluations)
│   │   │   │   ├── moyennes/       ✅ COMPLET (323 lignes — classe, élève, calcul batch, classement)
│   │   │   │   ├── bulletins/      ✅ COMPLET (245 lignes — liste, détail, génération, validation, download)
│   │   │   │   └── configs/        ✅ COMPLET (190 lignes — coefficients GET/PUT, matières GET/POST)
│   │   │   ├── 04-vie-scolaire/
│   │   │   │   ├── appels/         ✅ COMPLET
│   │   │   │   ├── presences/      ✅ COMPLET (dans appels)
│   │   │   │   ├── edt/            ✅ COMPLET (265 lignes — classe, enseignant, CRUD créneaux)
│   │   │   │   ├── discipline/     ✅ COMPLET (232 lignes — sanctions CRUD, dossier élève)
│   │   │   │   └── evenements/     ✅ COMPLET (183 lignes — agenda CRUD)
│   │   │   ├── 05-securite/        ✅ COMPLET (180 lignes — audit, sessions, blocage)
│   │   │   └── sync.routes.js      ✅ COMPLET
│   │   ├── infrastructure/
│   │   │   ├── database/           ✅ Pool PostgreSQL + helpers
│   │   │   ├── cache/              ✅ Redis client
│   │   │   ├── queue/              ✅ BullMQ setup
│   │   │   ├── notifications/      ✅ SMS (Africa's Talking) + WhatsApp
│   │   │   └── storage/            ✅ Cloudflare R2 / S3
│   │   ├── middleware/             ✅ auth JWT, erreurs, rate-limit, validation
│   │   ├── workers/                ✅ notification.worker.js
│   │   └── utils/                  ✅ helpers divers
│   ├── tests/                     ✅ 60 tests unitaires (9 suites Jest)
│   │   ├── helpers/               ✅ mockKnex, testApp, fixtures
│   │   └── domains/               ✅ 9 fichiers de test
│   ├── .eslintrc.js               ✅ ESLint config
│   ├── jest.config.js             ✅ Configuration Jest
│   ├── package.json
│   ├── Dockerfile
│   └── .env.example
│
├── mobile/                 ← React Native / Expo
│   ├── app/                ← Expo Router (file-based routing)
│   │   ├── _layout.tsx     ✅ Root layout (init DB, session, sync)
│   │   ├── index.tsx       ✅ Redirect selon rôle
│   │   ├── auth/
│   │   │   └── connexion.tsx  ✅ Login MDP + OTP SMS
│   │   └── (app)/
│   │       ├── _layout.tsx    ✅ Guard authentification
│   │       ├── enseignant/    ✅ 5 écrans (dashboard, appel, notes, évals, moyennes)
│   │       ├── parent/        ✅ 4 écrans (dashboard, absences, notes, bulletins)
│   │       └── commun/        ✅ profil
│   ├── src/
│   │   ├── services/
│   │   │   ├── api/client.ts       ✅ HTTP + auth + retry
│   │   │   ├── storage/database.ts ✅ SQLite — 12 tables
│   │   │   └── sync/syncService.ts ✅ Sync bidirectionnel 5min
│   │   ├── stores/authStore.ts     ✅ Zustand — session JWT
│   │   ├── hooks/useSync.ts        ✅ Hook réseau + sync
│   │   ├── components/ui/          ✅ 9 composants design system
│   │   └── utils/theme.ts          ✅ Palette, typo, spacing
│   ├── package.json
│   └── .env.example
│
├── migrations/             ← SQL PostgreSQL — ordre d'exécution strict
│   ├── 000_extensions.sql          ✅ uuid-ossp, pgcrypto
│   ├── 000_extensions_types.sql    ✅ ENUM types
│   ├── 001_domaine1_identites.sql  ✅ etablissements, annees_scolaires
│   ├── 002_domaine2_acteurs.sql    ✅ utilisateurs, eleves, enseignants, parents
│   ├── 003_domaine3_pedagogie.sql  ✅ matieres, evaluations, notes, bulletins
│   ├── 004_domaine4_vie_scolaire.sql ✅ appels, presences, absences, EDT
│   ├── 005_domaine5_securite.sql   ✅ sessions, tokens, audit
│   ├── 006_donnees_reference.sql   ✅ seed données de référence
│   ├── 007_vues_et_fonctions.sql   ✅ vues calculées, fonctions PL/pgSQL
│   └── run_all_migrations.sql      ✅ Script d'exécution complet
│
└── dashboard/              ← Dashboard admin (HTML/CSS/JS vanilla — zéro dépendance NPM)
    ├── index.html          ✅ Structure HTML + scripts externes
    ├── login.html          ✅ Page de connexion (identifiant, mdp, code établissement)
    ├── css/
    │   └── style.css       ✅ Toute la feuille de style
    └── js/
        ├── config.js       ✅ API_BASE, TOKEN_KEY, USER_KEY
        ├── api.js          ✅ Fetch wrapper avec JWT, 401 redirect, ApiError
        ├── auth.js         ✅ login(), logout(), getUser(), requireAuth(), populateSidebar()
        ├── ui.js           ✅ toast(), openModal(), closeModal(), sparkline(), cn(), init2()
        ├── router.js       ✅ goto(), TITRES, PAGE_HOOKS, hash routing
        ├── data-mock.js    ✅ Données statiques + renderAll() + initCharts() + initEDT()
        ├── app.js          ✅ DOMContentLoaded init, auth check, sparklines, hash routing
        └── pages/
            ├── eleves.js       ✅ GET /eleves (paginé, recherche, filtre classe)
            ├── classes.js      ✅ GET /classes (grille avec moyennes, présence)
            ├── enseignants.js  ✅ GET /enseignants (tableau)
            ├── notes.js        ✅ GET /evaluations
            ├── bulletins.js    ✅ GET /bulletins
            ├── absences.js     ✅ GET /presences/absences
            ├── edt.js          ✅ GET /enseignants/moi/edt
            ├── alertes.js      ✅ GET /evenements
            └── parametres.js   ✅ GET/PUT /etablissement
```

---

## ✅ État d'avancement — Backend 100% implémenté

Tous les 9 domaines sont **implémentés et testés** (60/60 tests passent).

| # | Domaine | Routes | Lignes | Tests |
|---|---------|--------|--------|-------|
| 1 | enseignants | 4 endpoints (classes, EDT, affectations, profil) | 370 | 7 ✅ |
| 2 | parents | 5 endpoints (enfants, tableau de bord, notes, absences, bulletins) | 335 | 11 ✅ |
| 3 | moyennes | 4 endpoints (classe, élève, calcul batch, classement) | 323 | 4 ✅ |
| 4 | bulletins | 5 endpoints (liste, détail, génération, validation, download) | 245 | 7 ✅ |
| 5 | configs | 4 endpoints (coefficients GET/PUT, matières GET/POST) | 190 | 5 ✅ |
| 6 | edt | 5 endpoints (classe, enseignant, CRUD créneaux) | 265 | 8 ✅ |
| 7 | discipline | 4 endpoints (sanctions CRUD, dossier élève) | 232 | 5 ✅ |
| 8 | evenements | 4 endpoints (agenda CRUD) | 183 | 6 ✅ |
| 9 | securite | 4 endpoints (audit, sessions, blocage) | 180 | 7 ✅ |
| **Total** | | **39 endpoints** | **2 323** | **60/60** |

### 📖 Documentation API

- **Swagger UI** : `http://localhost:3010/api/docs`
- **Spec OpenAPI JSON** : `http://localhost:3010/api/docs.json`
- **Format** : OpenAPI 3.0.3, 14 tags, 60 endpoints documentés (dont domaines préexistants)

### 🔄 CI/CD — GitHub Actions

- **Workflow** : `.github/workflows/ci.yml`
- **Déclenché sur** : push `main`/`develop` + pull requests vers `main`
- **Jobs** :
  1. `backend-lint-test` — ESLint + Jest (60 tests, couverture)
  2. `backend-docker` — Build image Docker (après tests)
  3. `mobile-typecheck` — TypeScript `tsc --noEmit`
- **ESLint** : `backend/.eslintrc.js` — 0 erreurs, <50 warnings

### 🖥️ Dashboard — Architecture

- **Approche** : HTML/CSS/JS vanilla, zéro framework, zéro build step
- **Auth** : JWT stocké dans `localStorage`, redirect vers `login.html` si 401
- **API client** : `js/api.js` — fetch wrapper avec token automatique
- **Fallback mock** : Chaque page tente l'API, fallback sur `data-mock.js` si le backend est down
- **Routing** : Hash-based (`#eleves`, `#notes`, etc.) via `js/router.js`
- **Pages dynamiques** : Chaque `js/pages/*.js` s'enregistre dans `PAGE_HOOKS[nomPage]`
- **Serveur dev** : `npx serve dashboard -l 3001` (ou via `preview_start dashboard`)

### 🔜 Travail restant

- [x] CI/CD pipeline (GitHub Actions : lint, tests, build Docker)
- [x] Dashboard : extraction monolithe → fichiers modulaires
- [x] Dashboard : authentification + login page
- [x] Dashboard : connexion 10 pages aux endpoints API (avec fallback mock)
- [ ] Build mobile EAS + déploiement serveur (PM2 + Nginx)
- [ ] Tests d'intégration avec vraie base PostgreSQL
- [ ] Optimisations performance (index SQL, cache Redis stratégique)
- [ ] Monitoring (health checks avancés, métriques, alertes)

---

## 🏗️ Conventions de code — Backend

### Structure d'un domaine complet
Prends exemple sur `backend/src/domains/04-vie-scolaire/appels/appels.routes.js` qui est la référence.

**Pattern à respecter :**
```javascript
'use strict';
const express = require('express');
const router  = express.Router();
const { pool } = require('../../../infrastructure/database/pool');
const { authenticate, requireRole } = require('../../../middleware/auth');
const { validate } = require('../../../middleware/validate');
const { z } = require('zod');

// Schémas de validation Zod
const schemaCreer = z.object({ ... });

// Routes
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`SELECT ...`, [req.user.etablissement_id]);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
```

**Règles importantes :**
- Toujours `authenticate` sur les routes protégées
- Toujours filtrer par `etablissement_id` — jamais de données cross-établissement
- Validation Zod sur tous les body POST/PUT
- Réponses JSON : `{ success: true, data: ... }` ou `{ success: false, error: ... }`
- Erreurs via `next(err)` pour le middleware centralisé

### Requêtes SQL
- Utiliser `pool.query()` du fichier `infrastructure/database/pool.js`
- Paramètres positionnels `$1, $2...` (jamais de concaténation de chaîne)
- Transactions avec `pool.connect()` + `client.query('BEGIN')` pour les opérations multi-tables

### Notifications
```javascript
const { envoyerNotification } = require('../../../infrastructure/notifications/notif.service');
await envoyerNotification({ userId, canal: 'whatsapp', message: '...' });
```

---

## 📱 Conventions de code — Mobile

### Accès à la base de données locale
```typescript
import { getDB } from '../../../src/services/storage/database';
const db = getDB();
const rows = await db.getAllAsync('SELECT * FROM eleves WHERE ...', [param]);
```

### Appels API
```typescript
import { enseignantApi, parentApi } from '../../../src/services/api/client';
// Toujours dans un try/catch — l'API peut être hors ligne
try {
  const data = await enseignantApi.getElevesClasse(classeId);
} catch (e) {
  // Fallback silencieux — les données locales sont déjà affichées
}
```

### Couleurs et design
```typescript
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
// Ne jamais hardcoder de couleur hex — toujours utiliser Colors.xxx
```

### Ajout d'un nouvel écran
1. Créer le fichier dans `app/(app)/enseignant/` ou `app/(app)/parent/`
2. Ajouter le lien dans le layout correspondant (`_layout.tsx`)
3. Utiliser `<Entete>` pour le header, `<Carte>` pour les conteneurs
4. Pull-to-refresh : `syncService.syncComplete()`

---

## 🗄️ Schéma de base de données — Tables clés

```sql
-- Hiérarchie principale
etablissements → annees_scolaires → classes → inscriptions → utilisateurs

-- Pédagogie
affectations (enseignant × matiere × classe)
  → evaluations → notes → moyennes → bulletins

-- Vie scolaire
edt_creneaux (classe × matiere × horaire)
appels → presences → absences (vue calculée)

-- Notifications
preferences_notifications (canal par utilisateur)
journal_notifications (historique SMS/WhatsApp)
operations_sync (file FIFO mobile → serveur)
```

**Colonnes présentes sur toutes les tables :**
- `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`
- `etablissement_id UUID NOT NULL` ← **filtre de sécurité obligatoire**
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`
- `deleted_at TIMESTAMPTZ` ← soft delete

---

## ⚙️ Commandes utiles

```bash
# ── DÉVELOPPEMENT ────────────────────────────────────────────────

# Démarrer tout l'environnement (PostgreSQL + Redis + API)
docker-compose up -d

# Backend en mode watch
cd backend && npm run dev

# Mobile en mode Expo
cd mobile && npx expo start

# Exécuter les migrations
psql $DATABASE_URL -f migrations/run_all_migrations.sql

# ── LINT & TESTS ─────────────────────────────────────────────────

cd backend && npm run lint           # ESLint — vérification
cd backend && npm run lint:fix       # ESLint — auto-correction
cd backend && npm test               # Jest — tous les tests
cd backend && npm run test:watch     # Watch mode
cd backend && npm run test:coverage  # Couverture

# ── BASE DE DONNÉES ──────────────────────────────────────────────

# Connexion directe
docker exec -it ecolemanager_postgres psql -U ecolemanager -d ecolemanager_dev

# Reset complet (⚠️ supprime toutes les données)
docker-compose down -v && docker-compose up -d
sleep 5 && psql $DATABASE_URL -f migrations/run_all_migrations.sql

# ── DÉPLOIEMENT ──────────────────────────────────────────────────

# Build mobile Android APK (test)
cd mobile && eas build --platform android --profile preview

# Build mobile Android AAB (Play Store)
cd mobile && eas build --platform android --profile production

# Deploy backend (depuis le serveur)
git pull && npm ci && pm2 restart ecolemanager-api
```

---

## 🔑 Variables d'environnement

Voir `.env.example` à la racine, `backend/.env.example` et `mobile/.env.example`.

**Variables critiques à configurer en premier :**
```
DATABASE_URL          → PostgreSQL connection string
REDIS_URL             → Redis connection string
JWT_SECRET            → min 32 caractères aléatoires
AT_API_KEY            → Africa's Talking (SMS)
META_WA_TOKEN         → WhatsApp Business API
```

---

## 🌍 Contexte pays et localisation

| Pays | Indicatif | Opérateurs SMS | Monnaie |
|------|-----------|----------------|---------|
| Sénégal | +221 | Orange, Free, Expresso | XOF |
| Côte d'Ivoire | +225 | MTN, Orange, Moov | XOF |
| Mali | +223 | Orange, Telecel | XOF |
| Burkina Faso | +226 | Orange, Telecel | XOF |
| Guinée | +224 | Orange, MTN | GNF |
| Cameroun | +237 | MTN, Orange | XAF |

**Validation numéros :** utiliser `libphonenumber-js` côté backend.
**Fuseaux horaires :** tous sur `Africa/Dakar` (UTC+0) ou `Africa/Abidjan`.

---

## 🚦 Règles de sécurité

1. **Multi-tenant strict** : chaque requête SQL doit filtrer par `etablissement_id = $1`
2. **JWT** : vérification dans `middleware/auth.js` — ne pas dupliquer la logique
3. **Rôles** : `directeur > censeur > enseignant > parent` — utiliser `requireRole()`
4. **Rate limiting** : déjà configuré dans `middleware/rateLimiter.js`
5. **Données sensibles** : ne jamais logger de mots de passe, tokens ou numéros de CB

---

## 📋 Ordre de développement — Progression

| Étape | Tâche | Statut |
|-------|-------|--------|
| 1 | `docker-compose up -d` + migrations SQL | ✅ |
| 2 | Tester l'auth (`POST /api/v1/auth/connexion`) | ✅ |
| 3 | Implémenter `enseignants.routes.js` | ✅ |
| 4 | Implémenter `parents.routes.js` | ✅ |
| 5 | Implémenter `moyennes.routes.js` | ✅ |
| 6 | Implémenter `bulletins.routes.js` | ✅ |
| 7 | Implémenter `edt.routes.js` | ✅ |
| 8 | Implémenter `configs.routes.js` | ✅ |
| 9 | Implémenter `discipline.routes.js` + `evenements.routes.js` | ✅ |
| 10 | Implémenter `securite.routes.js` | ✅ |
| 11 | Tests unitaires (60/60 Jest) | ✅ |
| 12 | Documentation API (Swagger OpenAPI 3.0) | ✅ |
| 13 | CI/CD GitHub Actions (lint, tests, Docker build) | ✅ |
| 14 | Build mobile EAS + déploiement serveur | 🔜 |

---

## 📚 Documents de référence

| Document | Contenu |
|----------|---------|
| `docs/architecture_technique.docx` | Architecture complète (35 pages) |
| `docs/guide_migrations_sql.docx` | Schéma BD détaillé (20 pages) |
| `docs/guide_mobile.docx` | Guide technique mobile (10 chapitres) |
| `docs/strategie_sms_whatsapp.docx` | Intégration SMS/WhatsApp (13 pages) |
| `docs/etude_terrain.pptx` | Étude terrain Afrique de l'Ouest (11 slides) |
