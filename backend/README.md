# API Gestion Scolaire — Afrique de l'Ouest Francophone

Backend Node.js (Express) pour le système de gestion des notes et de la vie scolaire.

## Démarrage rapide

```bash
# 1. Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, AT_API_KEY, META_WA_ACCESS_TOKEN, JWT_SECRET

# 2. Démarrer les services (PostgreSQL, Redis, MinIO)
docker compose up -d postgres redis minio

# 3. Installer les dépendances
npm install

# 4. Appliquer les migrations SQL (dossier migrations/ à la racine du dépôt)
npm run migrate

# 5. (Dev uniquement) Injecter les comptes de test E2E — refusé si NODE_ENV=production
npm run seed:test

# 6. Démarrer le serveur
npm run dev
```

## Migrations

Un seul dossier de migrations : `migrations/` à la racine du dépôt (000 → 015),
appliqué partout — dev, Docker, Render — par le runner idempotent
`src/utils/migrate.js` (table de suivi `_migrations`).

```bash
npm run migrate      # applique les migrations manquantes ; relance = « à jour »
npm run seed:test    # backend/tests/seeds/*.sql : établissement TEST_LBD,
                     # directeur, enseignant, parent, super_admin (E2E Playwright)
```

- Le runner accepte `DATABASE_URL` ou les variables `POSTGRES_HOST/PORT/DB/USER/PASSWORD`.
- `MIGRATIONS_DIR` permet de forcer le dossier de migrations.
- Une base créée historiquement via `migrations/run_all_migrations.sql` (table
  `schema_migrations`) est détectée : les migrations déjà appliquées sont
  reportées dans `_migrations` et ne sont pas rejouées.
- Les seeds ne sont **jamais** appliqués en production (`NODE_ENV=production` → sortie en erreur).
- **Toute migration doit être idempotente** (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
  `DROP ... IF EXISTS`) : le suivi se fait par nom de fichier, donc renommer ou
  renuméroter une migration déjà appliquée la fait rejouer sous son nouveau nom.

## Architecture

```
src/
├── app.js                          Point d'entrée Express
├── domains/
│   ├── 01-identites/               Établissements, années, classes
│   ├── 02-acteurs/
│   │   ├── auth/                   Connexion mot de passe + OTP SMS
│   │   ├── eleves/                 CRUD élèves + tableau de bord
│   │   ├── parents/                Gestion tuteurs
│   │   └── enseignants/            Affectations
│   ├── 03-pedagogie/
│   │   ├── evaluations/            Devoirs, compositions, saisie notes
│   │   ├── moyennes/               Calcul et cache
│   │   ├── bulletins/              Génération PDF
│   │   └── configs/                Coefficients, grilles
│   ├── 04-vie-scolaire/
│   │   ├── appels/                 Appels + présences (→ notifications)
│   │   ├── edt/                    Emploi du temps
│   │   ├── discipline/             Incidents, sanctions
│   │   └── evenements/             Sorties, autorisations
│   ├── 05-securite/                Permissions, sessions, audit
│   └── sync.routes.js              Synchronisation offline-first
├── infrastructure/
│   ├── database/pool.js            Knex + PostgreSQL
│   ├── cache/redis.js              Redis + helpers cache
│   ├── queue/bullmq.js             Queues BullMQ
│   └── notifications/
│       ├── sms.service.js          Africa's Talking
│       └── whatsapp.service.js     Meta Cloud API
├── middleware/
│   ├── auth.middleware.js          Vérification JWT + session BD
│   ├── permission.middleware.js    verifier_permission() PostgreSQL
│   ├── validate.middleware.js      Validation Zod
│   └── error.middleware.js         Réponse erreur unifiée
├── workers/
│   ├── notification.worker.js      SMS + WhatsApp
│   ├── calcul-moyennes.worker.js   PL/pgSQL
│   └── generation-bulletins.worker.js  Puppeteer PDF
└── utils/
    ├── ApiError.js                 Erreurs métier avec codes HTTP
    ├── logger.js                   Winston
    └── reponse.js                  Helpers réponse JSON uniforme
```

## Format des réponses

```json
// Succès
{ "succes": true, "data": {...}, "meta": { "total": 42 } }

// Erreur
{ "succes": false, "erreur": "Message", "code": "CODE_ERREUR", "details": [...] }
```

## Authentification

- **Enseignants / Admins** : `POST /api/v1/auth/connexion` → JWT Bearer Token
- **Parents** : `POST /api/v1/auth/otp/demander` → `POST /api/v1/auth/otp/valider` → JWT

## Flux notifications

```
Appel saisie → presences.statut='absent'
→ enqueuerNotification() → Queue BullMQ 'notifications'
→ notification.worker.js → vérif préférences parent
→ WhatsApp (Meta API) ou SMS (Africa's Talking)
→ journal_notifications
```

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Clé secrète JWT (min 32 chars) |
| `AT_API_KEY` | Clé API Africa's Talking |
| `AT_USERNAME` | Username Africa's Talking |
| `META_WA_ACCESS_TOKEN` | Token Meta Cloud API |
| `META_WA_PHONE_NUMBER_ID` | ID numéro WhatsApp Business |
