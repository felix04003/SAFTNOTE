# Design — Organisation du code et documentation EcoleManager

**Date :** 2026-04-06
**Statut :** Approuvé
**Objectif :** Créer une documentation complète et navigable pour deux audiences — le développeur principal (référence rapide) et un développeur externe (onboarding).

---

## Contexte

Le projet EcoleManager compte 79 commits, 5 features majeures livrées, 9 migrations SQL, 3 portails dashboard (admin, enseignant, parent) et un backend organisé en 5 domaines. La documentation existante (`docs/superpowers/specs/` et `plans/`) couvre les specs et plans de chaque feature, mais il manque une vue d'ensemble et un historique versionné.

---

## Structure cible

```
docs/
  INDEX.md                        ← point d'entrée unique
  CHANGELOG.md                    ← historique versionné + daté
  architecture/
    overview.md                   ← stack, décisions clés, schéma global
    backend.md                    ← domaines API, middlewares, patterns
    dashboard.md                  ← 3 portails, routing hash, conventions JS
    database.md                   ← schéma par domaine, migrations, conventions
  features/
    01-affectations.md
    02-portail-enseignant.md
    03-tests-cache-monitoring.md
    04-portail-parents.md
    05-edt-enseignant.md
  superpowers/                    ← existant, non modifié
    specs/
    plans/
```

---

## Format CHANGELOG

Version sémantique + date + sprint. Chaque entrée :

```markdown
## v0.X.0 — Sprint X · YYYY-MM-DD : Titre feature
**Features :** résumé en une ligne
**Endpoints :** liste des routes principales
**Fichiers clés :** fichiers backend + dashboard + migrations
```

Versions planifiées :
- v0.1.0 — Affectations (2026-03-19)
- v0.2.0 — Portail Enseignant (2026-03-21)
- v0.3.0 — Tests, Cache & Monitoring (2026-03-22)
- v0.4.0 — Portail Parents (2026-03-29)
- v0.5.0 — EDT Enseignant (2026-03-30)

---

## Format feature docs

Chaque fichier `docs/features/XX-nom.md` :

```markdown
# Feature : [Nom]
**Version :** vX.X.0 · Sprint X · [date]
**Statut :** ✅ Livré / 🚧 En cours / ⏳ Planifié

## Résumé
## Endpoints API (tableau méthode/route/permission/description)
## Fichiers concernés (backend, dashboard, migrations)
## Points d'attention (gotchas, conventions spécifiques)
## Liens (spec + plan dans superpowers/)
```

---

## Format INDEX.md

Page unique avec :
- Navigation rapide vers les 4 docs architecture
- Tableau des features (numéro, nom, version, statut)
- Lien vers `docs/superpowers/` pour les specs détaillées

---

## Docs architecture

Quatre fichiers permanents couvrant les règles qui s'appliquent à tout le code :

- **overview.md** : stack (Node/Express, PostgreSQL, Redis, Vanilla JS ES5), décisions d'architecture, schéma global des portails
- **backend.md** : structure des domaines (01→05), middlewares (auth, isoler, perm, valider), patterns (ApiError, ok(), getDB()), conventions nommage
- **dashboard.md** : 3 portails (admin/enseignant/parent), routing hash, conventions ES5 obligatoires, pattern objets littéraux pages
- **database.md** : 5 domaines SQL, conventions nommage colonnes, pattern migrations, Redis cache keys

---

## Audiences

| Section | Dev principal | Dev externe |
|---------|--------------|-------------|
| INDEX.md | Point d'entrée rapide | Première page à lire |
| CHANGELOG.md | Retrouver quand une feature a été ajoutée | Comprendre l'évolution |
| architecture/ | Rappel des conventions | Onboarding technique |
| features/ | Retrouver un endpoint ou fichier | Comprendre une feature |
| superpowers/ | Détails d'implémentation | Specs complètes |
