#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# test-integration.sh — Lance les tests d'intégration en local
#
# Usage :
#   ./scripts/test-integration.sh            # tous les tests
#   ./scripts/test-integration.sh multitenant  # filtre par nom
# ─────────────────────────────────────────────────────────────
set -euo pipefail

FILTER="${1:-}"
COMPOSE_FILE="$(dirname "$0")/../backend/docker-compose.yml"
BACKEND_DIR="$(dirname "$0")/../backend"

# ── 1. Démarrer PostgreSQL + Redis ───────────────────────────
echo "▶ Démarrage PostgreSQL + Redis…"
docker compose -f "$COMPOSE_FILE" up -d postgres redis

# ── 2. Attendre que PostgreSQL soit prêt ─────────────────────
echo "⏳ Attente de PostgreSQL…"
for i in $(seq 1 30); do
  if docker exec ecole_postgres pg_isready -U ecole_user -q 2>/dev/null; then
    echo "✓ PostgreSQL prêt (${i}s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ PostgreSQL non disponible après 30s — abandon"
    exit 1
  fi
  sleep 1
done

# ── 3. Variables d'environnement pour les tests ──────────────
export DATABASE_URL="postgresql://ecole_user:ecole_password_dev@localhost:5433/ecole_manager_test"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="test_jwt_secret_for_integration_tests_32c"
export NODE_ENV="test"
export PG_CONTAINER="ecole_postgres"
export POSTGRES_USER="ecole_user"
export POSTGRES_PORT="5433"
export POSTGRES_PASSWORD="ecole_password_dev"

# ── 4. Lancer les tests ──────────────────────────────────────
echo ""
echo "▶ Lancement des tests d'intégration…"
echo ""

cd "$BACKEND_DIR"

if [ -n "$FILTER" ]; then
  npm run test:integration -- --testPathPattern="$FILTER"
else
  npm run test:integration
fi
