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
| `specs/ecole.spec.js` | Création d'un établissement depuis login.html |
| `specs/workflow-complet.spec.js` | Workflow complet : connexion → classe → élève → évaluation → notes |
