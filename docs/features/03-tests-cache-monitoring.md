# Feature 03 — Tests, Cache & Monitoring

**Version :** v0.3.0 · Sprint 3 · 2026-03-22
**Statut :** ✅ Livré

## Résumé

Mise en place de la suite de tests d'intégration (Jest) couvrant les 5 domaines, du cache Redis avec invalidation par pattern, et des logs structurés Winston pour le monitoring. Permet de valider les endpoints contre une vraie base de données de test.

## Fichiers concernés

**Tests :**
- `backend/tests/integration/` — suites par domaine
- `backend/tests/integration/jest.integration.config.js` — config Jest spécifique
- `backend/tests/integration/globalSetup.js` — applique les 9 migrations avant les tests
- `backend/tests/integration/globalTeardown.js` — nettoyage

**Infrastructure :**
- `backend/src/infrastructure/cache/redis.js` — `getRedis()`, `invalidatePattern()`
- `backend/src/infrastructure/monitoring/` — logs structurés
- `scripts/test-integration.sh` — script one-command pour lancer les tests

## Lancer les tests d'intégration

```bash
# Depuis la racine du projet
bash scripts/test-integration.sh

# Ou directement
cd backend
POSTGRES_PORT=5433 npx jest --config tests/integration/jest.integration.config.js
```

**Important :** Ne pas utiliser `npx jest` sans `--config` — le config par défaut exclut `/tests/integration/`.

## Points d'attention

- PostgreSQL de test sur **port 5433** (variable `POSTGRES_PORT`)
- `globalSetup.js` contient la liste ordonnée des migrations à appliquer — ajouter toute nouvelle migration
- Les tests créent/suppriment leurs propres données (pas de fixtures partagées)
- Le cache Redis est mocké dans les tests ou ignoré (try/catch autour des appels `invalidatePattern`)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-22-tests-cache-monitoring-design.md`](../superpowers/specs/2026-03-22-tests-cache-monitoring-design.md)
- Plan : [`docs/superpowers/plans/2026-03-22-tests-cache-monitoring.md`](../superpowers/plans/2026-03-22-tests-cache-monitoring.md)
