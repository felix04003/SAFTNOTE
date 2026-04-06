# Feature 02 — Portail Enseignant

**Version :** v0.2.0 · Sprint 2 · 2026-03-21
**Statut :** ✅ Livré

## Résumé

Portail dédié aux enseignants avec 6 pages : tableau de bord, appel, notes, discipline, emploi du temps et classes. Séparé du portail admin (HTML + JS distincts). Routing hash côté client. Redirection automatique depuis le login selon le rôle.

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/enseignants/moi` | enseignant | Profil enseignant connecté |
| GET | `/enseignants/moi/classes` | enseignant | Classes affectées |
| GET | `/enseignants/moi/edt` | enseignant | EDT hebdomadaire |
| GET | `/eleves?classe_id=` | enseignant | Élèves d'une classe |
| POST | `/appels` | appel.creer | Créer un appel |
| PUT | `/appels/:id/presences` | appel.saisir | Saisir les présences |
| GET | `/evaluations?classe_id=` | notes.lire | Évaluations d'une classe |
| POST | `/notes/batch` | notes.saisir | Saisir les notes en batch |

## Fichiers concernés

**Dashboard :**
- `dashboard/enseignant.html` — structure HTML complète (6 pages + 3 modals)
- `dashboard/js/ens-app.js` — initialisation portail enseignant
- `dashboard/js/ens-router.js` — routing hash `#ens-*`
- `dashboard/js/auth.js` — redirection `enseignant.html` si rôle=enseignant
- `dashboard/js/pages/ens-dashboard.js` — KPI + actions urgentes
- `dashboard/js/pages/ens-appel.js` — sélecteur classe/créneau + saisie présences
- `dashboard/js/pages/ens-notes.js` — grille de notes par évaluation
- `dashboard/js/pages/ens-discipline.js` — événements disciplinaires
- `dashboard/js/pages/ens-classes.js` — liste classes affectées
- `dashboard/js/pages/ens-edt.js` — grille EDT (réécrit en v0.5.0)

## Points d'attention

- Toutes les pages `ens-*.js` sont des objets ES5 littéraux (pas de classes)
- Le router appelle `PageXxx.init()` à chaque navigation vers la page
- L'appel est lié à un `creneau_id` depuis l'EDT (pas seulement classe + date)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md`](../superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-21-espace-enseignant-dashboard.md`](../superpowers/plans/2026-03-21-espace-enseignant-dashboard.md)
