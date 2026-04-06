# Feature 05 — EDT Enseignant

**Version :** v0.5.0 · Sprint 5 · 2026-03-30
**Statut :** ✅ Livré

## Résumé

Remplace l'ancienne page EDT statique par une grille hebdomadaire interactive avec navigation ±semaine. Un clic sur un créneau ouvre un drawer latéral avec 4 onglets : appel (saisie présences), historique, notes de cours et modification de salle.

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/enseignants/moi/edt?semaine=YYYY-MM-DD` | enseignant | Créneaux de la semaine |
| GET | `/appels/cours?creneau_id=&date=` | enseignant | Appel du créneau + présences |
| POST | `/appels` | appel.creer | Créer un appel (renvoie `{ appel_id, nb_eleves }`) |
| PUT | `/appels/:id/presences` | appel.saisir | Saisir présences (body: `{ presences[], cloturer }`) |
| PUT | `/enseignants/moi/edt/:creneau_id/salle` | edt.modifier_ponctuel | Modifier salle |

## Fichiers concernés

**Backend :**
- `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`
  - `GET /enseignants/moi/edt` — avec `couleur_affichage` via join `disciplines_matieres`
  - `PUT /enseignants/moi/edt/:creneau_id/salle` — ownership check + invalidation Redis
- `backend/src/domains/04-vie-scolaire/appels/` — routes appels
- `migrations/009_fix_statut_checks.sql` — corrige les CHECK contraintes appels/présences

**Dashboard :**
- `dashboard/js/pages/ens-edt.js` — réécrit intégralement (3 objets ES5 : `PageEnsEdt`, `EdtDrawer`, `EdtAppel`)
- `dashboard/enseignant.html` — nav semaine + drawer HTML (`#edt-overlay`, `#edt-drawer`)
- `dashboard/css/style.css` — styles grille EDT + drawer + onglets + boutons appel

## Architecture ens-edt.js

```
PageEnsEdt          ← page principale, chargement EDT, construction grille
  └── _creneauxMap  ← { [creneau_id]: creneau } — lookup sans JSON.stringify
  └── _lundiDeSemaine() _dateISO() _addDays() _labelSemaine()

EdtDrawer           ← drawer latéral, onglets, rendu par onglet
  └── ouvrir(id)    ← appelé depuis les onclick de la grille
  └── onglet(nom)   ← switche entre appel/historique/notes/salle

EdtAppel            ← logique appel (création, saisie présences, clôture)
  └── render(creneau, date)
  └── _marquer(eleve_id, statut)
  └── _cloturer()
```

## Points d'attention

- **Réponse POST /appels** : renvoie `{ appel_id, nb_eleves }` — utiliser `.appel_id` (pas `.id`)
- **Cache Redis** : clé `edt_ens:{enseignant_id}*` — invalidée après PUT salle
- **Ownership** : join `affectations_enseignants` pour vérifier qu'un créneau appartient à l'enseignant — pas de colonne `enseignant_id` directe sur `emplois_du_temps`
- **Dates** : ne pas utiliser `.toISOString()` (décalage UTC) — construire avec `getFullYear()`, `getMonth()+1`, `getDate()`
- **Zero-padding** : `('0' + n).slice(-2)` — `.padStart()` n'est pas ES5

## Liens

- Spec : [`docs/superpowers/specs/2026-03-30-edt-enseignant-design.md`](../superpowers/specs/2026-03-30-edt-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-30-edt-enseignant.md`](../superpowers/plans/2026-03-30-edt-enseignant.md)
