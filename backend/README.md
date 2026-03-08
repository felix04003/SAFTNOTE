# API Gestion Scolaire — Afrique de l'Ouest Francophone

Backend Node.js (Express) pour le système de gestion des notes et de la vie scolaire.

## Démarrage rapide

```bash
# 1. Copier et configurer les variables d'environnement
cp .env.example .env
# Éditer .env : DATABASE_URL, AT_API_KEY, META_WA_ACCESS_TOKEN, JWT_SECRET

# 2. Démarrer les services (PostgreSQL, Redis, MinIO)
docker compose up -d postgres redis minio

# 3. Appliquer les migrations SQL
docker exec -i ecole_postgres psql -U ecole_user -d ecole_manager \
  < migrations/run_all_migrations.sql

# 4. Installer les dépendances
npm install

# 5. Démarrer le serveur
npm run dev
```

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
