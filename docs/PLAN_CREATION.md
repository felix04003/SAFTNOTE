# EcoleManager — Plan de Creation et Finalisation

> Produit par ATLAS — Architecture & Planning Commander
> Date : 2026-08-05
> Etat de depart : Backend 100% (108/108 tests), Dashboard 100%, Mobile code ecrit — bloque sur assets

---

## Etat actuel — Diagnostic

### Ce qui est 100% pret

| Composant | Etat | Detail |
|-----------|------|--------|
| Backend API | Termine | 39 endpoints, 108 tests, Swagger OpenAPI 3.0 |
| Migrations SQL | Terminees | 000→007, script run_all_migrations.sql |
| Dashboard web | Termine | 10 pages HTML/CSS/JS vanilla |
| CI/CD GitHub Actions | Operationnel | lint + tests + Docker build |
| docker-compose.prod.yml | Pret | PostgreSQL 16 + Redis 7 + Nginx + Certbot |
| deploy.sh | Pret | git pull + npm ci + migrations + PM2 reload |
| ecosystem.config.js | Pret | 4 processus PM2 (API cluster, 3 workers) |
| nginx/ | Pret | conf.d/ + nginx.conf |

### Ce qui est bloque

| Bloquant | Impact | Priorite |
|----------|--------|----------|
| Assets manquants (icon.png, splash.png, adaptive-icon.png, favicon.png, notification-icon.png) | Build EAS impossible | CRITIQUE |
| `eas.projectId` = "YOUR_EAS_PROJECT_ID" | EAS CLI refuse le build | CRITIQUE |
| URL prod fictive dans eas.json (`api.ecolemanager.com`) | APK pointe sur URL inexistante | HAUTE |
| Aucun test mobile ecrit | Fiabilite inconnue | HAUTE |
| VPS non provisionne | Backend non deploye | HAUTE |
| Nom de domaine non acquis | TLS/Nginx inutilisable | MOYENNE |

### Ce qui existe dans le code mobile

- 18 fichiers TypeScript ecrits : 9 ecrans (5 enseignant + 4 parent), layout guards, auth, sync
- SQLite 12 tables locales, sync bidirectionnel 5 min, Zustand auth store
- 9 composants UI design system (Bouton, Carte, Entete, Loader, etc.)
- Services : client HTTP + retry, syncService, database.ts
- Palette de couleurs, typographie, spacing dans `src/utils/theme.ts`

---

## Phase 1 — Debloquer le Mobile

**Complexite : Moyenne**
**Duree estimee : 3-5 jours**
**Prerequis : Compte Expo EAS, Adobe/Figma ou outil de generation d'images**

### 1.1 — Creer les assets visuels

Tous les assets sont references dans `app.json` sous `./src/assets/`. Le repertoire
`mobile/src/assets/` n'existe pas encore.

**Fichiers a creer :**

| Fichier | Dimensions | Usage |
|---------|-----------|-------|
| `src/assets/icon.png` | 1024x1024 px | Icone principale iOS/Android |
| `src/assets/splash.png` | 2048x2048 px | Ecran de chargement |
| `src/assets/adaptive-icon.png` | 1024x1024 px | Icone adaptative Android (foreground) |
| `src/assets/favicon.png` | 32x32 ou 64x64 px | Icone web |
| `src/assets/notification-icon.png` | 96x96 px, fond blanc ou transparent | Notifications Android |

**Contraintes design :**
- Couleur principale : `#1A4731` (vert fonce, fond splash et adaptive icon)
- Couleur secondaire : `#2C6E49` (vert moyen, notifications)
- Le logo doit evoquer "ecole" et "Afrique de l'Ouest" — pas de design generique
- Format PNG sans couche alpha pour icon.png (requis par Apple)
- Pour adaptive-icon.png : foreground seulement, le backgroundColor `#1A4731` est deja dans app.json

**Option rapide :** Utiliser `npx expo-optimize` ou `npx create-expo-app` comme reference
de gabarit, puis personnaliser. Canva Pro ou Figma permettent d'exporter aux bonnes dimensions.

**Outils alternatifs :**
```bash
# Generer des placeholders PNG programmatiquement (sharp, jimp ou pillow)
npm install -g sharp-cli
# Ou via Python
python3 -c "
from PIL import Image, ImageDraw, ImageFont
import os
os.makedirs('mobile/src/assets', exist_ok=True)
# icon 1024x1024 vert fonce avec texte 'EM'
img = Image.new('RGB', (1024,1024), '#1A4731')
img.save('mobile/src/assets/icon.png')
"
```

### 1.2 — Initialiser EAS

```bash
cd mobile

# Installer EAS CLI si absent
npm install -g eas-cli

# Connexion au compte Expo (creer un compte sur expo.dev si besoin)
eas login

# Initialiser le projet — genere le vrai projectId dans app.json
eas init

# Verifier que app.json contient maintenant un vrai UUID :
# "eas": { "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
```

**Points d'attention :**
- `eas init` modifie `app.json` en place — committer apres
- Le `projectId` est lie au compte Expo — un seul compte pour l'equipe
- Si le slug `ecole-manager` est deja pris sur expo.dev, il faudra en choisir un autre

### 1.3 — Corriger les URLs dans eas.json

Une fois le VPS provisionne (Phase 2), mettre a jour `eas.json` :

```json
// eas.json — profil preview
"EXPO_PUBLIC_API_URL": "https://api.VOTRE-DOMAINE.com/api/v1"

// eas.json — profil production
"EXPO_PUBLIC_API_URL": "https://api.VOTRE-DOMAINE.com/api/v1"
```

**Pour la Phase 1, utiliser l'IP publique du VPS provisoire :**
```json
"EXPO_PUBLIC_API_URL": "http://XX.XX.XX.XX:3000/api/v1"
```

### 1.4 — Ecrire les tests mobiles

Le projet `mobile/package.json` inclut `jest-expo` mais aucun test n'existe.

**Structure recommandee :**
```
mobile/
  __tests__/
    services/
      syncService.test.ts    # mock Network, mock db — teste la logique de sync
      database.test.ts       # ouvrirBD(), creerTables() avec SQLite en memoire
    components/
      Bouton.test.tsx        # snapshot + comportement onPress
      Entete.test.tsx        # snapshot
    screens/
      enseignant/
        appel.test.tsx       # mock expo-sqlite, mock api client
      parent/
        notes.test.tsx
    stores/
      authStore.test.ts      # login, logout, session persistence
```

**Tests critiques a ecrire en priorite :**
1. `syncService` : logique sync descendante avec mocks Network + DB
2. `authStore` : gestion session JWT, deconnexion
3. `database.ts` : creation des 12 tables, upsert idempotent

**Commande :**
```bash
cd mobile && npm test
```

### 1.5 — Validation build local

```bash
cd mobile

# Installer les dependances
npm install

# Verifier le TypeScript (deja dans CI)
npx tsc --noEmit

# Build de developpement (necessite un device Android ou simulateur)
eas build --platform android --profile development --local

# Ou via Expo Go pour test rapide (sans build natif)
npx expo start
```

---

## Phase 2 — Deploiement Backend VPS

**Complexite : Moyenne**
**Duree estimee : 1-2 jours**
**Prerequis : Compte Hetzner, nom de domaine, serveur configure**

### 2.1 — Provisionner le VPS Hetzner CX22

**Specifications CX22 :**
- 2 vCPU, 4 Go RAM, 40 Go SSD
- OS : Ubuntu 22.04 LTS
- ~6$/mois

**Etapes :**
1. Creer le serveur sur console.hetzner.com
2. Configurer une cle SSH (ne jamais utiliser le mot de passe root)
3. Creer un utilisateur non-root :
```bash
adduser ecolemanager
usermod -aG sudo ecolemanager
# Copier la cle SSH
```

### 2.2 — Configurer le VPS

```bash
# Mise a jour systeme
sudo apt update && sudo apt upgrade -y

# Installer Docker + Docker Compose v2
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Verifier
docker --version && docker compose version
```

### 2.3 — Deployer avec Docker Compose

```bash
# Cloner le repo (ou rsync depuis local)
git clone https://github.com/VOTRE-ORG/ecolemanager.git
cd ecolemanager

# Creer le fichier de secrets
cp .env.example .env.production
nano .env.production
```

**Variables .env.production obligatoires :**
```bash
POSTGRES_DB=ecolemanager_prod
POSTGRES_USER=ecolemanager
POSTGRES_PASSWORD=<mot-de-passe-fort-32-chars>
REDIS_PASSWORD=<mot-de-passe-fort-24-chars>
JWT_SECRET=<secret-aleatoire-64-chars>

# Africa's Talking (SMS)
AT_API_KEY=<cle-api-africas-talking>
AT_USERNAME=<username>

# WhatsApp Business API (optionnel phase 1)
META_WA_TOKEN=
META_WA_PHONE_NUMBER_ID=
META_WA_VERIFY_TOKEN=

# Cloudflare R2 (bulletins PDF)
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY=<r2-access-key>
S3_SECRET_KEY=<r2-secret-key>
S3_BUCKET=ecolemanager-bulletins

FRONTEND_URL=https://VOTRE-DOMAINE.com
MONITORING_TOKEN=<token-aleatoire>
IMAGE_TAG=latest
```

```bash
# Premier lancement
docker compose -f docker-compose.prod.yml up -d

# Appliquer les migrations SQL
docker exec ecole_api_prod node -e "
const {pool} = require('./src/infrastructure/database/pool');
const fs = require('fs');
const sql = fs.readFileSync('/app/migrations/run_all_migrations.sql', 'utf8');
pool.query(sql).then(() => { console.log('OK'); process.exit(0); });
"
# OU depuis le host avec psql
psql "postgresql://ecolemanager:PASSWORD@localhost:5432/ecolemanager_prod" \
  -f migrations/run_all_migrations.sql
```

**Risque :** Le script `run_all_migrations.sql` utilise `psql` meta-commands (`\c`, `\i`).
Verifier la compatibilite avec `pool.query()` ou utiliser directement `psql`.

### 2.4 — Configurer Nginx et TLS

Le repertoire `nginx/` existe deja. Mettre a jour les noms de domaine :

```bash
# nginx/conf.d/api.conf — remplacer api.ecolemanager.com par votre domaine
server_name api.VOTRE-DOMAINE.com;
```

**Obtenir le certificat TLS :**
```bash
# Premier certificat (le service certbot tourne deja dans docker-compose.prod.yml)
docker exec ecole_certbot certbot certonly \
  --webroot -w /var/www/certbot \
  -d api.VOTRE-DOMAINE.com \
  --email admin@VOTRE-DOMAINE.com \
  --agree-tos --non-interactive

# Recharger Nginx
docker exec ecole_nginx_prod nginx -s reload
```

### 2.5 — Health check et smoke test

```bash
# Health check de base
curl https://api.VOTRE-DOMAINE.com/health

# Health check complet
curl -H "Authorization: Bearer $MONITORING_TOKEN" \
  https://api.VOTRE-DOMAINE.com/health/deep

# Test auth
curl -X POST https://api.VOTRE-DOMAINE.com/api/v1/auth/connexion \
  -H "Content-Type: application/json" \
  -d '{"identifiant":"directeur@test.com","motDePasse":"password123"}'
```

### 2.6 — Configurer le firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 2.7 — Workflow de deploiement continu

Le `deploy.sh` est deja pret. Pour les mises a jour futures depuis le VPS :

```bash
bash deploy.sh
# ou pour sauter les migrations si pas de changement schema :
bash deploy.sh --skip-migrations
```

**Pour le CI/CD complet (optionnel Phase 2) :**
- Ajouter un job GitHub Actions `deploy` qui SSH sur le VPS et execute `deploy.sh`
- Necessite d'ajouter `SSH_PRIVATE_KEY`, `VPS_HOST`, `VPS_USER` en secrets GitHub

---

## Phase 3 — Publication Android (Google Play)

**Complexite : Complexe**
**Duree estimee : 2-4 semaines (majoritairement attente Play Store)**
**Prerequis : Phase 1 + Phase 2 terminees, compte Google Play Developer (25$ unique)**

### 3.1 — Preparer le compte Google Play

1. Creer un compte Google Play Developer sur play.google.com/console
2. Payer les 25$ de frais d'inscription (unique)
3. Completer le profil developpeur (informations legales, adresse)
4. Accepter les accords de distribution

### 3.2 — Build AAB (Android App Bundle)

```bash
cd mobile

# S'assurer que les URL pointent sur le vrai serveur prod (Phase 2 requise)
# Verifier eas.json profil production : EXPO_PUBLIC_API_URL correcte

# Build production — genere un .aab sur les serveurs Expo
eas build --platform android --profile production

# Le build prend ~10-20 min sur les serveurs EAS
# Telecharger le .aab depuis expo.dev/projects/...
```

### 3.3 — Creer la fiche Play Store

**Elements requis :**
- Nom de l'application : "EcoleManager" (max 50 chars)
- Description courte : max 80 chars (ex: "Gestion scolaire offline pour l'Afrique de l'Ouest")
- Description complete : max 4000 chars — en francais
- Icone haute resolution : 512x512 px PNG (le meme que icon.png redimensionne)
- Graphique de feature : 1024x500 px
- Captures d'ecran : min 2, max 8 (phones Android)
  - Ecran enseignant : appel, notes
  - Ecran parent : tableau de bord, bulletins
- Categorie : Education
- Politique de confidentialite : URL obligatoire (une page simple suffit)
- Public cible : Adultes

### 3.4 — Politique de confidentialite

Creer une page web minimaliste (GitHub Pages ou Notion suffisent) avec :
- Quelles donnees sont collectees (numeros de telephone, notes des eleves)
- Comment elles sont utilisees (notifications SMS/WhatsApp aux parents)
- Qui les stocke (VPS Hetzner, Cloudflare R2)
- Contact pour suppression

**Risque RGPD/APDP :** Les donnees d'eleves mineurs sont des donnees sensibles.
Verifier la conformite avec l'autorite de protection des donnees du pays cible
(CDPDP au Senegal, APDP en Cote d'Ivoire).

### 3.5 — Soumettre pour review

```bash
# Soumettre directement depuis EAS (si eas.json submit configure)
eas submit --platform android --profile production

# OU manuellement depuis la Play Console
# Telechargement du .aab > Tests internes > Examiner et publier
```

**Chronologie Google Play :**
- Test interne : disponible immediatement (pour l'equipe)
- Test ferme/ouvert : 2-7 jours de review
- Production : 3-7 jours de review (premiere soumission)
- Mises a jour ulterieures : generalement 1-3 jours

### 3.6 — Strategie de lancement en phases

Recommandation pour un produit EdTech Afrique de l'Ouest :

1. **Phase alpha (J0)** : Track interne — partager avec 5-10 etablissements pilotes
2. **Phase beta (J+2 semaines)** : Track test ferme — 50-100 utilisateurs
3. **Production (J+4 semaines)** : Release graduee 20% → 50% → 100%

---

## Phase 4 — Ameliorations Futures

**Complexite : Variable**
**Ces phases ne bloquent pas le lancement Android**

### 4.1 — Publication iOS (App Store)

**Prerequis : Compte Apple Developer (99$/an), Mac avec Xcode**

```bash
# Build iOS
eas build --platform ios --profile production

# Soumettre
eas submit --platform ios --profile production
```

**Difficultes supplementaires vs Android :**
- Review Apple plus stricte (7-14 jours premiere soumission)
- Signature de code plus complexe (provisioning profiles, certificates)
- `bundleIdentifier` deja configure : `com.ecolmanager.mobile` — verifier typo (ecol vs ecole)
- TestFlight disponible pour beta testing (equivalent Play Store interne)

**Note :** Le `bundleIdentifier` dans `app.json` est `com.ecolmanager.mobile` (sans le 'e')
tandis que le `package` Android est `com.ecolemanager.mobile`. A aligner avant soumission iOS.

### 4.2 — Tests d'integration bout-en-bout

```bash
# Avec Detox (tests E2E React Native)
npm install --save-dev detox @types/detox

# Ou Maestro (plus simple, YAML)
brew install maestro
maestro test flows/
```

**Flows prioritaires a couvrir :**
- Login enseignant → faire un appel → saisir notes → sync
- Login parent → voir absences → voir bulletin PDF
- Fonctionnement hors ligne (mode avion) + sync au retour connexion

### 4.3 — Monitoring et alertes

Le backend a deja `/health/deep` et `/metrics`. Ajouter :
- **Uptime Robot** (gratuit) : ping `/health` toutes les 5 min, alerte SMS si down
- **Sentry** : error tracking React Native et Node.js
- **BullMQ Dashboard** : surveiller les queues notifications et bulletins

```bash
# Sentry dans le mobile
npx expo install @sentry/react-native
```

### 4.4 — Features avancees (backlog)

| Feature | Complexite | Impact |
|---------|-----------|--------|
| Paiement frais de scolarite (Wave, Orange Money) | Complexe | Haute |
| Module cantine | Moyenne | Moyenne |
| Application directeur (tableau de bord avance) | Complexe | Haute |
| Rapports statistiques annuels (PDF) | Moyenne | Haute |
| Support multi-annees scolaires dans le mobile | Moyenne | Haute |
| Authentification biometrique (empreinte) | Simple | Moyenne |
| Dark mode | Simple | Basse |

### 4.5 — Optimisations performance mobile

- Code splitting par route (deja supporte par expo-router)
- Images compressees avec expo-image (remplace Image de react-native)
- Prefetch des donnees au login pour une UX offline plus fluide
- Background fetch (sync en arriere-plan, pas seulement toutes les 5 min en foreground)

---

## Dependances entre phases

```
Phase 1.1 (assets) ──┐
Phase 1.2 (EAS init) ─┤
Phase 1.3 (URLs) ─────┤──→ Phase 1.5 (build local) ──→ Phase 3 (Play Store)
Phase 1.4 (tests) ────┘
                              ↑ necessite
Phase 2 (VPS) ────────────────┘ (URL prod reelle)
```

**Chemin critique : Phase 1.1 → Phase 1.2 → Phase 2 → Phase 1.3 → Phase 1.5 → Phase 3**

La Phase 1.4 (tests) et la Phase 4 sont parallelisables.

---

## Risques identifies

| Risque | Probabilite | Impact | Mitigation |
|--------|------------|--------|-----------|
| Slug `ecole-manager` pris sur expo.dev | Moyenne | Faible | Utiliser `ecole-manager-app` ou `ecolemanager-sn` |
| Google Play refuse l'app (manque politique confidentialite) | Haute | Bloquant | Creer la page avant soumission |
| VPS insuffisant pour Puppeteer (bulletins PDF) | Faible | Haute | CX22 a 4Go RAM — Puppeteer utilise ~300-600Mo, OK |
| Dependances React Native incompatibles (react-query v3 + expo 52) | Moyenne | Haute | react-query v3 est ancien — migrer vers @tanstack/react-query v5 |
| `com.ecolmanager.mobile` vs `com.ecolemanager.mobile` | Certaine | Haute | Aligner bundleIdentifier iOS et package Android avant soumission |
| Africa's Talking indisponible dans certains pays | Faible | Haute | Prevoir Twilio en fallback |
| Migration SQL en prod — ordre strict requis | Moyenne | Critique | Toujours executer run_all_migrations.sql dans l'ordre, jamais les scripts individuels hors ordre |

---

## Checklist de lancement

### Pre-lancement (Phase 1 + 2)

- [ ] `mobile/src/assets/` cree avec les 5 fichiers PNG
- [ ] `eas init` execute — `projectId` reel dans `app.json`
- [ ] VPS Hetzner CX22 provisionne et SSH configure
- [ ] `.env.production` rempli avec tous les secrets reels
- [ ] `docker compose -f docker-compose.prod.yml up -d` — tous services `healthy`
- [ ] Migrations SQL appliquees en prod
- [ ] TLS Let's Encrypt actif (`curl https://api.VOTRE-DOMAINE.com/health` → 200)
- [ ] Firewall UFW configure (22/80/443 seulement)
- [ ] `eas.json` URLs mises a jour avec le domaine reel
- [ ] Build EAS preview reussi (APK telecharge et installe sur un device Android)
- [ ] Tests mobiles ecrits et passants (`npm test` dans mobile/)
- [ ] Verification alignement bundleIdentifier iOS / package Android

### Lancement Play Store (Phase 3)

- [ ] Compte Google Play Developer cree et paye
- [ ] Politique de confidentialite publiee en ligne
- [ ] Captures d'ecran preparees (min 2, recommande 4-6)
- [ ] Description app redigee en francais
- [ ] Build AAB (`eas build --platform android --profile production`) reussi
- [ ] Test interne avec 5 utilisateurs minimum
- [ ] Soumission en track de test ferme
- [ ] Approval Google Play → mise en production graduee

---

## Estimation des couts de lancement

| Poste | Cout | Frequence |
|-------|------|-----------|
| VPS Hetzner CX22 | ~6 USD/mois | Mensuel |
| Nom de domaine (.com) | ~12 USD/an | Annuel |
| Cloudflare R2 (stockage bulletins) | ~0 USD (gratuit jusqu'a 10 Go) | Mensuel |
| Africa's Talking (SMS) | ~0.004 USD/SMS | A l'usage |
| EAS Build (Expo) | Gratuit (plan free : 30 builds/mois) | Mensuel |
| Google Play Developer | 25 USD | Une fois |
| Apple Developer (si iOS) | 99 USD/an | Annuel |
| **Total lancement (sans iOS)** | **~43 USD** | Premier mois |
| **Total mensuel recurrent** | **~6 USD + SMS** | Mensuel |

---

## Commandes de reference rapide

```bash
# ── MOBILE ────────────────────────────────────────────────────────
cd mobile
npm install                                          # installer les deps
npx tsc --noEmit                                     # verifier TypeScript
eas login                                            # connexion Expo
eas init                                             # initialiser EAS project
npx expo start                                       # dev server Expo Go
eas build --platform android --profile preview       # APK de test
eas build --platform android --profile production    # AAB Play Store
eas submit --platform android --profile production   # soumettre Play Store

# ── BACKEND LOCAL ────────────────────────────────────────────────
docker-compose up -d                                 # PostgreSQL + Redis + API
cd backend && npm test                               # 108 tests
cd backend && npm run dev                            # API en mode watch

# ── BACKEND PROD (sur le VPS) ────────────────────────────────────
docker compose -f docker-compose.prod.yml up -d
bash deploy.sh                                       # mise a jour zero-downtime

# ── SANTE ────────────────────────────────────────────────────────
curl http://localhost:3000/health
pm2 monit
docker compose -f docker-compose.prod.yml logs -f api
```
