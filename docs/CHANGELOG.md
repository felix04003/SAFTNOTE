# Changelog — EcoleManager

Historique des versions par sprint. Format : version sémantique + date + résumé feature + endpoints + fichiers clés.

---

## v0.5.0 — Sprint 5 · 2026-03-30 : EDT Enseignant

**Features :**
- Grille hebdomadaire de l'emploi du temps enseignant (navigation ±semaine)
- Drawer latéral par créneau : appel, historique présences, notes de cours, modification salle
- Cache Redis invalidé à chaque modification de salle

**Endpoints :**
| Méthode | Route |
|---------|-------|
| GET | `/enseignants/moi/edt?semaine=YYYY-MM-DD` |
| GET | `/appels/cours?creneau_id=&date=` |
| POST | `/appels` |
| PUT | `/appels/:id/presences` |
| PUT | `/enseignants/moi/edt/:creneau_id/salle` |

**Fichiers clés :**
- Backend : `backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`
- Backend : `backend/src/domains/04-vie-scolaire/appels/`
- Dashboard : `dashboard/js/pages/ens-edt.js` (réécrit intégralement)
- Dashboard : `dashboard/enseignant.html` (drawer + nav semaine)
- Migration : `migrations/009_fix_statut_checks.sql`

**Points d'attention :**
- ES5 strict dans ens-edt.js — `_creneauxMap` pour lookup id→objet sans JSON.stringify
- Cache key Redis : `edt_ens:{enseignant_id}*` (glob)
- Ownership check : join `affectations_enseignants` → pas de colonne directe enseignant_id sur EDT

---

## v0.4.0 — Sprint 4 · 2026-03-29 : Portail Parents

**Features :**
- Login OTP SMS en 2 étapes (téléphone + code établissement → code à 6 chiffres)
- Dashboard parent : KPI (moyenne générale, absences, mention), dernières notes, absences récentes
- Notes par matière filtrables par période
- Liste absences/retards avec statut justification
- Bulletins trimestriels avec moyennes par matière
- Sélecteur multi-enfant dans la sidebar

**Endpoints :**
| Méthode | Route |
|---------|-------|
| POST | `/auth/otp/demander` |
| POST | `/auth/otp/valider` |
| GET | `/parents/moi/enfants` |
| GET | `/parents/moi/enfants/:eleve_id/notes` |
| GET | `/parents/moi/enfants/:eleve_id/absences` |
| GET | `/parents/moi/enfants/:eleve_id/bulletins` |

**Fichiers clés :**
- Backend : `backend/src/domains/02-acteurs/auth/auth.routes.js` (routes OTP)
- Backend : `backend/src/domains/02-acteurs/parents/parents.routes.js`
- Dashboard : `dashboard/parent-login.html`, `dashboard/parent.html`
- Dashboard : `dashboard/js/par-app.js`, `dashboard/js/par-router.js`
- Dashboard : `dashboard/js/pages/par-dashboard.js`, `par-notes.js`, `par-absences.js`, `par-bulletins.js`

**Points d'attention :**
- Table `parents_eleves` (pas `parents`) — colonnes `parent_id` / `eleve_id`
- Établissement via `code_officiel` (pas `code`)
- En dev sans `AT_API_KEY` : OTP loggé via `logger.warn` au lieu d'être envoyé par SMS
- OTP stocké hashé SHA-256 dans `otp_verifications.code_hash`

---

## v0.3.0 — Sprint 3 · 2026-03-22 : Tests, Cache & Monitoring

**Features :**
- Suite de tests d'intégration (Jest) sur les 5 domaines
- Cache Redis avec invalidation par pattern
- Logs structurés (Winston) + monitoring erreurs sync mobile
- Script `test-integration.sh` pour lancer les tests en local

**Fichiers clés :**
- `backend/tests/integration/` — suites par domaine
- `backend/tests/integration/jest.integration.config.js`
- `backend/tests/integration/globalSetup.js`
- `backend/src/infrastructure/cache/redis.js`
- `backend/src/infrastructure/monitoring/`
- `scripts/test-integration.sh`

**Points d'attention :**
- Les tests d'intégration utilisent `--config jest.integration.config.js` (pas le config par défaut)
- PostgreSQL de test sur port 5433 (variable `POSTGRES_PORT`)
- `globalSetup.js` applique toutes les migrations dans l'ordre

---

## v0.2.0 — Sprint 2 · 2026-03-21 : Portail Enseignant

**Features :**
- Portail enseignant complet : 6 pages (dashboard, appel, notes, discipline, EDT, classes)
- Routing hash côté client (ens-router.js)
- Modals réutilisables pour les opérations CRUD
- Redirection role-based depuis le login (admin → index.html, enseignant → enseignant.html, parent → parent.html)

**Endpoints clés :**
| Méthode | Route |
|---------|-------|
| GET | `/enseignants/moi/classes` |
| GET | `/enseignants/moi/edt` |
| GET | `/eleves?classe_id=` |
| POST/PUT | `/appels`, `/appels/:id/presences` |
| GET/POST | `/notes`, `/evaluations` |

**Fichiers clés :**
- Dashboard : `dashboard/enseignant.html`
- Dashboard : `dashboard/js/ens-app.js`, `dashboard/js/ens-router.js`
- Dashboard : `dashboard/js/pages/ens-dashboard.js`, `ens-appel.js`, `ens-notes.js`, `ens-discipline.js`, `ens-classes.js`

---

## v0.1.0 — Sprint 1 · 2026-03-19 : Affectations

**Features :**
- Gestion des affectations enseignants–classes–matières (backend + dashboard admin)
- CRUD matières dans les paramètres
- Bouton Affecter depuis la page enseignants

**Endpoints :**
| Méthode | Route |
|---------|-------|
| GET | `/affectations?etablissement_id=` |
| POST | `/affectations` |
| DELETE | `/affectations/:id` |
| GET/POST | `/matieres` |

**Fichiers clés :**
- Backend : `backend/src/domains/01-identites/identites.routes.js`
- Dashboard : `dashboard/js/pages/enseignants.js`, `dashboard/js/pages/parametres.js`
- Dashboard : `dashboard/index.html` (modals m-affectations, m-matiere)

---

## v0.0.1 — Initial commit · 2026-03 : Fondations

**Features :**
- Structure Express + Knex + PostgreSQL + Redis
- 9 domaines de routes, 9 migrations SQL
- Dashboard HTML/CSS/JS vanilla (ES5)
- Login multi-rôle avec session JWT
- Inscription établissement
- App mobile React Native (Expo) — structure de base
