# EcoleManager — Application Mobile
## React Native / Expo · Offline-First · Afrique de l'Ouest

---

## 🚀 Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
echo 'EXPO_PUBLIC_API_URL=https://api.ecolemanager.io/api/v1' > .env

# 3. Démarrer en développement
npx expo start

# Scanner le QR code avec l'app Expo Go (Android/iOS)
```

---

## 📱 Fonctionnalités

### Enseignant
| Écran | Description |
|-------|-------------|
| Tableau de bord | EDT du jour, actions rapides, stats |
| Faire l'appel | Saisie présences avec statuts (présent/absent/retard/dispensé) |
| Saisir les notes | Saisie en masse avec navigation clavier, calcul moyenne temps réel |
| Évaluations | Liste + création (devoir, composition, TP, exposé…) |
| Moyennes | Classement élèves par matière avec graphe |

### Parent
| Écran | Description |
|-------|-------------|
| Tableau de bord | Vue globale multi-enfants (bulletin, absences, dernières notes) |
| Absences | Historique filtré justifié/injustifié |
| Notes | Notes groupées par matière avec moyennes |
| Bulletins | Bulletins trimestriels téléchargeables en PDF |

### Commun
| Écran | Description |
|-------|-------------|
| Connexion | MDP (enseignants) + OTP SMS 6 chiffres (parents) |
| Profil | Infos session, sync manuelle, déconnexion |

---

## 🔄 Stratégie Offline-First

```
App démarre
    │
    ├── ouvrirBD()          → SQLite local initialisé
    ├── chargerSession()    → JWT depuis SecureStore
    └── syncService.start() → Sync descendante immédiate

Toutes les 5 min (si connecté)
    └── GET /sync?depuis=last_sync → actualisation données

Saisie offline
    ├── Données sauvegardées en SQLite (synced=0)
    └── ajouterOperationPendante() → file d'attente

Reconnexion
    └── POST /sync/operations → envoi batch → synced=1
```

---

## 🏗️ Architecture

```
app/                        # Expo Router — file-based routing
├── _layout.tsx             # Root layout (init DB, session, sync)
├── index.tsx               # Redirect selon rôle
├── auth/
│   └── connexion.tsx       # Login MDP + OTP SMS
└── (app)/
    ├── _layout.tsx         # Guard authentification
    ├── enseignant/
    │   ├── index.tsx       # Tableau de bord
    │   ├── appel.tsx       # Saisie présences
    │   ├── notes-saisie.tsx# Saisie notes
    │   ├── evaluations.tsx # Liste + création
    │   └── moyennes.tsx    # Classement par matière
    ├── parent/
    │   ├── index.tsx       # Tableau de bord multi-enfants
    │   ├── absences.tsx    # Historique absences
    │   ├── notes.tsx       # Notes par matière
    │   └── bulletins.tsx   # Bulletins PDF
    └── commun/
        └── profil.tsx      # Profil + déconnexion

src/
├── services/
│   ├── api/client.ts       # HTTP + auth + fallback offline
│   ├── storage/database.ts # SQLite — 12 tables
│   └── sync/syncService.ts # Sync bidirectionnelle
├── stores/
│   └── authStore.ts        # Zustand — session JWT
├── components/ui/          # Design system complet
└── utils/theme.ts          # Palette, typo, spacing
```

---

## 📲 Build de production

```bash
# Android APK
eas build --platform android --profile preview

# iOS TestFlight
eas build --platform ios --profile preview

# Les deux
eas build --platform all
```

---

## 🛠️ Variables d'environnement

| Variable | Description | Exemple |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | URL de l'API backend | `https://api.ecolemanager.io/api/v1` |

---

## 🌍 Pays ciblés

Sénégal, Côte d'Ivoire, Mali, Burkina Faso, Guinée, Cameroun, Bénin, Togo

**Contraintes terrain prises en compte :**
- Connexion 2G/3G intermittente → offline-first avec SQLite
- Enseignants peu habitués aux smartphones → UX simplifiée
- Parents reçoivent les alertes par SMS (OTP) ou WhatsApp
- Numéros de téléphone locaux (+221, +225, +223…)
