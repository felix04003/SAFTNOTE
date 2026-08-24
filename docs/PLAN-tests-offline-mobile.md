# Plan d'implémentation — Blindage de la couche offline mobile

> **But :** doter la couche SQLite/sync du mobile d'une suite de tests qui attrape la classe de bugs rencontrée (colonnes SQL inexistantes, fuites inter-classes, échecs silencieux).
> **Exécutant prévu :** Claude Sonnet.
> **Périmètre :** `mobile/` uniquement. Aucune modification backend/dashboard.

---

## 1. Le problème que ce plan résout

Les 3 tests actuels (`mobile/__tests__/services/`) **mockent entièrement expo-sqlite** :

```js
const mockGetAllAsync = jest.fn().mockResolvedValue([]);   // ← renvoie [] quoi qu'il arrive
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: () => mockDb }));
```

Conséquence : une requête `SELECT ... WHERE classe_id=?` sur une table qui n'a **pas** de colonne `classe_id` renvoie le `[]` mocké et le test **passe**. C'est précisément pour ça que ces bugs ont échappé aux tests et n'ont été trouvés qu'à l'écran :

- `classes.tsx` / `moyennes.tsx` / `notes-saisie.tsx` — filtres sur `classe_id` (colonne absente de `eleves`/`absences`/`moyennes`)
- `index.tsx` — `presences.date_cours` (colonne absente, la date vit sur `appels.date_cours`)
- Fuites inter-classes (jointures non filtrées par `classe`)

**Les tests mockés valident le _pattern d'appel_, pas la _correction SQL_.** Ce plan ajoute une couche qui valide le SQL contre un vrai schéma.

---

## 2. Stratégie : deux niveaux de tests

| Niveau | Outil | Ce qu'il attrape |
|---|---|---|
| **A. Tests SQL réels** (nouveau) | vrai SQLite en mémoire seedé avec le schéma de `creerTables()` | colonnes inexistantes, jointures fausses, fuites inter-classes |
| **B. Tests de logique** (existant, à étendre) | mocks jest | orchestration sync, retry, gestion réseau/erreurs |

Le niveau A est le cœur du plan — c'est lui qui aurait attrapé les 6 bugs.

---

## 3. Fondation technique (à faire en premier)

### 3.1 Dépendance de test

Installer un moteur SQLite Node qui expose une surface compatible avec l'API `expo-sqlite` utilisée (`execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`) :

```bash
cd mobile && npm install --save-dev better-sqlite3
```

### 3.2 Adaptateur de test `expo-sqlite` → `better-sqlite3`

Créer `mobile/__tests__/helpers/sqliteRealMock.ts` : un adaptateur qui implémente l'interface async d'expo-sqlite par-dessus le `better-sqlite3` synchrone. Doit exposer :

- `execAsync(sql)` → `db.exec(sql)`
- `runAsync(sql, params)` → `db.prepare(sql).run(...params)` → `{ changes, lastInsertRowId }`
- `getFirstAsync(sql, params)` → `db.prepare(sql).get(...params)`
- `getAllAsync(sql, params)` → `db.prepare(sql).all(...params)`

Point d'attention : `better-sqlite3` utilise `?` positionnels comme expo-sqlite — compatible. Gérer le cas params `undefined` (passer `[]`).

### 3.3 Helper de seed

Créer `mobile/__tests__/helpers/seedDb.ts` :

- `creerBaseTest()` : ouvre un SQLite `:memory:`, exécute le **même** SQL de création de tables que `creerTables()` dans `src/services/storage/database.ts`.
  - **Important — source unique :** ne PAS recopier le schéma à la main. Extraire le SQL DDL de `database.ts` dans une constante exportée (`export const SCHEMA_SQL = \`...\``) et l'utiliser à la fois dans `creerTables()` et dans le helper de test. Sinon on recrée le problème de schéma dupliqué.
- `seedClasse(db, { classe, eleves })` : insère N élèves dans une classe donnée.
- `seedEdt(db, creneaux)`, `seedAppel(db, ...)`, `seedNotes(db, ...)` : helpers de données par table.

---

## 4. Tests niveau A — SQL réel (le cœur)

Fichier : `mobile/__tests__/sql/enseignant-queries.test.ts`

Pour chaque écran enseignant, extraire la requête et la tester contre le vrai schéma. Idéalement, **d'abord refactorer les requêtes SQL dans un module `src/services/storage/queries.ts`** (fonctions pures qui prennent `db` + params et renvoient les données) pour qu'elles soient testables sans monter tout l'écran React. Si le refactor est trop large, tester au minimum les requêtes en les copiant dans le test — mais le refactor est préférable (DRY + testabilité).

Cas de test obligatoires (chacun aurait attrapé un bug réel) :

1. **`classes.tsx` — compteurs par classe**
   - Seed : 1 classe "6ème A" avec 7 élèves + une 2ᵉ classe "5ème B" avec 3 élèves.
   - Attendu : la requête renvoie 7 pour 6ème A, jamais les 3 de 5ème B (non-fuite).
   - Régression directe du bug `classe_id`.

2. **`index.tsx` — sparkline absences (jointure `presences`→`appels`)**
   - Seed : appels avec `date_cours`, présences `statut='absent'`.
   - Attendu : la requête compte les absences par date sans référencer `presences.date_cours` (colonne inexistante). Un `SELECT presences.date_cours` doit **throw** — le test le prouve.

3. **`moyennes.tsx` — moyennes filtrées par classe**
   - Seed : 2 classes, notes publiées dans chacune.
   - Attendu : la moyenne ne mélange jamais les élèves de l'autre classe (`WHERE e.classe=?`).

4. **`notes-saisie.tsx` — chargement élèves d'une évaluation**
   - Seed : 2 classes.
   - Attendu : ne renvoie que les élèves de la classe de l'évaluation.

5. **Test de garde générique anti-régression**
   - Une fonction qui, pour chaque requête exportée de `queries.ts`, la `prepare()` contre le schéma de test. `better-sqlite3` throw à la préparation si une colonne/table n'existe pas. Ce seul test attrape **toute** future requête sur une colonne fantôme, sans avoir à écrire un cas par requête.

---

## 5. Tests niveau A — file `operations_pending`

Fichier : `mobile/__tests__/sql/operations-pending.test.ts`

La file de sync montante est le point de perte de données le plus critique (enseignant hors ligne). Tester contre vrai SQLite :

1. `ajouterOperationPendante()` insère bien une ligne avec `statut` initial correct.
2. `getOperationsPendantes()` ne renvoie que les non-synchronisées.
3. `marquerOperationSynced()` bascule le bon statut et l'op ne ressort plus.
4. Idempotence : rejouer une op déjà synced ne duplique rien.
5. Ordre : les ops sont rejouées dans l'ordre d'insertion (FIFO).

---

## 6. Tests niveau B — orchestration sync (étendre l'existant)

Fichier : étendre `mobile/__tests__/services/syncService.test.ts`

Combler les trous de la logique (mocks OK ici, on teste l'orchestration pas le SQL) :

1. **Échec montant non silencieux** — si `syncMontante` échoue, l'erreur remonte (ne pas avaler). Régression du pattern `handleSync` corrigé.
2. **Sync descendante puis montante** — `syncComplete()` appelle les deux dans le bon ordre.
3. **Résolution de conflit** — si une note locale non-synced existe et que le serveur renvoie une valeur différente, vérifier la stratégie retenue (documenter laquelle : local-wins / server-wins / last-write-wins).
4. **Réseau qui tombe en cours** — `syncMontante` interrompu → les ops non envoyées restent dans la file (pas perdues).
5. **Token expiré (401) pendant la sync** — déclenche la déconnexion, ne boucle pas.

---

## 7. Tests client API

Fichier : `mobile/__tests__/services/client.test.ts` (nouveau)

`src/services/api/client.ts` porte la logique retry + le mapping d'erreurs (`ApiError`, `estHorsLigne`). Tester :

1. Retry sur erreur réseau (2 tentatives puis `ApiError code=HORS_LIGNE`).
2. 401 → `ApiError code=SESSION_EXPIREE` + émission de l'event déconnexion, **sans** retry.
3. Réponse serveur `!ok` → `ApiError` avec le code renvoyé, pas de retry.
4. Le déballage `data.data ?? data` renvoie bien le bon niveau (le piège où je me suis trompé en debug aujourd'hui).

---

## 8. Ordre d'exécution recommandé pour Sonnet

1. **Fondation** (§3) : dep + adaptateur + helper de seed + extraire `SCHEMA_SQL`. Vérifier qu'un test trivial passe contre le vrai SQLite avant d'aller plus loin.
2. **Test de garde générique** (§4.5) d'abord — après avoir extrait les requêtes dans `queries.ts`. Il apporte le plus de valeur pour le moins d'effort.
3. **Cas ciblés** §4.1–4.4 (régressions des bugs connus).
4. **File operations_pending** §5.
5. **Orchestration sync** §6.
6. **Client API** §7.

Après chaque étape : `cd mobile && npx jest --watchAll=false` doit être vert.

---

## 9. Definition of Done

- [ ] `npx jest --watchAll=false` vert dans `mobile/`
- [ ] Le schéma de test vient d'une **source unique** (`SCHEMA_SQL` exporté depuis `database.ts`), pas d'une copie
- [ ] Un test prouve qu'une requête sur une colonne inexistante **throw** (garde anti-régression)
- [ ] Les 4 bugs SQL corrigés cette session ont chacun un test qui échouerait si on réintroduisait le bug
- [ ] La file `operations_pending` a une couverture retry/idempotence/FIFO
- [ ] `syncMontante` ne peut plus échouer silencieusement (test le prouve)
- [ ] Ajouter un script `"test:ci": "jest --watchAll=false"` dans `mobile/package.json` et le câbler dans `.github/workflows/ci.yml` (le mobile n'est aujourd'hui pas dans la CI)

---

## 10. Pièges connus (gagne du temps à Sonnet)

- **`jest-expo` preset + better-sqlite3** : better-sqlite3 est natif Node, il tourne dans l'environnement de test Node sans souci, mais bien l'importer UNIQUEMENT dans les helpers de test, jamais dans le code applicatif (qui utilise expo-sqlite).
- **Ordre mock vs import** : dans les tests niveau A, ne PAS mocker expo-sqlite globalement — on veut le vrai adaptateur. Les tests niveau A et B doivent vivre dans des fichiers séparés pour éviter que le `jest.mock('expo-sqlite')` d'un fichier contamine l'autre.
- **`new Date(0)` comme borne de sync** : les tests de sync doivent passer une date de référence explicite, pas `undefined`, pour être déterministes.
- **Schéma réel** : `notes` a une FK vers `evaluations`, `presences` vers `appels`. `better-sqlite3` applique les FK si `PRAGMA foreign_keys=ON` — le seed doit insérer les parents avant les enfants.
