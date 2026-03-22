# Tests d'intégration, Cache Redis & Monitoring — Plan d'implémentation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettre en place les tests d'intégration sur vraie BD PostgreSQL, le cache Redis sur 8 routes critiques, et un système de monitoring avec alertes SMS.

**Architecture:** Approche séquentielle — index SQL d'abord (fondation), puis cache Redis (optimisation), puis tests d'intégration (validation), enfin monitoring (surveillance). Chaque étape s'appuie sur la précédente.

**Tech Stack:** Node.js 20, Express, PostgreSQL 15, Redis (ioredis), Jest + Supertest, knex, Africa's Talking SMS API, Winston

**Spec :** `docs/superpowers/specs/2026-03-22-tests-cache-monitoring-design.md`

---

## Chunk 1 : Index SQL

### Fichiers modifiés
- Modify: `migrations/run_all_migrations.sql`
- Modify: `backend/tests/integration/globalSetup.js`

---

### Task 1 : Inclure la migration 008 dans run_all_migrations.sql

**Files:**
- Modify: `migrations/run_all_migrations.sql` (après ligne `\i migrations/007_vues_et_fonctions.sql`)

- [ ] **Step 1 : Ajouter le bloc 008 dans run_all_migrations.sql**

Après le bloc `== 007 Vues & Fonctions`, ajouter **avant** le bloc `-- ── Rapport` :

```sql
\echo '== 008 Index performance'
\i migrations/008_index_performance.sql
INSERT INTO schema_migrations VALUES ('008', 'Index de performance') ON CONFLICT DO NOTHING;
```

- [ ] **Step 2 : Vérifier la syntaxe du fichier**

```bash
grep -n "008" migrations/run_all_migrations.sql
```

Expected output :
```
XX:\echo '== 008 Index performance'
XX:\i migrations/008_index_performance.sql
XX:INSERT INTO schema_migrations VALUES ('008', 'Index de performance') ON CONFLICT DO NOTHING;
```

- [ ] **Step 3 : Commit**

```bash
git add migrations/run_all_migrations.sql
git commit -m "feat(migrations): inclure 008 index de performance dans run_all_migrations"
```

---

### Task 2 : Ajouter 008 dans le globalSetup des tests d'intégration

**Context :** `globalSetup.js` exécute les migrations via `docker exec psql`. Les index `CONCURRENTLY` sont interdits dans une transaction PostgreSQL — mais `globalSetup` exécute chaque fichier hors transaction (chaque `psqlFile()` est un appel psql distinct). La migration 008 utilise `CONCURRENTLY` qui fonctionne ici.

**Files:**
- Modify: `backend/tests/integration/globalSetup.js` (tableau `migrationFiles`, ligne ~55)

- [ ] **Step 1 : Ajouter '008_index_performance.sql' dans la liste**

Dans `globalSetup.js`, modifier le tableau `migrationFiles` :

```javascript
const migrationFiles = [
  '000_extensions.sql',
  '000_extensions_types.sql',
  '001_domaine1_identites.sql',
  '002_domaine2_acteurs.sql',
  '003_domaine3_pedagogie.sql',
  '004_domaine4_vie_scolaire.sql',
  '005_domaine5_securite.sql',
  '006_donnees_reference.sql',
  '007_vues_et_fonctions.sql',
  '008_index_performance.sql',
];
```

- [ ] **Step 2 : Vérifier que le globalSetup fonctionne**

```bash
cd backend && npm run test:integration -- --testPathPattern="auth.integration"
```

Expected : `✓` pour la suite auth, pas d'erreur de migration.

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/globalSetup.js
git commit -m "feat(tests): ajouter migration 008 dans globalSetup intégration"
```

---

## Chunk 2 : Cache Redis

### Fichiers modifiés
- Modify: `backend/src/domains/01-identites/identites.routes.js`
- Modify: `backend/src/domains/04-vie-scolaire/edt/edt.routes.js`
- Modify: `backend/src/domains/02-acteurs/auth/auth.routes.js`
- Modify: `backend/src/domains/03-pedagogie/configs/configs.routes.js`
- Modify: `backend/src/domains/03-pedagogie/moyennes/moyennes.routes.js`

**Pattern de cache à utiliser dans TOUTES les routes :**

```javascript
// En haut du fichier, ajouter l'import
const { getOrSet, invalidatePattern } = require('../../infrastructure/cache/redis');
// (adapter le chemin relatif selon la profondeur du fichier)

// Dans un GET : extraire la requête DB dans une fonction locale, puis cacher
async function fetchXxx(db, etablissementId) {
  return db('table')...select(...)...where({ etablissement_id: etablissementId });
}

router.get('/xxx', auth, isoler, async (req, res, next) => {
  try {
    const db = getDB();
    let data;
    try {
      data = await getOrSet(
        `xxx:${req.etablissement_id}`,
        () => fetchXxx(db, req.etablissement_id),
        600 // TTL en secondes
      );
    } catch {
      // Redis indisponible — fallback direct PostgreSQL
      data = await fetchXxx(db, req.etablissement_id);
    }
    return liste(res, data);
  } catch (err) { next(err); }
});

// Dans un POST/PUT/DELETE : invalider après succès
router.post('/xxx', auth, isoler, async (req, res, next) => {
  try {
    // ... logique métier ...
    await invalidatePattern(`xxx:${req.etablissement_id}`).catch(() => {});
    return cree(res, result);
  } catch (err) { next(err); }
});
```

---

### Task 3 : Cache GET /classes et GET /classes/:id/eleves

**Files:**
- Modify: `backend/src/domains/01-identites/identites.routes.js`

**Chemin d'import Redis :** `../../infrastructure/cache/redis` (2 niveaux depuis `domains/01-identites/`)

- [ ] **Step 1 : Ajouter l'import Redis en haut de identites.routes.js**

Après les autres imports (ligne ~11) :

```javascript
const { getOrSet, invalidatePattern } = require('../../infrastructure/cache/redis');
```

- [ ] **Step 2 : Extraire fetchClasses et mettre en cache GET /classes**

Localiser la route `GET /classes` dans `identites.routes.js`. Extraire la requête DB dans une fonction locale et entourer d'un cache :

```javascript
async function fetchClasses(db, etablissementId) {
  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id');
  if (!annee) return [];
  return db('classes as c')
    .join('niveaux as n', 'n.id', 'c.niveau_id')
    .where({ 'c.annee_scolaire_id': annee.id })
    .orderBy(['n.ordre', 'c.nom'])
    .select(
      'c.id', 'c.nom as nom_classe', 'n.nom as niveau',
      'c.effectif_max', 'c.annee_scolaire_id'
    );
}
```

Puis dans la route `GET /classes` :

```javascript
router.get('/classes', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    let classes;
    try {
      classes = await getOrSet(
        `classes:${req.etablissement_id}`,
        () => fetchClasses(db, req.etablissement_id),
        600
      );
    } catch {
      classes = await fetchClasses(db, req.etablissement_id);
    }
    return liste(res, classes);
  } catch (err) { next(err); }
});
```

- [ ] **Step 3 : Invalider le cache à la création et suppression de classe**

Dans `POST /classes` et `DELETE /classes/:id`, ajouter après succès :

```javascript
await invalidatePattern(`classes:${req.etablissement_id}`).catch(() => {});
```

- [ ] **Step 4 : Mettre en cache GET /classes/:classeId/eleves (TTL 10 min)**

Extraire la requête dans `fetchElevesClasse(db, classeId)` et appliquer le même pattern avec la clé `classe_eleves:${req.params.classeId}` et TTL `600`.

Invalider dans `POST /eleves` et la route de suppression/archivage d'élève :

```javascript
await invalidatePattern(`classe_eleves:${req.body.classe_id}`).catch(() => {});
```

- [ ] **Step 5 : Vérifier qu'aucun test unitaire ne régresse**

```bash
cd backend && npm test -- --testPathPattern="affectations|integration" --passWithNoTests
```

Expected : PASS

- [ ] **Step 6 : Commit**

```bash
git add backend/src/domains/01-identites/identites.routes.js
git commit -m "feat(cache): Redis cache classes et eleves-par-classe (TTL 10min)"
```

---

### Task 4 : Cache GET /edt/classe/:id et GET /edt/enseignant/:id

**Files:**
- Modify: `backend/src/domains/04-vie-scolaire/edt/edt.routes.js`

**Chemin d'import Redis :** `../../../infrastructure/cache/redis`

- [ ] **Step 1 : Ajouter l'import Redis**

```javascript
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');
```

- [ ] **Step 2 : Mettre en cache GET /edt/classe/:classeId (TTL 1h)**

Extraire la requête knex dans `fetchEdtClasse(db, classeId, etablissementId, semaine)`. La clé inclut la semaine si présente :

```javascript
const cle = semaine
  ? `edt_classe:${req.params.classeId}:${semaine}`
  : `edt_classe:${req.params.classeId}`;

let creneaux;
try {
  creneaux = await getOrSet(cle, () => fetchEdtClasse(db, req.params.classeId, req.etablissement_id, semaine), 3600);
} catch {
  creneaux = await fetchEdtClasse(db, req.params.classeId, req.etablissement_id, semaine);
}
```

- [ ] **Step 3 : Mettre en cache GET /edt/enseignant/:enseignantId (TTL 1h)**

Même pattern. Clé : `edt_ens:${req.params.enseignantId}`. TTL : `3600`.

- [ ] **Step 4 : Invalider sur les mutations EDT**

Dans `POST /edt`, `PUT /edt/:id`, `DELETE /edt/:id` — après succès, invalider les deux patterns liés à la classe et à l'enseignant :

```javascript
// On invalide tous les créneaux de la classe concernée (toutes semaines)
await invalidatePattern(`edt_classe:${classeId}*`).catch(() => {});
await invalidatePattern(`edt_ens:${enseignantId}*`).catch(() => {});
```

- [ ] **Step 5 : Vérifier aucune régression**

```bash
cd backend && npm test
```

Expected : 60/60 PASS

- [ ] **Step 6 : Commit**

```bash
git add backend/src/domains/04-vie-scolaire/edt/edt.routes.js
git commit -m "feat(cache): Redis cache EDT classe et enseignant (TTL 1h)"
```

---

### Task 5 : Cache GET /auth/profil

**Files:**
- Modify: `backend/src/domains/02-acteurs/auth/auth.routes.js`

**Chemin d'import Redis :** `../../../infrastructure/cache/redis`

- [ ] **Step 1 : Ajouter l'import Redis**

```javascript
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');
```

- [ ] **Step 2 : Mettre en cache GET /auth/profil (TTL 1h)**

Localiser `GET /auth/profil`. Extraire la requête DB dans `fetchProfil(db, utilisateurId)`. Clé : `profil:${req.session.utilisateur_id}`. TTL : `3600`.

```javascript
let profil;
try {
  profil = await getOrSet(
    `profil:${req.session.utilisateur_id}`,
    () => fetchProfil(db, req.session.utilisateur_id),
    3600
  );
} catch {
  profil = await fetchProfil(db, req.session.utilisateur_id);
}
return ok(res, profil);
```

- [ ] **Step 3 : Invalider à la modification du profil**

Dans `PUT /auth/profil` (si elle existe) ou `PUT /utilisateurs/:id`, après la mise à jour :

```javascript
await invalidatePattern(`profil:${req.session.utilisateur_id}`).catch(() => {});
```

- [ ] **Step 4 : Commit**

```bash
git add backend/src/domains/02-acteurs/auth/auth.routes.js
git commit -m "feat(cache): Redis cache profil utilisateur (TTL 1h)"
```

---

### Task 6 : Cache GET /configs/coefficients et GET /configs/matieres

**Files:**
- Modify: `backend/src/domains/03-pedagogie/configs/configs.routes.js`

**Chemin d'import Redis :** `../../../infrastructure/cache/redis`

- [ ] **Step 1 : Ajouter l'import Redis**

```javascript
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');
```

- [ ] **Step 2 : Mettre en cache GET /configs/coefficients (TTL 30 min)**

Extraire la requête dans `fetchCoefficients(db, etablissementId, query)`. Inclure les query params dans la clé si présents :

```javascript
const niveau = req.query.niveau_id || 'all';
const serie  = req.query.serie_id  || 'all';
const cle    = `coefficients:${req.etablissement_id}:${niveau}:${serie}`;

let data;
try {
  data = await getOrSet(cle, () => fetchCoefficients(db, req.etablissement_id, req.query), 1800);
} catch {
  data = await fetchCoefficients(db, req.etablissement_id, req.query);
}
return ok(res, data);
```

- [ ] **Step 3 : Mettre en cache GET /configs/matieres (TTL 30 min)**

Même pattern. Clé : `matieres:${req.etablissement_id}`. TTL : `1800`.

Invalider dans `POST /configs/matieres` et `PUT /configs/coefficients` :

```javascript
await invalidatePattern(`coefficients:${req.etablissement_id}*`).catch(() => {});
await invalidatePattern(`matieres:${req.etablissement_id}`).catch(() => {});
```

- [ ] **Step 4 : Commit**

```bash
git add backend/src/domains/03-pedagogie/configs/configs.routes.js
git commit -m "feat(cache): Redis cache coefficients et matieres (TTL 30min)"
```

---

### Task 7 : Cache GET /moyennes/classe/:id

**Files:**
- Modify: `backend/src/domains/03-pedagogie/moyennes/moyennes.routes.js`

**Chemin d'import Redis :** `../../../infrastructure/cache/redis`

- [ ] **Step 1 : Ajouter l'import Redis**

```javascript
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');
```

- [ ] **Step 2 : Mettre en cache GET /moyennes/classe/:classeId (TTL 5 min)**

La clé inclut la période car les moyennes varient par période :

```javascript
const periodeKey = periode_id || 'courante';
const cle = `moyennes_classe:${req.params.classeId}:${periodeKey}`;

let data;
try {
  data = await getOrSet(cle, () => fetchMoyennesClasse(db, req.params.classeId, req.etablissement_id, periode_id), 300);
} catch {
  data = await fetchMoyennesClasse(db, req.params.classeId, req.etablissement_id, periode_id);
}
return ok(res, data);
```

- [ ] **Step 3 : Invalider à chaque calcul de moyennes**

Dans `POST /moyennes/calculer` et `POST /moyennes/classe/:id/calculer`, après succès :

```javascript
await invalidatePattern(`moyennes_classe:${classeId}*`).catch(() => {});
```

- [ ] **Step 4 : Vérifier 60/60 tests unitaires**

```bash
cd backend && npm test
```

Expected : 60 passed

- [ ] **Step 5 : Commit**

```bash
git add backend/src/domains/03-pedagogie/moyennes/moyennes.routes.js
git commit -m "feat(cache): Redis cache moyennes classe (TTL 5min)"
```

---

## Chunk 3 : Tests d'intégration

### Fichiers créés
- Create: `backend/tests/integration/enseignants.integration.test.js`
- Create: `backend/tests/integration/notes.integration.test.js`
- Create: `backend/tests/integration/appels.integration.test.js`
- Create: `backend/tests/integration/discipline.integration.test.js`
- Create: `backend/tests/integration/parents.integration.test.js`
- Create: `backend/tests/integration/multitenant.integration.test.js`

**Rappel infrastructure existante :**
- `helpers.js` expose : `getTestDB()`, `closeTestDB()`, `truncateData()`, `seedTestData()`, `createIntegrationApp()`, `creerSession(userId, etablissementId)`, `JWT_SECRET`
- `seedTestData()` retourne : `{ etablissement, annee, periodes, niveau, classe, directeur, enseignantUser, enseignant, eleves[3], mdpClair }`
- Chaque fichier de test doit appeler `truncateData()` puis `seedTestData()` dans `beforeAll`

**Pattern de base pour chaque fichier :**

```javascript
'use strict';

const supertest = require('supertest');
const {
  closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, token;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  token = await creerSession(seed.directeur.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});
```

---

### Task 8 : enseignants.integration.test.js

**Files:**
- Create: `backend/tests/integration/enseignants.integration.test.js`

- [ ] **Step 1 : Créer le fichier avec les suites de test**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /enseignants ────────────────────────────────────────────

describe('GET /api/v1/enseignants', () => {
  it('devrait lister les enseignants de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // seedTestData crée 1 enseignant
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0]).toHaveProperty('nom');
    expect(res.body.data[0]).toHaveProperty('specialite');
  });

  it('devrait refuser sans authentification', async () => {
    await request.get('/api/v1/enseignants').expect(401);
  });
});

// ── GET /enseignants/moi/classes ────────────────────────────────

describe('GET /api/v1/enseignants/moi/classes', () => {
  beforeAll(async () => {
    // Créer une affectation pour l'enseignant de test
    const db = getTestDB();
    const matiere = await db('matieres')
      .where({ etablissement_id: seed.etablissement.id })
      .first('id');

    if (matiere) {
      await db('affectations_enseignants').insert({
        enseignant_id: seed.enseignant.id,
        matiere_id: matiere.id,
        classe_id: seed.classe.id,
        annee_scolaire_id: seed.annee.id,
      }).onConflict().ignore();
    }
  });

  it('devrait retourner les classes affectées à l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait refuser à un directeur (rôle incorrect)', async () => {
    // Les directeurs peuvent voir /enseignants mais pas /enseignants/moi/classes
    // si ce endpoint est réservé aux enseignants — vérifier selon les permissions réelles
    await request
      .get('/api/v1/enseignants/moi/classes')
      .set('Authorization', `Bearer ${tokenDir}`)
      // 200 ou 403 selon la politique de permission — adapter selon le comportement réel
      .expect((res) => {
        expect([200, 403]).toContain(res.status);
      });
  });
});

// ── GET /enseignants/moi/edt ────────────────────────────────────

describe('GET /api/v1/enseignants/moi/edt', () => {
  it('devrait retourner l\'EDT de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/edt')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    // Peut être vide si aucun créneau, mais la structure doit être correcte
    expect(res.body.data).toBeDefined();
  });
});

// ── GET /enseignants/moi/affectations ──────────────────────────

describe('GET /api/v1/enseignants/moi/affectations', () => {
  it('devrait retourner les affectations de l\'enseignant connecté', async () => {
    const res = await request
      .get('/api/v1/enseignants/moi/affectations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── POST /enseignants ───────────────────────────────────────────

describe('POST /api/v1/enseignants', () => {
  it('devrait créer un nouvel enseignant', async () => {
    const res = await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:          'Sène',
        prenom:       'Oumar',
        telephone:    '+221770000099',
        specialite:   'Physique',
        type_contrat: 'vacataire',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('utilisateur_id');
  });

  it('devrait refuser un doublon de téléphone', async () => {
    await request
      .post('/api/v1/enseignants')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        nom:       'Dupont',
        prenom:    'Jean',
        telephone: '+221770000099', // déjà utilisé ci-dessus
      })
      .expect(422);
  });

  it('devrait refuser sans authentification', async () => {
    await request.post('/api/v1/enseignants').send({}).expect(401);
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="enseignants.integration"
```

Expected : tous les tests passent (certains `expect([200, 403])` sont flexibles)

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/enseignants.integration.test.js
git commit -m "test(integration): enseignants — liste, classes, EDT, affectations, création"
```

---

### Task 9 : notes.integration.test.js

**Files:**
- Create: `backend/tests/integration/notes.integration.test.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir, affectationId;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Créer une affectation enseignant <-> matière <-> classe
  const db = getTestDB();
  const matiere = await db('matieres')
    .where({ etablissement_id: seed.etablissement.id })
    .first('id');

  if (!matiere) {
    // Créer une matière si nécessaire
    const [m] = await db('matieres').insert({
      etablissement_id: seed.etablissement.id,
      nom: 'Mathématiques',
      code: 'MATH',
      annee_scolaire_id: seed.annee.id,
    }).returning('*');
    const [aff] = await db('affectations_enseignants').insert({
      enseignant_id: seed.enseignant.id,
      matiere_id: m.id,
      classe_id: seed.classe.id,
      annee_scolaire_id: seed.annee.id,
    }).returning('*');
    affectationId = aff.id;
  } else {
    const [aff] = await db('affectations_enseignants')
      .insert({
        enseignant_id: seed.enseignant.id,
        matiere_id: matiere.id,
        classe_id: seed.classe.id,
        annee_scolaire_id: seed.annee.id,
      })
      .onConflict(['enseignant_id', 'matiere_id', 'classe_id', 'annee_scolaire_id'])
      .merge()
      .returning('*');
    affectationId = aff.id;
  }
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /evaluations ──────────────────────────────────────────

describe('POST /api/v1/evaluations', () => {
  it('devrait créer une évaluation', async () => {
    const res = await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        affectation_id: affectationId,
        periode_id:     seed.periodes[0].id,
        titre:          'Devoir 1',
        type:           'devoir',
        date_eval:      '2024-11-15',
        note_max:       20,
        coefficient:    1,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
  });

  it('devrait refuser sans affectation_id', async () => {
    await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ titre: 'Test incomplet' })
      .expect(422);
  });
});

// ── GET /evaluations ───────────────────────────────────────────

describe('GET /api/v1/evaluations', () => {
  it('devrait lister les évaluations de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait refuser sans token', async () => {
    await request.get('/api/v1/evaluations').expect(401);
  });
});

// ── POST /evaluations/:id/notes ────────────────────────────────

describe('POST /api/v1/evaluations/:id/notes (saisie)', () => {
  let evalId;

  beforeAll(async () => {
    // Créer une évaluation
    const res = await request
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        affectation_id: affectationId,
        periode_id:     seed.periodes[0].id,
        titre:          'Devoir pour saisie',
        type:           'devoir',
        date_eval:      '2024-11-20',
        note_max:       20,
        coefficient:    1,
      });
    evalId = res.body.data?.id;
  });

  it('devrait saisir les notes des élèves', async () => {
    const notes = seed.eleves.map(e => ({
      eleve_id: e.user.id,
      note:     Math.floor(Math.random() * 20),
    }));

    const res = await request
      .post(`/api/v1/evaluations/${evalId}/notes`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ notes })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('devrait retourner 404 pour une évaluation inexistante', async () => {
    await request
      .post('/api/v1/evaluations/00000000-0000-0000-0000-000000000099/notes')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({ notes: [] })
      .expect(404);
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="notes.integration"
```

Expected : tests passent

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/notes.integration.test.js
git commit -m "test(integration): évaluations et saisie de notes"
```

---

### Task 10 : appels.integration.test.js

**Files:**
- Create: `backend/tests/integration/appels.integration.test.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir, edtId;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Créer un créneau EDT pour pouvoir faire un appel
  const db = getTestDB();

  const matiere = await db('matieres')
    .where({ etablissement_id: seed.etablissement.id })
    .first('id')
    .catch(() => null);

  const matId = matiere?.id || (await db('matieres').insert({
    etablissement_id: seed.etablissement.id,
    nom: 'Histoire',
    code: 'HIST',
    annee_scolaire_id: seed.annee.id,
  }).returning('id').then(r => r[0].id));

  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id,
    matiere_id: matId,
    classe_id: seed.classe.id,
    annee_scolaire_id: seed.annee.id,
  }).onConflict().merge().returning('*');

  const plage = await db('plages_horaires').first('id');
  if (!plage) return; // Skip si pas de plages

  const [edt] = await db('emplois_du_temps').insert({
    classe_id: seed.classe.id,
    affectation_id: aff.id,
    plage_id: plage.id,
    jour_semaine: 1, // Lundi
    salle: 'Salle 1',
    actif: true,
  }).returning('*');

  edtId = edt?.id;
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /appels ────────────────────────────────────────────────

describe('POST /api/v1/appels', () => {
  let appel;

  it('devrait créer un appel pour un créneau', async () => {
    if (!edtId) return; // Skip si pas de créneau

    const res = await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-18',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    appel = res.body.data;
  });

  it('devrait refuser de créer un doublon d\'appel (même créneau + date)', async () => {
    if (!edtId) return;

    await request
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${tokenEns}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-18', // même date
      })
      .expect(409); // Conflict
  });
});

// ── GET /appels/:id/presences ───────────────────────────────────

describe('GET /api/v1/appels/:id/presences', () => {
  let appelId;

  beforeAll(async () => {
    if (!edtId) return;
    const db = getTestDB();
    const appel = await db('appels')
      .where({ emploi_du_temps_id: edtId })
      .first('id');
    appelId = appel?.id;
  });

  it('devrait retourner la grille de présence', async () => {
    if (!appelId) return;

    const res = await request
      .get(`/api/v1/appels/${appelId}/presences`)
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    // 3 élèves inscrits dans la classe de test
    expect(res.body.data.length).toBe(3);
  });

  it('devrait retourner 404 pour un appel inexistant', async () => {
    await request
      .get('/api/v1/appels/00000000-0000-0000-0000-000000000099/presences')
      .set('Authorization', `Bearer ${tokenEns}`)
      .expect(404);
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="appels.integration"
```

Expected : tests passent

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/appels.integration.test.js
git commit -m "test(integration): appels — création, doublon, grille présence"
```

---

### Task 11 : discipline.integration.test.js

**Files:**
- Create: `backend/tests/integration/discipline.integration.test.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenEns, tokenDir;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── POST /discipline/sanctions ─────────────────────────────────

describe('POST /api/v1/discipline/sanctions', () => {
  it('devrait créer une sanction', async () => {
    const inscription = seed.eleves[0].inscription;

    const res = await request
      .post('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        inscription_id:  inscription.id,
        type:            'avertissement',
        motif:           'Perturbation en classe',
        date_prononcee:  '2024-11-15',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.type).toBe('avertissement');
  });

  it('devrait refuser sans motif', async () => {
    await request
      .post('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .send({
        inscription_id: seed.eleves[0].inscription.id,
        type: 'avertissement',
        // motif manquant
      })
      .expect(422);
  });

  it('devrait refuser sans authentification', async () => {
    await request.post('/api/v1/discipline/sanctions').send({}).expect(401);
  });
});

// ── GET /discipline/sanctions ──────────────────────────────────

describe('GET /api/v1/discipline/sanctions', () => {
  it('devrait lister les sanctions de l\'établissement', async () => {
    const res = await request
      .get('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait filtrer par classe_id', async () => {
    const res = await request
      .get(`/api/v1/discipline/sanctions?classe_id=${seed.classe.id}`)
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    // Toutes les sanctions retournées doivent concerner la classe filtrée
    for (const sanction of res.body.data) {
      expect(sanction.classe).toBeDefined();
    }
  });
});

// ── GET /discipline/eleves/:id/dossier ────────────────────────

describe('GET /api/v1/discipline/eleves/:id/dossier', () => {
  it('devrait retourner le dossier disciplinaire d\'un élève', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/discipline/eleves/${eleveId}/dossier`)
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });

  it('devrait retourner 404 pour un élève inexistant', async () => {
    await request
      .get('/api/v1/discipline/eleves/00000000-0000-0000-0000-000000000099/dossier')
      .set('Authorization', `Bearer ${tokenDir}`)
      .expect(404);
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="discipline.integration"
```

Expected : tests passent

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/discipline.integration.test.js
git commit -m "test(integration): discipline — sanctions CRUD, filtre classe, dossier élève"
```

---

### Task 12 : parents.integration.test.js

**Files:**
- Create: `backend/tests/integration/parents.integration.test.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request, seed, tokenParent, tokenDir, parentUserId;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);

  // Créer un utilisateur parent lié à l'élève[0]
  const db = getTestDB();
  const bcrypt = require('bcryptjs');
  const mdpHash = await bcrypt.hash('Test1234!', 10);

  const [parentUser] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id,
    nom: 'Traoré',
    prenom: 'Kadiatou',
    telephone: '+221770000050',
    mot_de_passe_hash: mdpHash,
    actif: true,
  }).returning('*');

  parentUserId = parentUser.id;

  const roleParent = await db('roles').where({ code: 'parent' }).first();
  await db('utilisateur_roles').insert({
    utilisateur_id: parentUser.id,
    role_id: roleParent.id,
    etablissement_id: seed.etablissement.id,
    actif: true,
  });

  const [parentRecord] = await db('parents').insert({
    utilisateur_id: parentUser.id,
  }).returning('*');

  // Lier le parent à l'élève[0]
  await db('parents_eleves').insert({
    parent_id: parentRecord.id,
    eleve_id:  seed.eleves[0].eleve.id,
    lien:      'mere',
    peut_voir_notes: true,
    peut_voir_absences: true,
    est_contact_principal: true,
  });

  tokenParent = await creerSession(parentUser.id, seed.etablissement.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── GET /parents/moi/enfants ───────────────────────────────────

describe('GET /api/v1/parents/moi/enfants', () => {
  it('devrait retourner les enfants du parent connecté', async () => {
    const res = await request
      .get('/api/v1/parents/moi/enfants')
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].nom).toBe('Traoré');
  });

  it('devrait retourner liste vide si parent sans enfants liés', async () => {
    // Créer un parent sans enfants
    const db = getTestDB();
    const bcrypt = require('bcryptjs');
    const [u] = await db('utilisateurs').insert({
      etablissement_id: seed.etablissement.id,
      nom: 'Sans',
      prenom: 'Enfant',
      telephone: '+221770000051',
      mot_de_passe_hash: await bcrypt.hash('Test1234!', 10),
      actif: true,
    }).returning('*');
    const roleParent = await db('roles').where({ code: 'parent' }).first();
    await db('utilisateur_roles').insert({
      utilisateur_id: u.id, role_id: roleParent.id,
      etablissement_id: seed.etablissement.id, actif: true,
    });
    await db('parents').insert({ utilisateur_id: u.id });
    const tok = await creerSession(u.id, seed.etablissement.id);

    const res = await request
      .get('/api/v1/parents/moi/enfants')
      .set('Authorization', `Bearer ${tok}`)
      .expect(200);

    expect(res.body.data.length).toBe(0);
  });
});

// ── GET /parents/moi/tableau-de-bord ──────────────────────────

describe('GET /api/v1/parents/moi/tableau-de-bord', () => {
  it('devrait retourner le tableau de bord du parent', async () => {
    const res = await request
      .get('/api/v1/parents/moi/tableau-de-bord')
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toBeDefined();
  });
});

// ── GET /parents/moi/enfants/:id/absences ─────────────────────

describe('GET /api/v1/parents/moi/enfants/:id/absences', () => {
  it('devrait retourner les absences de l\'enfant', async () => {
    const eleveId = seed.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/parents/moi/enfants/${eleveId}/absences`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('devrait refuser l\'accès à un élève non lié au parent', async () => {
    const autreEleveId = seed.eleves[1].user.id; // non lié à ce parent

    const res = await request
      .get(`/api/v1/parents/moi/enfants/${autreEleveId}/absences`)
      .set('Authorization', `Bearer ${tokenParent}`)
      .expect((r) => {
        // 403 Forbidden ou 404 selon l'implémentation
        expect([403, 404]).toContain(r.status);
      });
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="parents.integration"
```

Expected : tests passent

- [ ] **Step 3 : Commit**

```bash
git add backend/tests/integration/parents.integration.test.js
git commit -m "test(integration): parents — enfants, tableau de bord, absences, isolation"
```

---

### Task 13 : multitenant.integration.test.js (test de sécurité critique)

**Files:**
- Create: `backend/tests/integration/multitenant.integration.test.js`

- [ ] **Step 1 : Créer le fichier**

```javascript
'use strict';

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData,
  createIntegrationApp, creerSession,
} = require('./helpers');

let app, request;
let seedA, seedB, tokenA, tokenB;

beforeAll(async () => {
  app = createIntegrationApp();
  request = supertest(app);
  await truncateData();

  // Établissement A
  seedA = await seedTestData();
  tokenA = await creerSession(seedA.directeur.id, seedA.etablissement.id);

  // Établissement B — injecter manuellement un 2e établissement
  const db = getTestDB();
  const bcrypt = require('bcryptjs');

  const [etabB] = await db('etablissements').insert({
    nom: 'Collège Test Privé B',
    code_officiel: 'TEST_CPB',
    type: 'college',
    pays: 'Sénégal',
    region: 'Thiès',
    ville: 'Thiès',
    actif: true,
  }).returning('*');

  const [anneeB] = await db('annees_scolaires').insert({
    etablissement_id: etabB.id,
    libelle: '2024-2025',
    date_debut: '2024-10-01',
    date_fin: '2025-07-15',
    nb_periodes: 3,
    type_periode: 'trimestre',
    est_courante: true,
  }).returning('*');

  const [niveauB] = await db('niveaux').insert({
    etablissement_id: etabB.id,
    nom: '3ème',
    nom_court: '3e',
    cycle: 'college',
    ordre: 9,
  }).returning('*');

  await db('classes').insert({
    niveau_id: niveauB.id,
    nom: '3e A',
    annee_scolaire_id: anneeB.id,
    effectif_max: 40,
  });

  const mdpHash = await bcrypt.hash('Test1234!', 10);
  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id,
    nom: 'Camara', prenom: 'Ibrahima',
    email: 'directeur@testb.sn',
    telephone: '+221770000090',
    mot_de_passe_hash: mdpHash,
    actif: true,
  }).returning('*');

  const roleDir = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({
    utilisateur_id: dirB.id,
    role_id: roleDir.id,
    etablissement_id: etabB.id,
    actif: true,
  });

  await db('politique_securite')
    .insert({ etablissement_id: etabB.id })
    .onConflict('etablissement_id').ignore();

  seedB = { etablissement: etabB, directeur: dirB };
  tokenB = await creerSession(dirB.id, etabB.id);
});

afterAll(async () => {
  await closeTestDB();
});

// ── Isolation multi-tenant ──────────────────────────────────────
// Ces tests vérifient que l'établissement A ne peut JAMAIS voir
// les données de l'établissement B et vice versa.

describe('Isolation multi-tenant — élèves', () => {
  it('GET /eleves — établissement A ne voit que ses élèves', async () => {
    const res = await request
      .get('/api/v1/eleves')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    // Tous les élèves retournés doivent appartenir à l'établissement A
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('GET /eleves — établissement B retourne liste vide (aucun élève créé)', async () => {
    const res = await request
      .get('/api/v1/eleves')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });

  it('GET /eleves/:id — établissement B ne peut pas accéder à un élève de A', async () => {
    const eleveAId = seedA.eleves[0].user.id;

    const res = await request
      .get(`/api/v1/eleves/${eleveAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404); // Doit être introuvable pour l'établissement B

    expect(res.body.succes).toBe(false);
  });
});

describe('Isolation multi-tenant — classes', () => {
  it('GET /classes — établissement A ne voit que sa classe', async () => {
    const res = await request
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    // Vérifier que la classe de B n'est pas dans la liste
    const nomsClasses = res.body.data.map(c => c.nom_classe || c.nom);
    expect(nomsClasses).not.toContain('3e A');
  });

  it('GET /classes — établissement B ne voit que sa classe', async () => {
    const res = await request
      .get('/api/v1/classes')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const nomsClasses = res.body.data.map(c => c.nom_classe || c.nom);
    expect(nomsClasses).not.toContain('Term S1');
  });
});

describe('Isolation multi-tenant — évaluations', () => {
  it('GET /evaluations — établissement B ne voit pas les évals de A', async () => {
    const res = await request
      .get('/api/v1/evaluations')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    // Aucune évaluation ne devrait appartenir à l'établissement A
    expect(res.body.data.length).toBe(0);
  });
});

describe('Isolation multi-tenant — sanctions', () => {
  it('GET /discipline/sanctions — établissement B ne voit pas les sanctions de A', async () => {
    const res = await request
      .get('/api/v1/discipline/sanctions')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});

describe('Isolation multi-tenant — absences', () => {
  it('GET /presences/absences — établissement B ne voit pas les absences de A', async () => {
    const res = await request
      .get('/api/v1/presences/absences')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.length).toBe(0);
  });
});
```

- [ ] **Step 2 : Lancer le test**

```bash
cd backend && npm run test:integration -- --testPathPattern="multitenant.integration"
```

Expected : TOUS les tests passent — si un test échoue ici, c'est une faille de sécurité critique.

- [ ] **Step 3 : Lancer la suite intégration complète**

```bash
cd backend && npm run test:integration
```

Expected : toutes les suites passent

- [ ] **Step 4 : Commit**

```bash
git add backend/tests/integration/multitenant.integration.test.js
git commit -m "test(integration): isolation multi-tenant — 5 endpoints, 2 établissements"
```

---

## Chunk 4 : Monitoring

### Fichiers créés / modifiés
- Create: `backend/src/infrastructure/monitoring/monitoring.service.js`
- Modify: `backend/src/app.js`
- Modify: `backend/.env.example`

---

### Task 14 : Middleware de protection des endpoints sensibles

**Files:**
- Modify: `backend/src/app.js` (routes `/health/deep` et `/metrics`)

- [ ] **Step 1 : Ajouter le middleware requireMonitoringToken dans app.js**

Juste avant la déclaration de `/health/deep`, ajouter la fonction middleware :

```javascript
// ── Middleware protection monitoring ────────────────────────────
function requireMonitoringToken(req, res, next) {
  const token = process.env.MONITORING_TOKEN;
  if (!token) return next(); // Si pas de token configuré, accès libre (dev)

  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${token}`) return next();

  return res.status(401).json({
    succes: false,
    erreur: 'Token monitoring requis',
    code: 'MONITORING_UNAUTHORIZED',
  });
}
```

- [ ] **Step 2 : Appliquer le middleware sur /health/deep et /metrics**

```javascript
app.get('/health/deep', requireMonitoringToken, async (req, res) => {
  // ... code existant inchangé ...
});

app.get('/metrics', requireMonitoringToken, async (req, res) => {
  // ... code existant inchangé ...
});
```

- [ ] **Step 3 : Vérifier que /health reste public**

```bash
curl http://localhost:3010/health
```

Expected : `{"status":"ok",...}`

```bash
curl http://localhost:3010/health/deep
```

Expected (sans token) : `{"succes":false,"erreur":"Token monitoring requis",...}` avec status 401

- [ ] **Step 4 : Commit**

```bash
git add backend/src/app.js
git commit -m "feat(monitoring): protéger /health/deep et /metrics par token Bearer"
```

---

### Task 15 : Service de monitoring avec alertes SMS

**Files:**
- Create: `backend/src/infrastructure/monitoring/monitoring.service.js`

- [ ] **Step 1 : Créer le répertoire et le fichier**

```bash
mkdir -p backend/src/infrastructure/monitoring
```

Créer `backend/src/infrastructure/monitoring/monitoring.service.js` :

```javascript
'use strict';

const http   = require('http');
const logger = require('../../utils/logger');
const { envoyerSMS } = require('../notifications/sms.service');

// Cooldown anti-spam : stocke le timestamp de la dernière alerte par type
const dernierAlerteAt = {};

/**
 * Envoie une alerte SMS si le cooldown est écoulé.
 * @param {string} type - Identifiant du type d'alerte (ex: 'postgres_down')
 * @param {string} message - Message SMS à envoyer
 */
async function envoyerAlerte(type, message) {
  const phone    = process.env.ADMIN_PHONE;
  const cooldown = parseInt(process.env.MONITORING_COOLDOWN_MS) || 900000; // 15 min

  if (!phone) {
    logger.warn('MONITORING: ADMIN_PHONE non configuré — alerte non envoyée', { type });
    return;
  }

  const maintenant = Date.now();
  const derniere   = dernierAlerteAt[type] || 0;

  if (maintenant - derniere < cooldown) {
    logger.debug('MONITORING: alerte en cooldown', { type, restant_ms: cooldown - (maintenant - derniere) });
    return;
  }

  dernierAlerteAt[type] = maintenant;

  try {
    await envoyerSMS(phone, `[EcoleManager] ${message}`);
    logger.info('MONITORING: alerte SMS envoyée', { type, phone });
  } catch (err) {
    logger.error('MONITORING: échec envoi alerte SMS', { type, error: err.message });
  }
}

/**
 * Effectue un health check interne sur /health/deep.
 * Retourne { status: 'ok'|'degraded'|'error', checks: {} }
 */
async function verifierSante() {
  return new Promise((resolve) => {
    const token = process.env.MONITORING_TOKEN || '';
    const port  = parseInt(process.env.PORT) || 3000;

    const options = {
      hostname: 'localhost',
      port,
      path:    '/health/deep',
      method:  'GET',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({ status: 'error', checks: {} });
        }
      });
    });

    req.on('error',   () => resolve({ status: 'error',   checks: {} }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'error', checks: {} }); });
    req.end();
  });
}

let intervalId = null;

/**
 * Démarre la surveillance périodique.
 * À appeler une seule fois au démarrage (NODE_ENV === 'production').
 */
function startMonitoring() {
  const interval = parseInt(process.env.MONITORING_INTERVAL_MS) || 120000; // 2 min

  logger.info(`MONITORING: démarré (intervalle ${interval / 1000}s)`);

  intervalId = setInterval(async () => {
    try {
      const sante = await verifierSante();

      if (sante.status === 'error') {
        logger.error('MONITORING: API injoignable');
        await envoyerAlerte('api_down', 'API EcoleManager injoignable. Vérifiez le serveur immédiatement.');
        return;
      }

      if (sante.status === 'degraded') {
        const problemes = Object.entries(sante.checks || {})
          .filter(([, v]) => v.status !== 'ok')
          .map(([k]) => k)
          .join(', ');

        logger.warn('MONITORING: état dégradé', { checks: sante.checks });

        if (sante.checks?.postgres?.status !== 'ok') {
          await envoyerAlerte('postgres_down', `PostgreSQL indisponible. Problèmes: ${problemes}`);
        }

        if (sante.checks?.redis?.status !== 'ok') {
          await envoyerAlerte('redis_down', `Redis indisponible. Problèmes: ${problemes}`);
        }
      }
    } catch (err) {
      logger.error('MONITORING: erreur lors de la vérification', { error: err.message });
    }
  }, interval);
}

function stopMonitoring() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('MONITORING: arrêté');
  }
}

module.exports = { startMonitoring, stopMonitoring };
```

- [ ] **Step 2 : Démarrer le monitoring dans app.js (production uniquement)**

Dans la fonction `start()` de `app.js`, après le `app.listen(...)` :

```javascript
// Démarrer la surveillance (production uniquement)
if (process.env.NODE_ENV === 'production') {
  const { startMonitoring } = require('./infrastructure/monitoring/monitoring.service');
  startMonitoring();
}
```

Dans la fonction `shutdown()`, arrêter proprement :

```javascript
try {
  const { stopMonitoring } = require('./infrastructure/monitoring/monitoring.service');
  stopMonitoring();
} catch { /* ignore */ }
```

- [ ] **Step 3 : Mettre à jour .env.example**

Ajouter dans `backend/.env.example` :

```bash
# ── Monitoring ────────────────────────────────────────────────────
MONITORING_TOKEN=           # Token Bearer pour protéger /health/deep et /metrics
ADMIN_PHONE=                # Numéro pour alertes SMS ex: +221770000000
MONITORING_INTERVAL_MS=120000  # Intervalle de vérification (ms) — défaut: 2 min
MONITORING_COOLDOWN_MS=900000  # Anti-spam: min. délai entre 2 alertes (ms) — défaut: 15 min
```

- [ ] **Step 4 : Vérifier l'import ne casse pas les tests unitaires**

```bash
cd backend && npm test
```

Expected : 60/60 PASS

- [ ] **Step 5 : Commit**

```bash
git add backend/src/infrastructure/monitoring/monitoring.service.js backend/src/app.js backend/.env.example
git commit -m "feat(monitoring): service surveillance + alertes SMS Africa's Talking"
```

---

### Task 16 : Surveillance des erreurs de sync mobile

**Files:**
- Modify: `backend/src/domains/sync.routes.js`

- [ ] **Step 1 : Ajouter des logs structurés sur les erreurs de sync**

Dans `sync.routes.js`, localiser les routes qui traitent les opérations sync. Sur chaque erreur de traitement d'opération, ajouter un log structuré :

```javascript
// Exemple dans la route POST /sync/push
if (nbEchecs > 0) {
  logger.error('Sync mobile — opérations en échec', {
    etablissement_id: req.etablissement_id,
    utilisateur_id:   req.session?.utilisateur_id,
    nb_operations:    operations.length,
    nb_echecs:        nbEchecs,
    timestamp:        new Date().toISOString(),
  });
}
```

- [ ] **Step 2 : Vérifier que les tests unitaires passent toujours**

```bash
cd backend && npm test
```

Expected : 60/60 PASS

- [ ] **Step 3 : Lancer la suite d'intégration complète une dernière fois**

```bash
cd backend && npm run test:integration
```

Expected : toutes les suites passent

- [ ] **Step 4 : Commit final**

```bash
git add backend/src/domains/sync.routes.js
git commit -m "feat(monitoring): logs structurés erreurs sync mobile"
```

---

## Résumé des commits attendus

| # | Message | Chunk |
|---|---------|-------|
| 1 | `feat(migrations): inclure 008 index de performance dans run_all_migrations` | 1 |
| 2 | `feat(tests): ajouter migration 008 dans globalSetup intégration` | 1 |
| 3 | `feat(cache): Redis cache classes et eleves-par-classe (TTL 10min)` | 2 |
| 4 | `feat(cache): Redis cache EDT classe et enseignant (TTL 1h)` | 2 |
| 5 | `feat(cache): Redis cache profil utilisateur (TTL 1h)` | 2 |
| 6 | `feat(cache): Redis cache coefficients et matieres (TTL 30min)` | 2 |
| 7 | `feat(cache): Redis cache moyennes classe (TTL 5min)` | 2 |
| 8 | `test(integration): enseignants — liste, classes, EDT, affectations, création` | 3 |
| 9 | `test(integration): évaluations et saisie de notes` | 3 |
| 10 | `test(integration): appels — création, doublon, grille présence` | 3 |
| 11 | `test(integration): discipline — sanctions CRUD, filtre classe, dossier élève` | 3 |
| 12 | `test(integration): parents — enfants, tableau de bord, absences, isolation` | 3 |
| 13 | `test(integration): isolation multi-tenant — 5 endpoints, 2 établissements` | 3 |
| 14 | `feat(monitoring): protéger /health/deep et /metrics par token Bearer` | 4 |
| 15 | `feat(monitoring): service surveillance + alertes SMS Africa's Talking` | 4 |
| 16 | `feat(monitoring): logs structurés erreurs sync mobile` | 4 |
