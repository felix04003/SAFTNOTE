# Design — Affectations & Espace Enseignant Web

**Date :** 2026-03-19
**Statut :** Approuvé
**Scope :** Dashboard web EcoleManager (HTML/CSS/JS vanilla)

---

## Contexte

Le dashboard web est aujourd'hui réservé au directeur. Les enseignants utilisent l'app mobile (React Native) pour saisir notes, faire l'appel, etc. La décision est prise d'ouvrir le dashboard web aux enseignants avec le scope complet (version avancée), tout en gardant le directeur avec son interface actuelle.

**Prérequis fonctionnel :** avant qu'un enseignant puisse travailler, le directeur doit lui affecter des classes + matières. Ce module (Affectations) est donc le point de départ obligatoire.

---

## Architecture générale — Interface role-based

**Option retenue : A — même `index.html`, sidebar et pages adaptées selon le rôle.**

À la connexion, le token JWT contient le rôle (`directeur` ou `enseignant`). Le `router.js` et l'`app.js` lisent ce rôle depuis `localStorage` (`em_user.role`) et affichent uniquement les éléments de navigation et pages correspondants.

```
login.html  →  Auth.login()  →  localStorage(em_user.role)
                                        │
              ┌─────────────────────────┴──────────────────────────┐
              │ role = 'directeur'              role = 'enseignant' │
              ▼                                                     ▼
        Sidebar directeur                             Sidebar enseignant
        - Tableau de bord                             - Mon tableau de bord
        - Élèves                                      - Mes classes
        - Enseignants                                 - Mes notes
        - Classes                                     - Appel
        - Notes & Évaluations                         - Mon emploi du temps
        - Bulletins                                   - Messagerie parents
        - Absences                                    - Discipline
        - Paramètres
```

---

## Sous-projet 1 — Affectations (prérequis)

### Objectif

Permettre au directeur d'assigner un enseignant à une classe + matière pour l'année scolaire courante, et de supprimer une affectation existante.

### Nouveaux endpoints backend

Fichier : `backend/src/domains/01-identites/identites.routes.js`

| Méthode | Endpoint | Rôle requis | Description |
|---------|----------|-------------|-------------|
| `GET` | `/matieres` | `config.voir` | Lister les matières actives de l'établissement |
| `POST` | `/matieres` | `config.modifier` | Créer une nouvelle matière |
| `POST` | `/affectations` | `config.modifier` | Créer une affectation enseignant→classe+matière |
| `DELETE` | `/affectations/:id` | `config.modifier` | Supprimer une affectation |

**Payload `POST /affectations` :**
```json
{
  "enseignant_id": "uuid",
  "classe_id": "uuid",
  "matiere_id": "uuid",
  "est_titulaire": true
}
```
L'`annee_scolaire_id` est résolu automatiquement côté backend (année courante de l'établissement).

**Réponses d'erreur métier :**
- `409` Doublon → `"Cette matière est déjà assignée dans cette classe pour cette année"`
- `422` Matière/classe/enseignant inexistant → erreur de référence FK
- `409` Suppression bloquée (évaluations liées) → `"Impossible de supprimer : des évaluations existent pour cette affectation"`

### UI Dashboard — page Enseignants

**Modification de `enseignants.js` :**
Ajout d'un bouton `📋 Affecter` sur chaque ligne du tableau enseignants.

**Nouveau modal `m-affectations` dans `index.html` :**

```
┌──────────────────────────────────────────────────────┐
│  📋 Affectations — M. Jean Dupont             [✕]   │
├──────────────────────────────────────────────────────┤
│  Ajouter une affectation                             │
│  ┌──────────────────┐  ┌──────────────────┐         │
│  │ Classe      [▼]  │  │ Matière     [▼]  │         │
│  └──────────────────┘  └──────────────────┘         │
│  [✓] Titulaire          [+ Ajouter l'affectation]   │
├──────────────────────────────────────────────────────┤
│  Affectations actuelles (année 2025-2026)            │
│  • Mathématiques · 6ème A              [🗑️]         │
│  • Mathématiques · 5ème B              [🗑️]         │
│  (Aucune affectation pour le moment)                 │
└──────────────────────────────────────────────────────┘
```

**Nouveau modal `m-matiere` dans `index.html` (accessible depuis Paramètres) :**
Formulaire simple : nom, nom court, code, discipline parente, compte dans moyenne.

### Gestion des matières

Les matières (`matieres`) sont configurées une fois par l'établissement. Si aucune matière n'existe, le select affiche un message d'aide : *"Aucune matière — créez-en dans Paramètres"*. La page Paramètres reçoit un onglet "Matières" avec liste + formulaire d'ajout.

---

## Sous-projet 2 — Espace enseignant web (à spécifier séparément)

### Périmètre validé

Interface role-based sur `index.html`. L'enseignant voit uniquement ses propres données (filtrées par `enseignant_id` côté API).

**Pages enseignant (nouveaux fichiers `js/pages/ens-*.js`) :**

| Page | Hash | Contenu |
|------|------|---------|
| Mon tableau de bord | `#ens-dashboard` | Résumé : nb classes, nb évals à saisir, prochains appels |
| Mes classes | `#ens-classes` | Liste de ses classes affectées + détail élèves |
| Mes notes | `#ens-notes` | Créer évaluations, saisir notes, publier |
| Appel | `#ens-appel` | Faire l'appel pour ses créneaux du jour |
| Mon emploi du temps | `#ens-edt` | Grille hebdomadaire de ses créneaux |
| Messagerie parents | `#ens-messagerie` | Envoyer SMS/WhatsApp aux parents d'élèves |
| Discipline | `#ens-discipline` | Signaler un incident, consulter son historique |

*Ce sous-projet sera détaillé dans un spec dédié après livraison du sous-projet 1.*

---

## Sous-projet 3 — Communication avancée (à spécifier séparément)

Messagerie parents bidirectionnelle, historique SMS/WhatsApp, notifications automatiques (absences, notes publiées). Dépend des sous-projets 1 et 2.

---

## Ordre d'implémentation

```
SP1 : Affectations  →  SP2 : Espace enseignant  →  SP3 : Communication
  (2-3 jours)              (5-7 jours)                  (3-4 jours)
```

---

## Contraintes techniques

- **Multi-tenant strict** : tous les endpoints filtrent par `etablissement_id` via le middleware `isoler`
- **Permissions** : `requireRole('directeur')` sur les endpoints d'affectation
- **Rétrocompatibilité** : les enseignants existants sans affectations continuent de fonctionner (l'app mobile n'est pas affectée)
- **Vanilla JS** : aucun framework, aucun build step — tout nouveau code suit le pattern `PageXxx = { ... }` + `PAGE_HOOKS`
- **Fallback mock** : si l'API est hors ligne, afficher des données vides avec message d'aide plutôt qu'une erreur bloquante
