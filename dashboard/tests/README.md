# Tests E2E EcoleManager

Tests Playwright pour le dashboard EcoleManager.

## Installation

```bash
cd dashboard/tests && npm install && npx playwright install chromium
```

## Prérequis

- Backend sur http://localhost:3010
- Dashboard sur http://localhost:3003

Pour démarrer le dashboard :
```bash
npx serve dashboard -l 3003
```

Pour démarrer le backend :
```bash
cd backend && npm run dev
```

## Lancer la suite complète contre un backend local

La CSP du dashboard n'autorise les appels API que vers sa propre origine (et la production) : un dashboard
servi sur :3003 ne peut pas appeler `localhost:3010`. `serve-e2e.js` sert `dashboard/dist` et relaie `/api`
vers le backend, donc tout est de même origine :

```bash
# 1. Backend (base dédiée : npm run test:integration supprime ecole_manager_test)
cd backend && npm run migrate && npm run seed:test && npm start        # :3010
# 2. Dashboard construit pour l'API de même origine, puis servi avec le relais
cd dashboard && VITE_API_BASE=http://localhost:3003/api/v1 npm run build
node tests/serve-e2e.js                                                 # :3003 (E2E_PORT, E2E_API_PORT pour changer)
# 3. Tests
cd tests && npx playwright test
```

Remarques :
- Dans l'environnement de test, mettre `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_REGISTER_MAX` et `RATE_LIMIT_GLOBAL_MAX` à une
  valeur élevée : `POST /inscription` est limité à 5 par heure, et le limiteur global à 100 requêtes par minute et par
  adresse (tout passe par le relais) : sans cela des connexions échouent au hasard (« Trop de requêtes »).
- Les tests qui créent des évaluations (étapes 6 et 8) prennent un créneau (type, numéro 1 à 5) libre : une évaluation est
  unique par (affectation, type, numéro, période), soit 35 créneaux ; la publication est irréversible. Au-delà, les tests échouent avec un message explicite : repartir d'une base neuve, ou supprimer les évaluations de test :
  `DELETE FROM notes WHERE evaluation_id IN (SELECT id FROM evaluations WHERE titre LIKE '%E2E%'); DELETE FROM evaluations WHERE titre LIKE '%E2E%';`
- Les tests de connexion ratée comptent comme tentatives : après 5 échecs le blocage s'applique 15 minutes.
  Pour relancer à la suite : `DELETE FROM tentatives_connexion;`
- **Rôle `ecole_app_rls`** (migration 019, créé sans mot de passe) : sans mot de passe, `GET /configs/matieres` répond 500 et les listes de matières du dashboard échouent. Après `migrate` : `ALTER ROLE ecole_app_rls WITH PASSWORD '...'`, et démarrer le backend avec `POSTGRES_RLS_USER` / `POSTGRES_RLS_PASSWORD`.
- Le parcours (étape 11, connexion des parents par code SMS) remplace le code SMS en base avec `psql` et les variables `POSTGRES_HOST/PORT/DB/USER/PASSWORD` : à définir dans l'environnement des tests ; sans `psql`, l'étape est ignorée avec un message.
- Le parcours a été éprouvé par mutation (code applicatif faussé, puis rétabli) : `GET /eleves` sans filtre d'établissement (étapes 7 ou 12), enseignant qui voit toutes les classes (10), parent qui lit les notes d'un enfant qui n'est pas le sien (11), notes non publiées visibles du parent (11), affectation non enregistrée (6). Les deux mutations côté parent n'étaient d'abord PAS détectées : l'évaluation « brouillon » (jamais publiée) et le contrôle d'accès API de l'étape 11 ont été ajoutés pour cela.
- `comptes-web.spec.js` simule l'API et n'a pas besoin du backend.

## Variables d'environnement

Créer un fichier `.env` dans `dashboard/tests/` :

```
TEST_IDENTIFIANT=directeur@test.sn
TEST_MDP=Test1234!
TEST_CODE_ETAB=TEST_LBD
```

## Lancer les tests

```bash
npm test                  # headless (CI)
npm run test:headed       # avec navigateur visible
npm run test:report       # ouvrir le rapport HTML
```

## Fichiers de tests

| Fichier | Description |
|---------|-------------|
| `specs/auth.spec.js` | Connexion, déconnexion, redirections |
| `specs/ecole.spec.js` | Création d'un établissement par le wizard `inscription.html` |
| `specs/parcours-ecole.spec.js` | Parcours « école complète » en 12 étapes (école, directeur, matières, classes, enseignants, affectations, élèves et parents, évaluations, notes, publication, connexion de chaque profil, isolation entre écoles). Profils : `data/profils-parcours.js`. Agent : `docs/agents/testeur-parcours-web.md` |
| `specs/comptes-web.spec.js` | Parcours comptes (mot de passe provisoire, jeton expiré, session fermée, parent multi-écoles, politique), API simulée |
| `specs/workflow-complet.spec.js` | Workflow complet : connexion → classe → élève → évaluation → notes |

## En CI

Le job `dashboard-e2e` de `.github/workflows/ci.yml` rejoue exactement cette procédure (PostgreSQL et Redis éphémères, migrations,
seeds, build, relais, `npx playwright test`) ; le rapport et les captures sont téléversés en artefact si un test échoue.

## Diagnostiquer un test en échec

Chaque spec importe `test` depuis `fixtures.js` (et non directement de `@playwright/test`) : tout test en échec
reçoit un `journal-navigateur.txt` (console, erreurs de page, requêtes échouées, réponses HTTP >= 400, navigations et
boîtes de dialogue, avec l'instant en ms depuis le début du test) dans `test-results/<test>/`. En CI, l'étape
« Journaux du navigateur des tests en échec » l'affiche dans le journal du job ; le rapport Playwright (artefact) contient
en plus la capture, la vidéo et la trace (`npx playwright show-trace test-results/<test>/trace.zip`).

Piège connu : une page qui se recharge d'elle-même (ex. choix d'école de `parent.html`) détruit le contexte d'exécution ;
un `page.evaluate` lancé à ce moment échoue (« Execution context was destroyed »). Poser `page.waitForEvent('load')`
AVANT l'action, puis l'attendre. Pour reproduire une instabilité de timing, charger le processeur
(`node -e "while(true){}"` x 2 par cœur) et utiliser `--repeat-each`.
