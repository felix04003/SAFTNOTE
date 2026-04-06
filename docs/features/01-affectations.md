# Feature 01 — Affectations

**Version :** v0.1.0 · Sprint 1 · 2026-03-19
**Statut :** ✅ Livré

## Résumé

Permet à l'administrateur de lier un enseignant à une classe et une matière (affectation). Inclut la gestion des matières depuis les paramètres. Point de départ de toute la chaîne pédagogique (EDT, appels, notes sont basés sur les affectations).

## Endpoints API

| Méthode | Route | Permission | Description |
|---------|-------|------------|-------------|
| GET | `/affectations` | admin | Liste affectations de l'établissement |
| POST | `/affectations` | admin | Créer une affectation |
| DELETE | `/affectations/:id` | admin | Supprimer une affectation |
| GET | `/matieres` | admin | Liste matières de l'établissement |
| POST | `/matieres` | admin | Créer une matière |

## Fichiers concernés

**Backend :**
- `backend/src/domains/01-identites/identites.routes.js` — routes affectations + matières

**Dashboard :**
- `dashboard/js/pages/enseignants.js` — bouton Affecter, modal
- `dashboard/js/pages/parametres.js` — section matières (chargerMatieres, creerMatiere)
- `dashboard/index.html` — modals `m-affectations`, `m-matiere`

## Points d'attention

- Les affectations sont scopées par `etablissement_id` (multi-tenant)
- La table `disciplines_matieres` lie `affectations_enseignants` à `matieres` avec une `couleur_affichage`
- La couleur est utilisée dans la grille EDT enseignant (ens-edt.js)

## Liens

- Spec : [`docs/superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md`](../superpowers/specs/2026-03-19-affectations-et-espace-enseignant-design.md)
- Plan : [`docs/superpowers/plans/2026-03-19-affectations.md`](../superpowers/plans/2026-03-19-affectations.md)
