# EcoleManager — Guide de publication Google Play Store

> Prérequis : Phase 1 (assets + EAS init) et Phase 2 (VPS + URL prod) terminées
> Durée estimée : 2 à 4 semaines (revue Google incluse)
> Compte Google Play Developer : 25 USD (frais uniques)

---

## 0. Prérequis avant de commencer

| Élément | Statut attendu |
|---------|---------------|
| `mobile/src/assets/` | 5 fichiers PNG créés |
| `eas init` executé | `projectId` réel dans `app.json` |
| VPS déployé | `https://api.VOTRE-DOMAINE.com/health` → 200 |
| `eas.json` production | URL prod réelle (pas de placeholder) |
| Compte Google Play | Inscrit et payé (25 USD) |
| Politique de confidentialité | URL publique disponible |

---

## 1. Créer le compte Google Play Developer

1. Aller sur [play.google.com/console](https://play.google.com/console)
2. Cliquer sur **Commencer** → Se connecter avec un compte Google dédié
3. Payer les **25 USD** de frais d'inscription (uniques, non remboursables)
4. Remplir le profil développeur :
   - Nom du développeur : `SAFTH Enterprise` (ou votre entité)
   - Email de contact : adresse professionnelle
   - Téléphone de contact : numéro valide pour vérification
   - Adresse physique : requise pour les applications éducatives
5. Accepter les accords de distribution

---

## 2. Construire l'AAB de production

### Vérifications avant le build

```bash
cd mobile

# Vérifier que les assets existent
ls src/assets/
# → icon.png adaptive-icon.png splash.png favicon.png notification-icon.png

# Vérifier app.json
cat app.json | grep -E "bundleIdentifier|package|projectId"
# → "bundleIdentifier": "com.ecolemanager.mobile"   (sans faute)
# → "package": "com.ecolemanager.mobile"
# → "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  (vrai UUID EAS)

# Vérifier eas.json production
cat eas.json | grep -A3 '"production"'
# → EXPO_PUBLIC_API_URL doit pointer sur votre vrai domaine HTTPS
```

### Build EAS production

```bash
cd mobile

# Se connecter à Expo (si pas encore fait)
eas login

# Build Android App Bundle (AAB) pour le Play Store
eas build --platform android --profile production

# Le build prend 10 à 20 minutes sur les serveurs EAS
# Suivre la progression sur https://expo.dev/projects/[slug]/builds
# Télécharger le fichier .aab depuis la console Expo après le build
```

---

## 3. Créer l'application dans la Play Console

1. Dans [play.google.com/console](https://play.google.com/console) :
   **Toutes les applications** → **Créer une application**

2. Remplir les infos de base :
   - **Nom** : `EcoleManager`
   - **Langue par défaut** : Français
   - **Application ou jeu** : Application
   - **Gratuite ou payante** : Gratuite
   - Accepter les politiques
   - **Créer l'application**

---

## 4. Remplir la fiche Play Store

### 4.1 Présence sur le Play Store (onglet "Présence sur le Play Store")

**Description courte** (80 caractères max) :
```
Gestion scolaire offline-first pour les écoles d'Afrique de l'Ouest
```

**Description complète** (4000 caractères max) — exemple en français :
```
EcoleManager est l'application de gestion scolaire conçue pour les établissements
d'enseignement en Afrique de l'Ouest francophone.

FONCTIONNALITÉS ENSEIGNANTS
• Appel de présences avec saisie hors ligne
• Saisie des notes et évaluations sans connexion internet
• Consultation de l'emploi du temps
• Synchronisation automatique dès que la connexion revient

FONCTIONNALITÉS PARENTS
• Suivi des absences de votre enfant en temps réel
• Consultation des notes et moyennes par matière
• Téléchargement des bulletins scolaires au format PDF
• Alertes SMS automatiques en cas d'absence

CONÇU POUR L'AFRIQUE DE L'OUEST
• Fonctionne sans connexion internet (mode hors ligne)
• Optimisé pour les réseaux 2G et 3G
• Interface ultra-simple pour tous les profils d'utilisateurs
• Notifications via SMS et WhatsApp

SÉCURITÉ ET CONFIDENTIALITÉ
• Données chiffrées et stockées localement sur votre téléphone
• Aucune donnée vendue à des tiers
• Conformité aux réglementations locales de protection des données

EcoleManager est développé par SAFTH Enterprise pour améliorer la communication
entre les écoles et les familles en Afrique de l'Ouest.
```

### 4.2 Icônes et captures d'écran

**Icône haute résolution** : 512×512 px PNG
```bash
# Redimensionner icon.png en 512×512
python3 -c "
from PIL import Image
img = Image.open('mobile/src/assets/icon.png')
img.thumbnail((512, 512), Image.LANCZOS)
img.save('mobile/src/assets/icon-512.png', 'PNG')
print('icon-512.png créée')
"
```

**Graphique de feature** : 1024×500 px (requis pour le Play Store)
- Créer avec Canva, Figma ou autre outil
- Montrer l'application en action sur fond vert `#1A4731`
- Texte : "Gérez votre école hors ligne"

**Captures d'écran** (min 2, recommandé 4-6) pour phone Android :
- Dimensions : entre 320px et 3840px, ratio entre 16:9 et 1:2
- Recommandé : `1080×1920` px (portrait)

Écrans à capturer :
1. Écran enseignant — liste des présences
2. Écran enseignant — saisie des notes
3. Écran parent — tableau de bord avec notes
4. Écran parent — consultation des absences
5. Écran de connexion (si visuellement propre)

Pour capturer depuis un émulateur Android :
```bash
# Démarrer l'émulateur avec Expo
cd mobile
npx expo start --android

# Capturer depuis Android Studio ou :
adb shell screencap -p /sdcard/screenshot.png
adb pull /sdcard/screenshot.png ./screenshots/
```

### 4.3 Catégorisation

| Champ | Valeur |
|-------|--------|
| Catégorie | Éducation |
| Balises | école, notes, absences, enseignant, parent |
| Email de contact | votre-email@domaine.com |
| Site web | https://VOTRE-DOMAINE.com (ou page GitHub Pages) |
| Politique de confidentialité | URL obligatoire (voir section 5) |

---

## 5. Politique de confidentialité (OBLIGATOIRE)

Google Play exige une URL publique vers une politique de confidentialité pour toute
application accédant à des données personnelles.

### Créer la page (GitHub Pages — solution rapide)

1. Créer un dépôt GitHub public `ecolemanager-privacy`
2. Créer `index.html` avec le contenu suivant :
3. Activer GitHub Pages : Settings → Pages → Source: main branch
4. URL : `https://VOTRE-USERNAME.github.io/ecolemanager-privacy/`

### Contenu de la politique de confidentialité

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Politique de confidentialité — EcoleManager</title>
</head>
<body>
  <h1>Politique de confidentialité — EcoleManager</h1>
  <p>Dernière mise à jour : [DATE]</p>

  <h2>1. Données collectées</h2>
  <p>EcoleManager collecte les données suivantes :</p>
  <ul>
    <li>Numéros de téléphone des enseignants et parents</li>
    <li>Noms et prénoms des élèves (sans date de naissance)</li>
    <li>Données scolaires : notes, absences, bulletins</li>
  </ul>

  <h2>2. Utilisation des données</h2>
  <p>Ces données sont utilisées exclusivement pour :</p>
  <ul>
    <li>Envoyer des notifications SMS et WhatsApp aux parents</li>
    <li>Afficher les informations scolaires aux enseignants et parents autorisés</li>
    <li>Générer les bulletins scolaires au format PDF</li>
  </ul>

  <h2>3. Stockage et sécurité</h2>
  <p>Les données sont stockées :</p>
  <ul>
    <li>Localement sur votre appareil (SQLite chiffré)</li>
    <li>Sur notre serveur sécurisé (Hetzner Cloud, Union Européenne)</li>
    <li>Les bulletins PDF sur Cloudflare R2 (chiffré au repos)</li>
  </ul>
  <p>Nous n'utilisons pas de publicité et ne vendons aucune donnée à des tiers.</p>

  <h2>4. Droits des utilisateurs</h2>
  <p>Pour toute demande de suppression ou d'accès à vos données,
  contactez-nous à : <a href="mailto:privacy@VOTRE-DOMAINE.com">privacy@VOTRE-DOMAINE.com</a></p>

  <h2>5. Conformité réglementaire</h2>
  <p>Cette application est conforme aux lois de protection des données
  en vigueur dans les pays cibles (CDPDP au Sénégal, APDP en Côte d'Ivoire).</p>

  <h2>6. Contact</h2>
  <p>SAFTH Enterprise — <a href="mailto:contact@VOTRE-DOMAINE.com">contact@VOTRE-DOMAINE.com</a></p>
</body>
</html>
```

---

## 6. Configuration "Accès à l'application"

Dans Play Console → Accès à l'application :
- **L'application nécessite-t-elle une connexion ?** Oui
- Ajouter des instructions de test :
  - Email de test : `directeur@test-ecolemanager.com`
  - Mot de passe : `TestPass2024!`
  - Code établissement : `TEST-001`
  - Note : "Créer d'abord un établissement via le formulaire d'inscription"

---

## 7. Évaluation du contenu (questionnaire Play Console)

Répondre au questionnaire de contenu :

| Question | Réponse |
|----------|---------|
| Violence | Non |
| Sexualité | Non |
| Langage | Non |
| Substances | Non |
| Données personnelles collectées | Oui (informations de contact) |
| Données d'enfants | Oui (notes d'élèves mineurs) |
| Contenu cible | Adultes (enseignants, parents) |

Pour les données d'enfants mineurs, cocher la case correspondante et indiquer que l'application cible les adultes (parents et enseignants), pas les enfants directement.

---

## 8. Soumettre le build

### Option A : Upload depuis la Play Console

1. Dans Play Console → **Production** → **Créer une release**
2. Télécharger le fichier `.aab` (téléchargé depuis expo.dev)
3. Ajouter les notes de version en français
4. **Enregistrer** → **Vérifier la release** → **Lancer la mise en production**

### Option B : Via EAS Submit

```bash
cd mobile

# Configurer les credentials Google Play dans eas.json si pas fait
# Télécharger la clé API depuis Play Console :
# Setup > API access > Create service account > Download JSON

eas submit \
  --platform android \
  --profile production \
  --path chemin/vers/votre-build.aab
```

---

## 9. Chronologie de revue Google

| Phase | Délai | Action requise |
|-------|-------|---------------|
| Soumission initiale | — | Cliquer "Soumettre pour revue" |
| Revue Google | 3 à 7 jours | Attendre — vérifier les emails |
| Approbation | — | Application visible sur Play Store |
| Mise à jour | 1 à 3 jours | Délai plus court pour les updates |
| Rejet | — | Corriger le motif + resoumettre |

Causes fréquentes de rejet :
- Politique de confidentialité manquante ou insuffisante
- Captures d'écran de mauvaise qualité ou trompeuses
- Métadonnées incomplètes (email de contact manquant)
- Application qui plante au démarrage (tester avant)

---

## 10. Stratégie de lancement par phases

Pour un produit EdTech en Afrique de l'Ouest, ne pas publier directement à 100%.

### Phase 0 — Track interne (J0, immédiat)

```
Play Console → Track interne → Ajouter des testeurs (emails Google)
```
- Inviter 5 à 10 comptes Google d'utilisateurs pilotes
- Délai : disponible immédiatement
- Objectif : valider l'installation et le login

### Phase 1 — Track de test fermé (J+2 semaines après approbation)

```
Play Console → Tests fermés → Créer une release → Inviter par lien
```
- Inviter 20 à 50 enseignants et parents d'établissements pilotes
- Collecter les retours via formulaire Google Forms
- Durée recommandée : 2 semaines

### Phase 2 — Production avec déploiement progressif (J+4 semaines)

```
Play Console → Production → Lancer sur 20% des utilisateurs
```
- Surveiller les crashs dans Android Vitals (Play Console)
- Augmenter : 20% → 50% → 100% sur 1 à 2 semaines
- Monitoring : vérifier `/health` et les logs API

---

## 11. Après la publication

### Surveiller Android Vitals

Dans Play Console → Android Vitals :
- Taux de crash cible : < 1%
- ANR (Application Not Responding) : < 0.47%
- Si les seuils sont dépassés, l'application peut être dépubliée automatiquement

### Répondre aux avis

- Répondre à tous les avis négatifs dans les 48h
- Les avis 1-2 étoiles sans réponse impactent le score

### Publier des mises à jour

```bash
# Incrémenter versionCode dans app.json avant chaque build
# (versionCode doit être strictement supérieur à la version précédente)
# ex: "versionCode": 2  → "versionCode": 3

cd mobile
eas build --platform android --profile production
# Puis soumettre le nouveau .aab dans Play Console
```

---

## Checklist publication

- [ ] Compte Google Play Developer créé et vérifié (25 USD payés)
- [ ] Politique de confidentialité publiée en ligne (URL valide)
- [ ] `app.json` : `bundleIdentifier` = `com.ecolemanager.mobile` (sans faute)
- [ ] `eas.json` production : URL API réelle HTTPS
- [ ] Build AAB réussi (`eas build --platform android --profile production`)
- [ ] Icône 512×512 préparée
- [ ] Graphique de feature 1024×500 préparé
- [ ] Min. 2 captures d'écran (recommandé : 4-6) de phone Android
- [ ] Description courte (80 chars max) rédigée en français
- [ ] Description complète rédigée en français
- [ ] Email de contact configuré dans la fiche
- [ ] Questionnaire de contenu complété
- [ ] Credentials Google Play configurés (pour EAS Submit ou upload manuel)
- [ ] Test interne avec compte Google de test validé (login → dashboard)
- [ ] Soumis au track de test fermé avant production
