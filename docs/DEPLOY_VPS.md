# EcoleManager — Guide de déploiement VPS (Hetzner CX22)

> Cible : Ubuntu 22.04 LTS, 2 vCPU, 4 Go RAM, 40 Go SSD (~6 USD/mois)
> Durée estimée : 1 à 2 heures pour un premier déploiement
> Prérequis : compte Hetzner, nom de domaine, clé SSH locale

---

## 0. Prérequis locaux

```bash
# Vérifier que tu as une clé SSH
ls ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -C "ecolemanager-vps"

# Installer le CLI Hetzner (optionnel mais pratique)
brew install hcloud        # macOS
# ou pip install hcloud    # Python
```

---

## 1. Créer le serveur Hetzner

### Via la console web

1. Aller sur [console.hetzner.com](https://console.hetzner.com)
2. Nouveau projet → **EcoleManager**
3. Créer un serveur :
   - **Type** : CX22 (2 vCPU, 4 Go RAM)
   - **Image** : Ubuntu 22.04
   - **Région** : Nuremberg (EU) ou Helsinki (la plus proche de l'Afrique de l'Ouest)
   - **Clé SSH** : importer ta clé publique `~/.ssh/id_ed25519.pub`
   - **Nom** : `ecolemanager-prod`
4. Créer le serveur → noter l'IP publique (ex: `65.21.XXX.XXX`)

### Via le CLI Hetzner (alternative)

```bash
hcloud server create \
  --name ecolemanager-prod \
  --type cx22 \
  --image ubuntu-22.04 \
  --ssh-key $(hcloud ssh-key list -o tsv | head -1 | cut -f1) \
  --location nbg1
```

---

## 2. Premier accès et sécurisation

```bash
# Se connecter en root
ssh root@65.21.XXX.XXX

# Mettre à jour le système
apt update && apt upgrade -y

# Créer un utilisateur non-root
adduser ecolemanager
usermod -aG sudo ecolemanager

# Copier la clé SSH vers le nouvel utilisateur
mkdir -p /home/ecolemanager/.ssh
cp /root/.ssh/authorized_keys /home/ecolemanager/.ssh/
chown -R ecolemanager:ecolemanager /home/ecolemanager/.ssh
chmod 700 /home/ecolemanager/.ssh
chmod 600 /home/ecolemanager/.ssh/authorized_keys

# Désactiver l'accès root par SSH
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Se déconnecter et tester le nouvel utilisateur
exit
ssh ecolemanager@65.21.XXX.XXX
```

---

## 3. Installer Docker

```bash
# Depuis le compte ecolemanager
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ecolemanager

# Déconnecter / reconnecter pour appliquer le groupe
exit
ssh ecolemanager@65.21.XXX.XXX

# Vérifier
docker --version          # Docker 26.x.x
docker compose version    # Docker Compose version v2.x.x
```

---

## 4. Configurer le firewall UFW

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Vérifier
sudo ufw status
```

Résultat attendu :
```
Status: active
To                         Action      From
--                         ------      ----
OpenSSH                    ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

---

## 5. Cloner le dépôt

```bash
# Installer git
sudo apt install -y git

# Cloner (remplacer par votre URL)
cd /home/ecolemanager
git clone https://github.com/VOTRE-ORG/ecolemanager.git
cd ecolemanager

# Si le repo est privé, utiliser un deploy key ou token
# git clone https://TOKEN@github.com/VOTRE-ORG/ecolemanager.git
```

---

## 6. Configurer les variables d'environnement

```bash
# Copier le template et remplir les valeurs
cp backend/.env.production.example .env.production
nano .env.production

# Variables OBLIGATOIRES à remplir :
#   POSTGRES_PASSWORD    → openssl rand -base64 32
#   REDIS_PASSWORD       → openssl rand -base64 24
#   JWT_SECRET           → node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
#   AT_API_KEY           → depuis africastalking.com
#   AT_USERNAME          → depuis africastalking.com
#   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY → depuis dash.cloudflare.com
#   MONITORING_TOKEN     → openssl rand -hex 24
#   ADMIN_PHONE          → +221XXXXXXXXX
#   FRONTEND_URL         → https://VOTRE-DOMAINE.com
#   NGINX_DOMAIN         → api.VOTRE-DOMAINE.com

# Sécuriser le fichier
chmod 600 .env.production

# Vérifier qu'aucun placeholder n'est resté
grep -n "REMPLACER\|TODO\|changeme" .env.production && echo "ATTENTION : placeholders restants !"
```

---

## 7. Configurer Nginx avec votre domaine

```bash
# Remplacer le domaine dans la config Nginx
# (adapter selon votre structure nginx/)
grep -r "ecolemanager.com\|VOTRE-DOMAINE" nginx/

# Exemple de modification :
sed -i 's/api.ecolemanager.com/api.VOTRE-DOMAINE.com/g' nginx/conf.d/api.conf
```

---

## 8. Démarrer les services

```bash
# Charger les variables d'environnement
set -a && source .env.production && set +a

# Premier démarrage (avec build des images)
docker compose -f docker-compose.prod.yml up -d --build

# Surveiller le démarrage (~2-3 min)
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api

# Résultat attendu — tous les services "healthy" :
# ecole_postgres_prod   Up (healthy)
# ecole_redis_prod      Up (healthy)
# ecole_api_prod        Up (healthy)
# ecole_nginx_prod      Up
# ecole_certbot         Up
```

---

## 9. Appliquer les migrations SQL

```bash
# Option A : via psql depuis le host (recommandé)
docker exec -i ecole_postgres_prod \
  psql -U ecolemanager -d ecolemanager_prod \
  < migrations/run_all_migrations.sql

# Option B : connexion directe psql
docker exec -it ecole_postgres_prod \
  psql -U ecolemanager -d ecolemanager_prod

# Vérifier les tables créées
docker exec -it ecole_postgres_prod \
  psql -U ecolemanager -d ecolemanager_prod \
  -c "\dt public.*" | head -30
```

---

## 10. Obtenir le certificat TLS (Let's Encrypt)

Le service `certbot` est inclus dans `docker-compose.prod.yml`. Il faut d'abord que
le DNS de votre domaine pointe vers l'IP du VPS.

```bash
# Vérifier que le DNS est propagé (attendre 5-15 min après modification DNS)
nslookup api.VOTRE-DOMAINE.com
# → doit retourner 65.21.XXX.XXX

# Obtenir le certificat
docker exec ecole_certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d api.VOTRE-DOMAINE.com \
  --email admin@VOTRE-DOMAINE.com \
  --agree-tos --non-interactive

# Recharger Nginx avec le certificat
docker exec ecole_nginx_prod nginx -s reload
```

---

## 11. Smoke tests

```bash
# Health check de base (doit retourner {"status":"ok"})
curl https://api.VOTRE-DOMAINE.com/health

# Health check complet (remplacer VOTRE_MONITORING_TOKEN)
curl -H "Authorization: Bearer VOTRE_MONITORING_TOKEN" \
  https://api.VOTRE-DOMAINE.com/health/deep

# Test authentification
curl -X POST https://api.VOTRE-DOMAINE.com/api/v1/auth/connexion \
  -H "Content-Type: application/json" \
  -d '{"identifiant":"directeur@test.com","motDePasse":"password123","etablissementCode":"TEST"}'

# Swagger UI (documentation interactive)
# Ouvrir dans le navigateur : https://api.VOTRE-DOMAINE.com/api/docs
```

---

## 12. Créer le premier établissement (setup initial)

```bash
curl -X POST https://api.VOTRE-DOMAINE.com/api/v1/setup \
  -H "Content-Type: application/json" \
  -d '{
    "etablissement": {
      "nom": "Lycée Lamine Guèye",
      "code": "LLG-001",
      "telephone": "+221338212345",
      "adresse": "Dakar, Sénégal",
      "pays": "SN"
    },
    "directeur": {
      "prenom": "Mamadou",
      "nom": "Diop",
      "telephone": "+221771234567",
      "mot_de_passe": "MotDePasseFort2024!"
    }
  }'
```

---

## 13. Mises à jour futures (CI/CD manuel)

```bash
# Depuis le VPS, exécuter le script de déploiement zero-downtime
cd /home/ecolemanager/ecolemanager
bash deploy.sh

# Le script fait :
# 1. git pull origin main
# 2. npm ci --prefix backend
# 3. docker compose -f docker-compose.prod.yml build api
# 4. docker compose -f docker-compose.prod.yml up -d --no-deps api
# 5. migrations (si pas --skip-migrations)
# 6. PM2 reload (si utilisé hors Docker)
```

### Workflow GitHub Actions (optionnel)

Ajouter ces secrets dans GitHub Settings > Secrets :

| Secret | Valeur |
|--------|--------|
| `VPS_HOST` | IP du VPS (ex: 65.21.XXX.XXX) |
| `VPS_USER` | `ecolemanager` |
| `SSH_PRIVATE_KEY` | Contenu de `~/.ssh/id_ed25519` |

Puis créer `.github/workflows/deploy.yml` avec un job SSH qui exécute `bash deploy.sh`.

---

## 14. Monitoring

```bash
# Uptime Robot (gratuit) : https://uptimerobot.com
# Configurer un moniteur HTTP sur https://api.VOTRE-DOMAINE.com/health
# Alerte SMS si down (intervalle 5 min)

# Logs en temps réel
docker compose -f docker-compose.prod.yml logs -f api

# Métriques BullMQ (file notifications/bulletins)
curl -H "Authorization: Bearer VOTRE_MONITORING_TOKEN" \
  https://api.VOTRE-DOMAINE.com/metrics
```

---

## Checklist finale avant Go Live

- [ ] IP VPS → DNS domaine propagé (nslookup confirme)
- [ ] `docker compose ps` → tous services `healthy`
- [ ] `curl /health` → `{"status":"ok"}`
- [ ] TLS actif (`https://` sans erreur certificat)
- [ ] Migrations SQL appliquées (`\dt` liste toutes les tables)
- [ ] Premier établissement créé via `/api/v1/setup`
- [ ] Firewall UFW actif (22/80/443 seulement)
- [ ] `.env.production` : chmod 600, aucun placeholder restant
- [ ] Uptime Robot configuré
- [ ] `eas.json` mis à jour avec l'URL réelle (`https://api.VOTRE-DOMAINE.com/api/v1`)

---

## Commandes utiles de maintenance

```bash
# Voir les logs de toutes les API errors
docker compose -f docker-compose.prod.yml logs api | grep -i error

# Accéder à la DB PostgreSQL
docker exec -it ecole_postgres_prod psql -U ecolemanager -d ecolemanager_prod

# Redémarrer uniquement l'API (sans toucher à la DB)
docker compose -f docker-compose.prod.yml restart api

# Backup de la base de données
docker exec ecole_postgres_prod pg_dump -U ecolemanager ecolemanager_prod \
  | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz

# Renouvellement TLS (automatique via cron dans le conteneur certbot)
docker exec ecole_certbot certbot renew --quiet
docker exec ecole_nginx_prod nginx -s reload
```

---

## Estimation des coûts

| Poste | Coût | Fréquence |
|-------|------|-----------|
| Hetzner CX22 | ~6 USD | /mois |
| Nom de domaine .com | ~12 USD | /an |
| Cloudflare R2 (bulletins) | 0 USD (< 10 Go) | /mois |
| Africa's Talking SMS | ~0.004 USD/SMS | À l'usage |
| Let's Encrypt TLS | 0 USD | Gratuit |
| **Total récurrent** | **~6 USD + SMS** | /mois |
