# Design — Notifications in-app Dashboard

**Date :** 2026-04-07
**Statut :** Approuvé
**Version cible :** v0.6.0

---

## Contexte

Le dashboard EcoleManager (3 portails : admin, enseignant, parent) n'a pas de système de notifications. Les utilisateurs doivent naviguer dans chaque page pour découvrir les événements importants. Cette feature ajoute une cloche 🔔 dans le header et un drawer latéral affichant les alertes agrégées.

---

## Décisions de design

| Question | Décision | Raison |
|----------|----------|--------|
| Type | In-app uniquement (pas de Web Push) | Compatibilité navigateurs anciens, offline-first |
| UI | Drawer latéral (comme #edt-drawer) | Cohérence avec l'existant, plus d'espace que dropdown |
| Persistance | Éphémères — calculées depuis données existantes | Zéro table nouvelle, données déjà en base |
| Mise à jour | Polling toutes les 60s | Offline-friendly (2G/3G), robuste aux coupures |
| Scope | 5 types d'événements, filtrage par rôle | YAGNI — V2 pourra ajouter "marquer comme lu" |

---

## Types d'événements

| Type | `type` | Admin | Enseignant | Parent |
|------|--------|-------|-----------|--------|
| Appels non effectués | `appels_manques` | ✅ tous | ✅ ses cours | ❌ |
| Absences injustifiées | `absences_injustifiees` | ✅ tous | ❌ | ✅ son enfant |
| Notes publiées | `notes_publiees` | ✅ tous | ✅ ses évals | ✅ son enfant |
| Bulletins disponibles | `bulletins_disponibles` | ✅ tous | ❌ | ✅ son enfant |
| Incidents disciplinaires | `incidents_discipline` | ✅ tous | ❌ | ✅ son enfant |

**Fenêtre temporelle :** 7 derniers jours. Max 10 items par catégorie.

---

## API

### `GET /notifications`

Requiert authentification (`auth` + `isoler`). Pas de permission spécifique — chaque rôle voit ce qui le concerne.

**Réponse :**
```json
{
  "total": 8,
  "categories": [
    {
      "type": "appels_manques",
      "label": "Appels non effectués",
      "count": 3,
      "items": [
        {
          "classe": "6ème A",
          "matiere": "Mathématiques",
          "date": "2026-04-07",
          "heure": "08:00"
        }
      ]
    },
    {
      "type": "absences_injustifiees",
      "label": "Absences injustifiées",
      "count": 5,
      "items": [
        { "eleve": "Mathy Thiam", "classe": "6ème A", "date": "2026-04-07" }
      ]
    },
    {
      "type": "notes_publiees",
      "label": "Notes publiées",
      "count": 2,
      "items": [
        { "matiere": "Mathématiques", "classe": "6ème A", "date": "2026-04-05" }
      ]
    },
    {
      "type": "bulletins_disponibles",
      "label": "Bulletins disponibles",
      "count": 0,
      "items": []
    },
    {
      "type": "incidents_discipline",
      "label": "Incidents disciplinaires",
      "count": 1,
      "items": [
        { "eleve": "Mathy Thiam", "classe": "6ème A", "type": "retenue", "date": "2026-04-06" }
      ]
    }
  ]
}
```

**Logique de filtrage par rôle :**

- `admin` : filtre par `etablissement_id` uniquement
- `enseignant` : filtre par ses `affectations_enseignants` (appels de ses cours, ses évaluations)
- `parent` : filtre par `parents_eleves` → `eleve_id` (absences/notes/bulletins/discipline de son enfant)

**Requêtes SQL utilisées (données existantes) :**

| Type | Table source | Condition |
|------|-------------|-----------|
| `appels_manques` | `emplois_du_temps` LEFT JOIN `appels` | `appels.id IS NULL` ET date passée dans les 7j |
| `absences_injustifiees` | `presences` | `statut = 'absent'` ET `justification IS NULL` dans les 7j |
| `notes_publiees` | `evaluations` | `publiee = true` dans les 7j |
| `bulletins_disponibles` | `bulletins` | `statut = 'valide'` dans les 7j |
| `incidents_discipline` | `evenements_discipline` | dans les 7j |

---

## Frontend

### Fichier : `dashboard/js/notifs.js`

Module ES5 partagé entre les 3 portails. Responsabilités :
- Polling toutes les 60s via `Api.get('/notifications')`
- Mise à jour du badge 🔔 (`#notif-badge`)
- Ouverture/fermeture du drawer (`#notif-drawer`)
- Rendu du contenu par catégorie

```javascript
var Notifs = {
  _timer: null,
  _data: null,

  init: function() { /* polling + premier chargement */ },
  _charger: function() { /* Api.get + _updateBadge */ },
  _updateBadge: function(count) { /* affiche/cache le badge */ },
  toggle: function() { /* ouvre/ferme le drawer */ },
  fermer: function() { /* ferme le drawer */ },
  _renderDrawer: function() { /* construit HTML depuis _data */ }
};
```

### HTML à ajouter dans les 3 portails

```html
<!-- Dans le header, à côté du profil -->
<button class="btn-notif" onclick="Notifs.toggle()" title="Notifications">
  🔔
  <span id="notif-badge"></span>
</button>

<!-- Avant </body> -->
<div id="notif-overlay" onclick="Notifs.fermer()"></div>
<div id="notif-drawer">
  <div id="notif-drawer-header">
    <span>Notifications</span>
    <button onclick="Notifs.fermer()">✕</button>
  </div>
  <div id="notif-drawer-body"></div>
</div>
<script src="js/notifs.js"></script>
```

### Styles CSS (`style.css`)

Même pattern que `#edt-drawer` :
- `#notif-drawer` : `position: fixed; right: 0; transform: translateX(380px); transition: transform .3s`
- `#notif-drawer.open` : `transform: translateX(0)`
- `#notif-overlay` : `display: none` → `.show` : `display: block` (fond semi-transparent)
- `.btn-notif` : bouton icône dans le header, position relative pour le badge
- `#notif-badge` : pastille rouge, `position: absolute`, `border-radius: 50%`

---

## Fichiers concernés

| Action | Fichier |
|--------|---------|
| Créer | `dashboard/js/notifs.js` |
| Modifier | `dashboard/index.html` (header + drawer HTML + script) |
| Modifier | `dashboard/enseignant.html` (idem) |
| Modifier | `dashboard/parent.html` (idem) |
| Modifier | `dashboard/css/style.css` (styles drawer + badge) |
| Créer | `backend/src/domains/notifications.routes.js` |
| Modifier | `backend/src/app.js` (montage route) |

---

## Hors scope (V2)

- "Marquer comme lu" (nécessiterait une table `notifications_lues`)
- Web Push notifications (hors navigateur)
- Notifications temps réel (SSE/WebSocket)
- Filtres par date dans le drawer
