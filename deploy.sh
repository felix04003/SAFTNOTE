#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
#  EcoleManager — Script de déploiement serveur
#
#  Usage :
#    bash deploy.sh                   → déploiement standard
#    bash deploy.sh --skip-migrations → sauter les migrations SQL
#
#  Prérequis :
#    - Node.js >= 20, pm2 installé globalement
#    - backend/.env configuré
#    - PostgreSQL + Redis accessibles
# ══════════════════════════════════════════════════════════════════

set -euo pipefail

SKIP_MIGRATIONS=false
for arg in "$@"; do
  [ "$arg" = "--skip-migrations" ] && SKIP_MIGRATIONS=true
done

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ $*" >&2; exit 1; }

# ── 1. Mise à jour du code ──────────────────────────────────────
log "Pull origin/main..."
git pull origin main || fail "git pull échoué"
ok "Code à jour"

# ── 2. Dépendances backend ──────────────────────────────────────
log "Installation des dépendances backend..."
(cd backend && npm ci --omit=dev) || fail "npm ci échoué"
ok "Dépendances installées"

# ── 3. Migrations SQL ───────────────────────────────────────────
if [ "$SKIP_MIGRATIONS" = false ]; then
  log "Application des migrations SQL..."
  (cd backend && node src/utils/migrate.js) || fail "Migrations échouées"
  ok "Migrations appliquées"
else
  log "Migrations ignorées (--skip-migrations)"
fi

# ── 4. Reload PM2 (zero-downtime) ──────────────────────────────
log "Reload PM2..."
if pm2 list | grep -q "ecolemanager-api"; then
  pm2 reload ecosystem.config.js --env production || fail "pm2 reload échoué"
  ok "PM2 rechargé (zero-downtime)"
else
  pm2 start ecosystem.config.js --env production || fail "pm2 start échoué"
  ok "PM2 démarré"
fi

# ── 5. Persistance au reboot ────────────────────────────────────
pm2 save --force
ok "pm2 save effectué"

# ── 6. Health check ─────────────────────────────────────────────
log "Health check..."
sleep 3
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
  ok "API opérationnelle (HTTP $HTTP_STATUS)"
else
  fail "Health check échoué (HTTP $HTTP_STATUS) — vérifiez : pm2 logs ecolemanager-api"
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  Déploiement terminé avec succès"
echo "  pm2 logs ecolemanager-api  → logs API"
echo "  pm2 monit                  → monitoring temps réel"
echo "══════════════════════════════════════════════"
