# EcoleManager — Index de la documentation

> Point d'entrée unique. Tous les liens vers la doc technique.

---

## Navigation rapide

| Document | Description |
|----------|-------------|
| [CHANGELOG](CHANGELOG.md) | Historique des versions et features |
| [Vue d'ensemble](architecture/overview.md) | Stack, décisions clés, schéma global |
| [Backend](architecture/backend.md) | Domaines API, middlewares, patterns |
| [Dashboard](architecture/dashboard.md) | 3 portails, routing hash, conventions JS |
| [Base de données](architecture/database.md) | Schéma SQL, migrations, conventions |

---

## Features

| # | Feature | Version | Sprint | Statut |
|---|---------|---------|--------|--------|
| 1 | [Affectations](features/01-affectations.md) | v0.1.0 | 2026-03-19 | ✅ Livré |
| 2 | [Portail Enseignant](features/02-portail-enseignant.md) | v0.2.0 | 2026-03-21 | ✅ Livré |
| 3 | [Tests, Cache & Monitoring](features/03-tests-cache-monitoring.md) | v0.3.0 | 2026-03-22 | ✅ Livré |
| 4 | [Portail Parents](features/04-portail-parents.md) | v0.4.0 | 2026-03-29 | ✅ Livré |
| 5 | [EDT Enseignant](features/05-edt-enseignant.md) | v0.5.0 | 2026-03-30 | ✅ Livré |

---

## Specs & Plans détaillés

Les specs de design et plans d'implémentation complets sont dans :
→ [`docs/superpowers/specs/`](superpowers/specs/)
→ [`docs/superpowers/plans/`](superpowers/plans/)

---

## Migrations SQL

| Fichier | Domaine |
|---------|---------|
| `migrations/000_extensions.sql` | Extensions PostgreSQL |
| `migrations/000_extensions_types.sql` | Types énumérés |
| `migrations/001_domaine1_identites.sql` | Établissements, classes, années |
| `migrations/002_domaine2_acteurs.sql` | Utilisateurs, rôles, élèves, parents, enseignants |
| `migrations/003_domaine3_pedagogie.sql` | Matières, évaluations, notes, bulletins |
| `migrations/004_domaine4_vie_scolaire.sql` | Appels, présences, discipline, EDT |
| `migrations/005_domaine5_securite.sql` | Sessions, logs d'accès, OTP |
| `migrations/006_donnees_reference.sql` | Données de référence (rôles, permissions) |
| `migrations/007_vues_et_fonctions.sql` | Vues SQL et fonctions PL/pgSQL |
| `migrations/008_index_performance.sql` | Index de performance |
| `migrations/009_fix_statut_checks.sql` | Correction contraintes statut appels/présences |
