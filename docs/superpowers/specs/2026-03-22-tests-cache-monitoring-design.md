# Design — Tests d'intégration, Cache Redis, Monitoring

**Date :** 2026-03-22
**Approche retenue :** séquentielle (index → cache → tests → monitoring)

---

## 1. Index SQL

### Ce qui change
- Ajouter `008_index_performance.sql` dans `run_all_migrations.sql` après la migration 007
- Ajouter `008_index_performance.sql` dans la liste des migrations de `tests/integration/globalSetup.js`
- Dans `globalSetup.js`, exécuter les index **sans** `CONCURRENTLY` (interdit dans une transaction PostgreSQL)

### Fichier concerné
- `migrations/008_index_performance.sql` — déjà créé, 12 index de performance

---

## 2. Cache Redis

### Stratégie
Utiliser `getOrSet()` et `invalidatePattern()` déjà disponibles dans `src/infrastructure/cache/redis.js`.
Fallback silencieux : si Redis est indisponible, `try/catch` → requête directe PostgreSQL.

### 8 routes à mettre en cache

| Route | Clé Redis | TTL | Invalidé quand |
|-------|-----------|-----|----------------|
| `GET /classes` | `classes:{etablissement_id}` | 10 min | POST/DELETE classe |
| `GET /classes/:id/eleves` | `classe_eleves:{classe_id}` | 10 min | POST/DELETE élève |
| `GET /enseignants/moi/edt` | `edt_ens:{utilisateur_id}` | 1h | POST/PUT/DELETE créneau EDT |
| `GET /classes/:id/edt` | `edt_classe:{classe_id}` | 1h | POST/PUT/DELETE créneau EDT |
| `GET /auth/profil` | `profil:{utilisateur_id}` | 1h | PUT profil |
| `GET /configs/coefficients` | `coefficients:{etablissement_id}` | 30 min | PUT coefficients |
| `GET /configs/matieres` | `matieres:{etablissement_id}` | 30 min | POST matière |
| `GET /moyennes/classe/:id` | `moyennes_classe:{classe_id}:{periode_id}` | 5 min | POST calcul moyennes |

### Pattern d'implémentation dans chaque route

```javascript
// GET avec cache
router.get('/classes', authenticate, async (req, res, next) => {
  try {
    const key = `classes:${req.user.etablissement_id}`;
    const data = await getOrSet(key, async () => {
      const { rows } = await pool.query(`SELECT ...`, [req.user.etablissement_id]);
      return rows;
    }, 600).catch(() => null); // fallback si Redis down

    if (data) return res.json({ success: true, data });

    // fallback direct
    const { rows } = await pool.query(`SELECT ...`, [req.user.etablissement_id]);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST/PUT/DELETE avec invalidation
router.post('/classes', authenticate, async (req, res, next) => {
  try {
    // ... logique métier ...
    await invalidatePattern(`classes:${req.user.etablissement_id}`).catch(() => {});
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
});
```

---

## 3. Tests d'intégration

### Principe
- Aucun mock de base de données — tous les tests utilisent `ecole_manager_test` (vraie PostgreSQL)
- Infrastructure existante conservée : `globalSetup.js`, `globalTeardown.js`, `helpers.js`, `jest.integration.config.js`
- Tests unitaires existants dans `tests/domains/` conservés (CI rapide)
- Commande séparée : `npm run test:integration`

### Fichiers existants (à conserver, éventuellement compléter)
- `auth.integration.test.js`
- `eleves.integration.test.js`
- `classes.integration.test.js`

### 6 nouveaux fichiers à créer

**`enseignants.integration.test.js`**
- GET `/enseignants/moi/classes` — liste les classes affectées
- GET `/enseignants/moi/edt` — emploi du temps
- GET `/enseignants/moi/affectations` — matières affectées
- Vérification filtre `etablissement_id`

**`notes.integration.test.js`**
- POST `/evaluations` — créer une évaluation
- POST `/evaluations/:id/notes` — saisir des notes
- GET `/evaluations` — liste filtrée par établissement
- Isolation multi-tenant : un enseignant d'un établissement A ne peut pas saisir des notes dans un établissement B

**`appels.integration.test.js`**
- POST `/appels` — créer un appel
- GET `/appels/:id/presences` — grille de présence
- PUT `/appels/:id/presences` — marquer présences
- Contrainte d'unicité : impossible de faire deux appels sur le même créneau/date

**`discipline.integration.test.js`**
- POST `/sanctions` — créer une sanction
- GET `/sanctions` — liste filtrée par classe
- GET `/eleves/:id/dossier-disciplinaire` — dossier complet
- Filtre `etablissement_id` strict

**`parents.integration.test.js`**
- GET `/parents/moi/enfants` — liste des enfants liés
- GET `/parents/moi/enfants/:id/notes` — notes d'un enfant
- GET `/parents/moi/enfants/:id/absences` — absences d'un enfant
- Un parent ne voit que ses enfants (pas ceux d'un autre parent)

**`multitenant.integration.test.js`** *(le plus important)*
- Setup : créer 2 établissements distincts avec leurs données
- Vérifier sur 5 endpoints que l'établissement A ne peut jamais voir les données de B :
  - GET `/eleves`
  - GET `/classes`
  - GET `/evaluations`
  - GET `/sanctions`
  - GET `/presences/absences`
- Un token de l'établissement A renvoyé sur une ressource de l'établissement B → 404 ou données vides

---

## 4. Monitoring & Alertes

### Variables d'environnement à ajouter (`.env.example`)
```
MONITORING_TOKEN=          # Bearer token pour /health/deep et /metrics
ADMIN_PHONE=               # ex: +221770000000
MONITORING_INTERVAL_MS=120000   # intervalle vérification (2 min par défaut)
MONITORING_COOLDOWN_MS=900000   # anti-spam : 1 alerte max / 15 min par type
```

### Protection des endpoints sensibles
- `GET /health/deep` et `GET /metrics` : middleware `requireMonitoringToken`
- Sans `Authorization: Bearer {MONITORING_TOKEN}` → 401
- `GET /health` reste public (load balancer)

### `src/infrastructure/monitoring/monitoring.service.js`
- `startMonitoring()` : `setInterval` toutes les `MONITORING_INTERVAL_MS`
- À chaque tick : appel interne à `GET /health/deep`
- Si `status === 'degraded'` ou erreur réseau → `envoyerAlerteSMS()`
- `envoyerAlerteSMS()` : utilise `sms.service.js` existant, envoie à `ADMIN_PHONE`
- Cooldown par type (`postgres_down`, `redis_down`) : stocké en mémoire, évite les rafales
- Démarré dans `app.js` uniquement si `NODE_ENV === 'production'`

### Surveillance sync mobile
- Dans `sync.routes.js` : logger les erreurs de sync avec Winston (`logger.error`)
- Contexte loggé : `{ etablissement_id, nb_operations, nb_echecs, timestamp }`
- Pas d'alerte SMS — logs structurés dans `logs/error.log` en production

---

## Ordre d'implémentation

1. **Index SQL** — `run_all_migrations.sql` + `globalSetup.js` (5 min)
2. **Cache Redis** — 8 routes modifiées (routes + invalidation)
3. **Tests d'intégration** — 6 nouveaux fichiers + vérification des 3 existants
4. **Monitoring** — middleware token + `monitoring.service.js` + `.env.example`
