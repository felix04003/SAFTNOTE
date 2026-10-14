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
- Dans l'environnement de test, mettre `RATE_LIMIT_AUTH_MAX` et `RATE_LIMIT_REGISTER_MAX` à une valeur élevée
  (`POST /inscription` est limité à 5 par heure).
- Les tests de connexion ratée comptent comme tentatives : après 5 échecs le blocage s'applique 15 minutes.
  Pour relancer à la suite : `DELETE FROM tentatives_connexion;`
- Sans `ecole_app_rls` configuré (`POSTGRES_RLS_*`), `GET /configs/matieres` répond 500 (RLS phase 1) : renseigner ces variables.
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
| `specs/comptes-web.spec.js` | Parcours comptes (mot de passe provisoire, jeton expiré, session fermée, parent multi-écoles, politique), API simulée |
| `specs/workflow-complet.spec.js` | Workflow complet : connexion → classe → élève → évaluation → notes |

## En CI

Le job `dashboard-e2e` de `.github/workflows/ci.yml` rejoue exactement cette procédure (PostgreSQL et Redis éphémères, migrations,
seeds, build, relais, `npx playwright test`) ; le rapport et les captures sont téléversés en artefact si un test échoue.
