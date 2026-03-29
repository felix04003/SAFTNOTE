# EDT Enseignant — Design Document

**Date :** 2026-03-30
**Statut :** Approuvé

---

## Objectif

Améliorer la page "Mon emploi du temps" de l'espace enseignant pour offrir : navigation par semaine, couleurs depuis la base de données, et un panneau latéral (drawer) permettant de faire l'appel, consulter l'historique des présences, accéder aux notes, et modifier la salle d'un créneau.

---

## Architecture

### Blocs de travail

**1. Backend — `GET /enseignants/moi/edt`**
Ajouter `'m.couleur_affichage'` au SELECT. `couleur_affichage` est une colonne directement sur la table `matieres` (confirmé via `edt.routes.js`, `eleves.routes.js`, `evaluations.routes.js`). Modification : 1 ligne dans le `.select()`.

**2. Backend — `GET /appels/cours`**
Nouveau endpoint : `GET /appels/cours?emploi_du_temps_id=<uuid>&date_cours=YYYY-MM-DD`

Vérifie que l'`emploi_du_temps_id` appartient bien à une affectation de l'enseignant connecté pour l'établissement courant (ownership check). Retourne 403 si non.

Retourne :
```json
{
  "appel_id": "uuid | null",
  "statut": "ouvert | effectue | null",
  "eleves": [
    {
      "inscription_id": "uuid",
      "nom": "Diallo",
      "prenom": "Mamadou",
      "statut": "non_saisi | present | absent | retard | sorti_avant | dispense",
      "minutes_retard": 0
    }
  ]
}
```

Si aucun appel n'existe : `appel_id: null`, tous les élèves à `non_saisi`. Un seul appel suffit pour "faire l'appel" et "voir l'historique".

Permission requise : `absences.faire_appel`.

**3. Backend — `PUT /enseignants/moi/edt/:creneau_id/salle`**
Nouvel endpoint dédié à la mise à jour de la salle d'un créneau par l'enseignant concerné. Permission : `edt.modifier_ponctuel` (l'enseignant possède cette permission, pas `edt.creer`). Vérifie l'ownership du créneau avant mise à jour. Invalide le cache Redis `edt_ens:*` après succès (couvre la vue admin `GET /edt/enseignant/:id`). Note : `GET /enseignants/moi/edt` n'utilise pas Redis — aucune invalidation supplémentaire requise pour la vue enseignant.

**4. Frontend — `ens-edt.js`**
Réécriture complète en ES5 pur (pattern `key: function()`). Trois objets dans le même fichier :
- `PageEnsEdt` — navigation semaine + rendu grille
- `EdtDrawer` — gestion du panneau latéral (ouverture, onglets, état)
- `EdtAppel` — logique de saisie et soumission de l'appel

---

## Prérequis DB (migrations potentielles)

> **Vérifier avant implémentation :** le code existant (`appels.routes.js`) insère `statut: 'ouvert'` et `presences.statut: 'non_saisi'`. Si la contrainte CHECK de la DB de développement ne contient pas ces valeurs, ajouter une migration :
>
> ```sql
> ALTER TABLE appels DROP CONSTRAINT IF EXISTS appels_statut_check;
> ALTER TABLE appels ADD CONSTRAINT appels_statut_check
>   CHECK (statut IN ('ouvert', 'effectue', 'cours_annule', 'non_effectue'));
>
> ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;
> ALTER TABLE presences ADD CONSTRAINT presences_statut_check
>   CHECK (statut IN ('non_saisi', 'present', 'absent', 'retard', 'sorti_avant', 'dispense'));
> ```
>
> Si les migrations SQL existantes sont déjà à jour (la DB de prod ne rejette pas ces valeurs), cette étape est inutile.

---

## Grille EDT

### Navigation semaine
```
[← Semaine précédente]  [Lun 30 mars – Ven 3 avr 2026]  [Semaine suivante →]  [Aujourd'hui]
```
- `semaine` = date ISO (YYYY-MM-DD) du lundi de la semaine affichée
- Calculée avec les composants locaux : `getFullYear()`, `getMonth()`, `getDate()` — **ne pas utiliser `toISOString()`** (risque de décalage UTC pour les fuseaux UTC+X)
- Passée comme `?semaine=YYYY-MM-DD` à `GET /enseignants/moi/edt`
- Bouton "Aujourd'hui" : revient à la semaine courante

### Créneaux
- Couleur : `m.couleur_affichage` (hex). Fallback : `#1a4731` si null
- Contenu : matière en gras, classe · salle en dessous
- Créneaux `est_pause` : vides, non cliquables
- Hover : légère élévation (`box-shadow`). Curseur `pointer`
- Clic → `EdtDrawer.ouvrir(creneau, dateISO)`

---

## Drawer (panneau latéral)

### Structure HTML
`<div id="edt-drawer">` injecté dans `enseignant.html`, `position: fixed`, droite, hauteur `100vh`, largeur `380px`, `z-index: 200`. Masqué par défaut (`transform: translateX(100%)`), animation CSS (`transition: transform 0.25s ease`).

Overlay semi-transparent (`<div id="edt-overlay">`) derrière le drawer, ferme au clic.

### En-tête du drawer
Bandeau coloré (couleur matière) avec : matière en gras, classe + heure_debut–heure_fin + salle. Bouton ✕ ferme le drawer.

### Onglets
`Appel` · `Historique` · `Notes` · `Salle`

---

## Onglet Appel

**État "appel déjà clôturé" (`statut === 'effectue'`):**
- Message "Appel clôturé" + résumé (N présents · M absents · K retards)
- Bouton "Voir le détail" → bascule sur onglet Historique

**État "appel à faire" (`statut === 'ouvert'` ou `null`):**
- Liste des élèves (nom prénom)
- 3 boutons par ligne : `✓ Présent` (vert actif) · `✗ Absent` (rouge) · `⏱ Retard` (orange)
- Si Retard sélectionné : champ numérique "minutes" apparaît (1–120)
- Bouton `Clôturer l'appel` actif **uniquement quand tous les élèves ont un statut saisi** (aucun `non_saisi` restant). Badge "N/total saisis" mis à jour en temps réel.
- Flux :
  1. Si `appel_id === null` → `POST /appels { emploi_du_temps_id, date_cours }` → récupérer `appel_id`
  2. `PUT /appels/:appel_id/presences { presences: [...tous les élèves...], cloturer: true }`
  3. Tous les élèves doivent être inclus dans le PUT (statut ≠ `non_saisi` garanti par la validation UI)
- Si `appel_id` existant et `ouvert` → directement `PUT /appels/:id/presences`

---

## Onglet Historique

Tableau lecture seule : Prénom Nom / Statut (badge coloré) / Retard.

| Statut | Badge |
|---|---|
| `present` | vert `✓ Présent` |
| `absent` | rouge `✗ Absent` |
| `retard` | orange `⏱ Retard (Xmin)` |
| `sorti_avant` | gris `Sorti tôt` |
| `dispense` | bleu `Dispensé` |
| `non_saisi` | gris clair `—` |

Chargé depuis `EdtDrawer._eleves` (pas de requête supplémentaire).
Si `statut === 'ouvert'` (appel en cours) : banner en haut "Appel en cours — données partielles".

---

## Onglet Notes

Bouton unique `→ Ajouter une évaluation` qui appelle `goto('ens-notes')` et pré-filtre classe + matière via `PageEnsNotes.prefiltrer(classe_id, matiere_id)` si cette fonction est exposée, sinon navigation simple.

---

## Onglet Salle

- Champ texte pré-rempli avec `edt.salle` (peut être vide)
- Bouton `Enregistrer` → `PUT /enseignants/moi/edt/:creneau_id/salle { salle: valeur }`
- Feedback inline : "✓ Salle mise à jour" ou message d'erreur
- Met à jour visuellement le créneau dans la grille après succès (DOM update local — la cache Redis est invalidée côté serveur, aucune action supplémentaire côté frontend)

---

## Gestion des erreurs

- Réseau/timeout : message inline dans le drawer, pas de fermeture automatique
- Appel déjà clôturé entre ouverture et soumission : recharger depuis `GET /appels/cours` et afficher l'état "clôturé"
- Permission `absences.faire_appel` absente : onglet Appel affiche "Vous n'avez pas la permission de faire l'appel"

---

## Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js` | Modifier `GET /enseignants/moi/edt` : ajouter `m.couleur_affichage` au SELECT |
| `backend/src/domains/04-vie-scolaire/appels/appels.routes.js` | Ajouter `GET /appels/cours` (avec ownership check) |
| `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js` | Ajouter `PUT /enseignants/moi/edt/:creneau_id/salle` |
| `dashboard/js/pages/ens-edt.js` | Réécriture complète |
| `dashboard/enseignant.html` | Ajouter `#edt-drawer` + `#edt-overlay` |
| _(optionnel)_ migration SQL | Ajouter `'ouvert'` à `appels.statut` CHECK + `'non_saisi'` à `presences.statut` CHECK si besoin |

---

## Hors scope

- Modification des créneaux EDT (changement de jour/heure/matière) — réservé à l'admin
- Export PDF de l'EDT
- Vue liste alternative à la grille
- Notifications temps réel lors de l'appel (couvert par le système notifications séparé)
