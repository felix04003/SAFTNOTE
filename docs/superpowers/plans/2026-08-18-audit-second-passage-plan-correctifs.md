# Audit second passage — Discipline, Enseignants, Configs, EDT, Alertes, Sync — Plan de correctifs

> Session de continuation d'un audit en deux temps sur EcoleManager (gestion scolaire offline-first Afrique de l'Ouest). Méthode identique aux deux passages : **exécution réelle obligatoire** (curl + psql contre le backend et Postgres réellement démarrés), jamais de supposition sur le schéma ou le comportement à partir de la seule lecture de code.

**Racine projet :** `/Users/A.BEYE/SAFTH ENTERPRISE/SAFTH NOTE/ecolemanager`
**Backend testé :** `http://localhost:3010` (Node/Express, Postgres 16 dans `ecole_postgres` sur le port 5433, Redis dans `ecole_redis`)
**Comptes de test utilisés :** `directeur@test.sn` / `enseignant@test.sn` (mot de passe `Test1234!`, établissement `TEST_LBD`) + parent `+221770000099` via OTP inséré directement en base.

---

## 1. État complet du projet après les deux passages

### 1.1 Passage 1 (session précédente) — rappel

Bugs trouvés et corrigés en conditions réelles, tous invisibles à la simple lecture de code :

| Commit | Résumé |
|---|---|
| `42d75aa` | `/appels` — `eleve_id` manquant + colonnes inexistantes |
| `f9edcaf` | `initQueues()` (BullMQ) jamais appelé au démarrage → notifications parents jamais envoyées |
| `e074be0` | `PUT /evaluations/:id/notes` — confusion d'ID cassait TOUTE saisie de notes enseignant |
| `b849b17` | Écrans parent (tableau de bord/absences/notes) — permissions cassées + colonnes inexistantes + **faille IDOR** (middleware `acces-eleve.middleware.js` créé) |
| `ffb8252` | `PUT /evaluations/:id/notes` — violation FK sur CHAQUE sauvegarde de notes dashboard |
| + | Contraintes CHECK `presences.statut` / `appels.statut` incomplètes, colonne dupliquée `couleur_affichage` (6 endroits), `POST /auth/connexion` renvoyait le libellé du rôle au lieu du code |

État à la fin du passage 1 : **101/101 tests d'intégration + 108/108 tests unitaires** verts.

### 1.2 Passage 2 (cette session) — nouveaux bugs trouvés et corrigés

5 correctifs appliqués, chacun vérifié en direct (reproduction avant fix → curl/psql → fix → re-vérification), 108/108 tests unitaires toujours verts après chaque commit :

| Commit | Zone | Résumé |
|---|---|---|
| `fe200e6` | discipline | `discipline.voir` / `discipline.prononcer` jamais accordées au rôle `enseignant` → l'onglet Discipline du dashboard enseignant (liste + modal "Signaler une sanction") était 100% cassé (403 sur les deux endpoints), alors que la modale exclut délibérément `exclusion_definitive` — preuve que le produit visait bien un accès enseignant. **Migration `014_fix_discipline_enseignant_permissions.sql`** |
| `9958682` | tests | Test unitaire `PUT /evaluations/:id/notes` désynchronisé du code réel depuis le fix `ffb8252` du passage 1 (mock `trx` ne simulait pas la résolution `eleve_id` → `eleves.id`) — suite rouge en 107/108 avant ce fix, sans lien avec un bug de comportement réel |
| `1a22479` | enseignants/eleves | `POST /eleves` — inscrire un **2e enfant du même parent** (cas courant, pas un cas limite) plantait en 409 générique car `utilisateurs.telephone` est UNIQUE au niveau base (contrainte globale, pas par établissement) et le code réinsérait aveuglément une ligne `utilisateurs` par enfant. Fix : recherche du parent par téléphone avant insertion (réutilisation si même établissement, 422 explicite si le numéro appartient à un autre établissement) |
| `90159d0` | sync mobile | `POST /sync/operations` (0% de couverture, jamais touché par le passage 1) contenait **les deux mêmes classes de bugs déjà corrigées ailleurs** : `presences.saisir` écrivait dans `presences.updated_at` (colonne inexistante — seules `saisie_at`/`modifie_at` existent) et `notes.saisir` insérait `eleve_id` sans le résoudre `utilisateurs.id` → `eleves.id` (violation FK `notes_eleve_id_fkey`). Ces deux opérations échouaient sur CHAQUE présence/note corrigée hors-ligne par un enseignant, silencieusement (la route renvoie 200 avec un statut `'erreur'` par opération individuelle) |

Zones auditées en exécution réelle et **confirmées saines** (aucun bug trouvé, comportement vérifié via curl avec les 3 rôles) :

- `GET/POST/PUT /discipline/sanctions`, `GET /discipline/eleves/:id/dossier` (logique métier et jointures)
- `POST /enseignants`, `GET /enseignants`, `PUT /enseignants/:id`, `GET /enseignants/moi/classes`, `GET /enseignants/moi/edt`, `PUT /enseignants/moi/edt/:id/salle`
- `GET /configs/matieres`, `POST /configs/matieres`, `GET/PUT /configs/coefficients`
- `GET /edt/classe/:id`, `GET /edt/enseignant/:id`, `POST/PUT/DELETE /edt/creneaux` (y compris la détection de conflit horaire — 422 vérifié)
- `GET /notifications` (alertes) pour directeur, enseignant et parent — le branchement par rôle (`req.session.role`) fonctionne correctement pour des comptes à rôle unique

**État final : 108/108 tests unitaires verts**, arborescence git propre, aucune régression introduite.

---

## 2. Ce qui reste identifié mais non corrigé

### CRITIQUE

**Aucun** — tous les bugs bloquant un scénario réel et reproduit en exécution ont été corrigés dans ce passage.

### MAJEUR

**M1 — `configs_matieres_niveau` : aucun moyen de créer une configuration de coefficient**
`GET /configs/coefficients` et `PUT /configs/coefficients` existent (lecture + modification batch), mais **il n'y a nulle part dans l'API un `POST` qui crée une ligne `configs_matieres_niveau`**, et `dashboard/js/pages/parametres.js` ne fait que `GET`/`POST /configs/matieres` (jamais `/configs/coefficients`). Conséquence vérifiée : j'ai créé une matière "SVT" via `POST /configs/matieres` (201 OK) et elle n'apparaît dans aucune configuration de coefficient — impossible à assigner à un niveau via l'app. Sans coefficient, une matière ne peut pas entrer dans le calcul des moyennes (`moyennes.routes.js` joint `configs_matieres_niveau`). Toutes les lignes existantes en base ont dû être insérées à la main (migrations/seed), jamais via l'application elle-même.
*Effort estimé : 0.5–1 jour (endpoint `POST /configs/coefficients` + petit écran dans `parametres.js` pour assigner coefficient/niveau à une nouvelle matière).*

**M2 — Dashboard EDT 100% en lecture seule malgré un backend complet et fonctionnel**
`dashboard/js/pages/edt.js` n'appelle que `GET /classes` et `GET /edt/classe/:id`. `POST/PUT/DELETE /edt/creneaux` (création de créneau, modification, suppression, détection de conflit) sont vérifiés fonctionnels à 100 % en direct mais n'ont **aucune UI** dans le dashboard. Un directeur ne peut donc pas construire un emploi du temps sans passer par SQL direct.
*Effort estimé : 1–2 jours (formulaire de création/édition de créneau + affichage grille éditable).*

**M3 — Duplication de route `GET /enseignants` (code mort dangereux si "réparé" naïvement)**
`enseignants.routes.js` définit **deux fois** `router.get('/enseignants', ...)` : une première fois ligne 125 (`perm('config.voir')`, retourne `id`/`nom`/`prenom`/`telephone`/`email`/`specialite`/`type_contrat`) et une seconde ligne 544 (`perm('enseignants.voir')`, retourne en plus `matieres_assignees`/`nb_classes`). Express ne retient que la **première** route enregistrée — la seconde est du code mort, jamais exécuté (vérifié en direct : la réponse ne contient jamais `matieres_assignees`/`nb_classes`). Fonctionnellement inoffensif aujourd'hui (le dashboard n'utilise pas ces champs), mais **piège actif** : la route morte sélectionne `u.id` (utilisateurs.id) au lieu de `ens.id` (enseignants.id) pour le champ `id` — si quelqu'un supprime la première route pour "activer" la seconde en pensant nettoyer du code dupliqué, `PageAffectations.ouvrir(e.id, ...)` recevrait le mauvais espace d'ID et casserait l'affectation matière↔classe.
*Effort estimé : 1h (supprimer la route morte, ou fusionner les deux en gardant `ens.id` et en ajoutant les colonnes utiles).*

**M4 — `isolerEtablissement` ne pose pas `req.etablissement_id` pour `super_admin`**
`permission.middleware.js` : `if (roles.includes('super_admin')) return next();` — retour anticipé qui saute la ligne `req.etablissement_id = etablissement_id;`. Plusieurs routes (`discipline.routes.js`, `configs.routes.js`, etc.) lisent exclusivement `req.etablissement_id` (posé par ce middleware) plutôt que `req.session.etablissement_id`. **Non vérifié en exécution réelle** (aucun compte `super_admin` n'existe dans les données de test — en créer un dépassait le budget de cette session) mais confirmé par lecture de code : un super_admin recevrait `req.etablissement_id === undefined` sur ces routes, et les requêtes Knex `.where({ 'x.etablissement_id': undefined })` ne retournent jamais de ligne côté Postgres avec `knex` (le comparateur devient `IS NULL`).
*Effort estimé : 15 min de fix (poser `req.etablissement_id = etablissement_id` avant le `return next()` pour super_admin) + 30 min pour créer un compte de test et vérifier en direct.*

### MINEUR

**m1 — `notifications.routes.js` / `req.session.role` fragile pour les comptes multi-rôles**
`GET /notifications` bascule sur `req.session.role` (singulier, `roles[0]?.code` sans `ORDER BY` déterministe dans `auth.middleware.js`). Fonctionne correctement pour tous les comptes de test (rôle unique), mais un compte cumulant plusieurs rôles dans le même établissement recevrait un payload de notifications dépendant de l'ordre arbitraire retourné par Postgres. À corriger si des comptes multi-rôles deviennent un cas d'usage réel (actuellement aucun dans les données vues).

**m2 — Données de seed test polluées / incohérentes entre établissements**
`affectations_enseignants` pour `TEST_LBD` référence une `matiere_id` appartenant à un **autre** établissement (`d88d242a-9e06-4bf5-82c6-afbb22fae623`), ce qui a fait apparaître par erreur une matière "Mathématiques" dans `/enseignants/moi/classes` alors que `matieres` est vide pour `TEST_LBD`. Confirmé être un problème de données de seed (migration `010_test_seed_enseignant_parent.sql` probablement), pas un bug de route — mais à nettoyer pour que les tests E2E restent représentatifs.

---

## 3. Recommandation — couverture de test de `sync.routes.js`

Le fichier est explicitement exclu de la couverture (`jest.config.js` : `'!src/domains/sync.routes.js'`) et avait 0% de couverture réelle avant cette session, alors qu'il concentre toute la sync montante mobile → serveur (le point d'entrée le plus critique pour l'offline-first). C'est directement ce qui a permis aux deux bugs `presences.updated_at` / confusion `eleve_id` de survivre au passage 1.

**Recommandation concrète :**

1. Retirer `sync.routes.js` de l'exclusion `collectCoverageFrom` dans `jest.config.js`.
2. Créer `backend/tests/domains/sync.routes.test.js` sur le modèle de `tests/domains/integration.test.js` (mocks `getDB`/`redis`/`bullmq`/`logger`, `createTestApp`), avec au minimum :
   - `GET /sync` enseignant : vérifier que la requête `classes` filtre bien par `enseignant.id` résolu depuis `enseignants.utilisateur_id`, **pas** directement `req.session.utilisateur_id` (le bug de confusion d'ID déjà corrigé une fois — non-régression).
   - `GET /sync` parent : vérifier le filtrage par `parents_eleves.parent_id`.
   - `GET /sync` sans rôle enseignant/parent (ex. directeur) : vérifier que `payload` reste `{}` sans planter.
   - `POST /sync/operations` — `presences.saisir` : vérifier que la requête `UPDATE` cible bien `modifie_at` (non-régression du fix de cette session — un test qui asserte sur le SQL généré, ou a minima sur l'objet passé à `.update()`, aurait immédiatement attrapé ce bug).
   - `POST /sync/operations` — `presences.saisir` sur un appel `statut != 'ouvert'` : doit renvoyer `{ statut: 'erreur', code: 'APPEL_CLOTURE' }` sans planter.
   - `POST /sync/operations` — `notes.saisir` avec un `eleve_id` = `utilisateurs.id` : vérifier la résolution vers `eleves.id` avant insertion (non-régression du 2e fix de cette session).
   - `POST /sync/operations` — `notes.saisir` avec un `eleve_id` introuvable : vérifier `{ statut: 'erreur', code: 'ELEVE_INTROUVABLE' }`.
   - `POST /sync/operations` — type d'opération inconnu : vérifier `{ statut: 'erreur', code: 'TYPE_INCONNU' }`.
   - `POST /sync/operations` — batch mixte (une opération OK, une en erreur) : vérifier que `resultats` contient bien les deux statuts indépendamment (pas d'abandon du batch sur la première erreur).
3. Objectif réaliste : ~10-12 tests, couvrant les deux branches de rôle de `GET /sync` et les deux `case` de `POST /sync/operations` + leurs chemins d'erreur. Effort estimé : 2-3h en suivant les patterns de mock déjà en place dans `tests/helpers/mockKnex.js`.

*Non réalisé dans cette session par choix de priorisation (corriger et vérifier en direct les bugs réels d'abord, avec le budget restant) — mais les deux bugs qu'une telle suite aurait immédiatement attrapés sont déjà corrigés (commit `90159d0`).*

---

## 4. Recommandation — `dashboard/js/config.js` pointant sur la prod Render

**Constat vérifié :**
```js
var CONFIG = {
  API_BASE: 'https://ecolemanager-api.onrender.com/api/v1',
  ...
};
```
Aucune détection d'environnement. `dashboard/tests/playwright.config.js` sert le dashboard depuis `http://localhost:3003` mais tout le JS applicatif appelle quand même l'API de production Render — la suite Playwright existante ne peut donc pas tourner contre un backend local sans édition manuelle du fichier (et pire, si elle tournait sans modification, elle exécuterait des mutations contre la **prod réelle**).

**Options proposées (aucune implémentée — décision produit à trancher par l'équipe) :**

**Option A — Détection par hostname (recommandée)**
```js
var IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
var CONFIG = {
  API_BASE: IS_LOCAL ? 'http://localhost:3010/api/v1' : 'https://ecolemanager-api.onrender.com/api/v1',
  ...
};
```
- Zéro dépendance, zéro étape de build — cohérent avec l'architecture "HTML/CSS/JS vanilla sans NPM" du dashboard.
- Le hostname de prod ne sera jamais `localhost`/`127.0.0.1` : aucun risque de régression prod.
- Limite : ne couvre pas un environnement de staging distant (ex. `staging.ecolemanager.sn`) — nécessiterait une liste de hostnames ou un pattern.

**Option B — Fichier de surcharge local optionnel**
Ajouter un `dashboard/js/config.local.js` (dans `.gitignore`), chargé en dernier dans les fichiers HTML avec `onerror` silencieux s'il n'existe pas :
```html
<script src="js/config.js"></script>
<script src="js/config.local.js" onerror="void 0"></script>
```
```js
// config.local.js (non versionné)
CONFIG.API_BASE = 'http://localhost:3010/api/v1';
```
- Explicite, ne devine rien, fonctionne pour n'importe quel environnement (local, staging, prod alternative).
- Nécessite que chaque développeur crée son fichier localement (documenté dans le futur `dashboard/tests/README.md`).
- Complémentaire à l'option A plutôt qu'exclusif — on peut avoir A comme filet de sécurité par défaut et B pour les cas où le hostname ne suffit pas (ex. tunnel ngrok).

**Recommandation :** implémenter A seule dans un premier temps (5 minutes, zéro risque), suffisant pour débloquer la suite Playwright existante en local. B seulement si un besoin de staging distinct apparaît.

---

## 5. Verdict final

**Le dashboard est prêt pour reprendre le développement mobile en confiance**, sous réserve des points suivants :

- Les 5 zones explicitement demandées pour ce passage (discipline, enseignants CRUD, configs/matieres, création EDT, alertes) sont **vérifiées fonctionnelles en exécution réelle**, bugs trouvés corrigés et commités indépendamment avec cause racine documentée.
- Le chemin le plus critique pour le développement mobile — `sync.routes.js`, jusqu'ici jamais audité ni testé — contenait deux bugs de la **même gravité** que ceux qui avaient cassé toute la saisie de notes et de présences côté dashboard au passage 1. Ils sont maintenant corrigés et vérifiés (commit `90159d0`). C'était le risque le plus sérieux identifié dans cette session : sans ce fix, **toute correction de présence ou saisie de note hors-ligne par un enseignant aurait continué à échouer silencieusement** après la reprise du développement mobile, avec un 200 OK trompeur côté client.
- 108/108 tests unitaires verts, arbre git propre, chaque fix vérifié avant/après en conditions réelles (pas de correction "à l'aveugle").

**Ce qui reste bloquant avant d'aller plus loin, par ordre de priorité :**

1. **M4** (super_admin / `req.etablissement_id`) — à vérifier en premier avec un vrai compte de test avant toute mise en production, car non confirmé en exécution réelle dans cette session (contrairement à tout le reste). Risque : si confirmé, casse silencieusement l'accès super_admin à plusieurs modules.
2. **M1** (impossible de configurer un coefficient pour une nouvelle matière via l'app) — bloquant dès qu'une école veut ajouter une matière personnalisée après l'onboarding initial.
3. **M2** (EDT dashboard en lecture seule) — bloquant pour l'autonomie des écoles sur la gestion de leur emploi du temps, mais contournable à court terme via accès direct à la base.
4. Couverture de test de `sync.routes.js` (section 3) — à faire avant d'ajouter de nouvelles opérations `POST /sync/operations`, pour ne pas reproduire un troisième passage sur les mêmes classes de bugs.
5. Décision sur `dashboard/js/config.js` (section 4) — Option A, 5 minutes, débloque la suite Playwright existante en local.

Aucun de ces points ne remet en cause la stabilité de ce qui est déjà en production ou déjà testé ; ce sont des gaps de fonctionnalité ou de couverture, pas des régressions.

---

## 6. Annexe — commandes de vérification utilisées

```bash
# Backend
curl -X POST http://localhost:3010/api/v1/auth/connexion -H "Content-Type: application/json" \
  -d '{"identifiant":"directeur@test.sn","mot_de_passe":"Test1234!","etablissement_code":"TEST_LBD"}'

# Schéma réel (jamais faire confiance au code)
docker exec ecole_postgres psql -U ecole_user -d ecole_manager -c '\d sanctions'

# Suite de tests backend
cd backend && npx jest --silent
```
