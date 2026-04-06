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
