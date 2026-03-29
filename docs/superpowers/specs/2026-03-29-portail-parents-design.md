# Portail Parents — Design Spec

**Date :** 2026-03-29
**Statut :** Approuvé

---

## Objectif

Créer le portail web dédié aux parents d'élèves d'EcoleManager. Les parents peuvent consulter les notes, absences et bulletins de leur(s) enfant(s) depuis n'importe quel navigateur.

---

## Architecture

### Principes directeurs

- **Frontend uniquement** — tous les endpoints backend parents sont déjà implémentés (`/parents/moi/*`)
- **Même pattern que `enseignant.html`** — sidebar fixe, routing hash, fichiers `par-*.js`
- **Zéro dépendance NPM** — HTML/CSS/JS vanilla ES2017+, réutilise `api.js`, `auth.js`, `ui.js`, `config.js`
- **Page de login dédiée** — `parent-login.html` séparé de `login.html` pour isoler le flow OTP

### Authentification

Les parents se connectent par **OTP SMS** (pas de mot de passe) :
1. Saisir numéro de téléphone + code établissement → `POST /auth/otp/demander`
2. Recevoir un code à 6 chiffres par SMS (valable 10 min)
3. Saisir le code → `POST /auth/otp/valider` → JWT stocké dans `localStorage`
4. Redirection vers `parent.html`

`auth.js` est modifié pour détecter `role === 'parent'` et rediriger vers `parent.html` après login normal (au cas où un parent aurait aussi un compte standard).

### Structure des fichiers

| Fichier | Action | Rôle |
|---------|--------|------|
| `dashboard/parent-login.html` | Créer | Login OTP 2 étapes |
| `dashboard/parent.html` | Créer | Portail parent — 4 pages + modals |
| `dashboard/js/par-router.js` | Créer | Routing hash (même pattern `ens-router.js`) |
| `dashboard/js/par-app.js` | Créer | Init, auth check, sélecteur d'enfant |
| `dashboard/js/pages/par-dashboard.js` | Créer | KPI + dernières notes + absences récentes |
| `dashboard/js/pages/par-notes.js` | Créer | Notes par matière, filtrables par période |
| `dashboard/js/pages/par-absences.js` | Créer | Récapitulatif + liste détaillée absences/retards |
| `dashboard/js/pages/par-bulletins.js` | Créer | Bulletins trimestriels avec moyennes par matière |
| `dashboard/js/auth.js` | Modifier | Ajouter redirection `parent.html` si `role === 'parent'` |

---

## Pages du portail

### parent-login.html

Flow en 2 étapes sur la même page :

**Étape 1 — Identification**
- Champ téléphone (type `tel`)
- Champ code établissement
- Bouton "Recevoir le code SMS" → `POST /auth/otp/demander`
- Lien "Personnel de l'école ? → login.html"

**Étape 2 — Vérification OTP** (affichée après succès étape 1)
- 6 inputs individuels pour les chiffres (auto-focus, auto-advance)
- Bouton "Connexion" → `POST /auth/otp/valider` → stockage JWT → redirect `parent.html`
- Lien "Pas reçu ? Renvoyer" (cooldown 60s)

### parent.html — Layout

Identique à `enseignant.html` :
- **Sidebar fixe** (160px) avec logo, nav verticale, user info
- **Sélecteur d'enfant** en bas de sidebar (select HTML) — si le parent a plusieurs enfants, switcher recharge la page active
- **Topbar** avec titre de page et date
- **Content area** avec 4 pages `<div class="page">`

### Page 1 — Tableau de bord (`par-dashboard`)

API : `GET /parents/moi/tableau-de-bord`

- Salutation avec prénom du parent
- **3 KPI** pour l'enfant actif : Moyenne générale · Absences totales · Mention
- **Widget "Dernières notes"** : 3 dernières notes publiées (matière, note, date)
- **Widget "Absences récentes"** : compteurs justifiées/injustifiées/retards

### Page 2 — Notes (`par-notes`)

API : `GET /parents/moi/enfants/:id/notes`

- Filtre par période (select)
- Liste groupée **par matière** : nom matière + couleur + liste des notes (type, valeur/noteMax, date, appréciation)
- Comparaison avec la moyenne classe quand disponible
- Message si `peut_voir_notes === false` : "Accès aux notes non autorisé pour cet enfant"

### Page 3 — Absences (`par-absences`)

API : `GET /parents/moi/enfants/:id/absences`

- **Récapitulatif par trimestre** : tableau justifiées / injustifiées / retards
- **Liste détaillée** : date, matière, horaire, statut, justification si disponible
- Message si `peut_voir_absences === false`

### Page 4 — Bulletins (`par-bulletins`)

API : `GET /parents/moi/enfants/:id/bulletins`

- Liste des bulletins disponibles par trimestre (cards)
- Au clic : affichage du détail — moyennes par matière, moyenne générale, rang, mention, décision conseil
- Lien bulletin PDF si `bulletin_url` disponible
- Message si `peut_voir_bulletins === false` ou aucun bulletin généré

---

## Gestion multi-enfants

- `par-app.js` charge `GET /parents/moi/enfants` au démarrage
- L'enfant actif est stocké dans `localStorage` (`par_enfant_actif`)
- Le sélecteur en sidebar permet de switcher — au changement : rechargement des données de la page active
- Si un seul enfant : sélecteur non affiché (affiche juste le nom)

---

## Permissions par enfant

Le backend expose des flags par enfant (`peut_voir_notes`, `peut_voir_absences`, `peut_voir_bulletins`). Les pages correspondantes vérifient ces flags et affichent un message d'accès refusé si nécessaire. Les items de navigation restent visibles.

---

## Endpoints backend utilisés

| Endpoint | Page |
|----------|------|
| `POST /auth/otp/demander` | parent-login (étape 1) |
| `POST /auth/otp/valider` | parent-login (étape 2) |
| `GET /parents/moi/enfants` | par-app (init) |
| `GET /parents/moi/tableau-de-bord` | par-dashboard |
| `GET /parents/moi/enfants/:id/notes` | par-notes |
| `GET /parents/moi/enfants/:id/absences` | par-absences |
| `GET /parents/moi/enfants/:id/bulletins` | par-bulletins |

---

## Ce qui n'est PAS dans ce scope

- Génération de bulletins PDF (feature séparée)
- Messagerie parent ↔ école
- Paiement scolarité
- Notifications push (les SMS sont gérés côté backend)
