# Architecture — Base de données

## PostgreSQL + Knex

- **Connexion :** `getDB()` depuis `backend/src/infrastructure/database/pool.js`
- **ORM :** Knex (query builder, pas d'ORM complet)
- **Docker :** `ecole_postgres`, port 5432 (prod) / 5433 (tests)
- **DB :** `ecole_manager`, user `ecole_user`

## Schéma par domaine

### Domaine 1 — Identités (`001_domaine1_identites.sql`)

| Table | Description |
|-------|-------------|
| `etablissements` | École/lycée (id, nom, `code_officiel`, actif) |
| `annees_scolaires` | Année scolaire (id, libelle, etablissement_id, actif) |
| `classes` | Classe (id, nom, niveau, annee_scolaire_id, etablissement_id) |
| `affectations_enseignants` | Lien enseignant–classe–matière |

### Domaine 2 — Acteurs (`002_domaine2_acteurs.sql`)

| Table | Description |
|-------|-------------|
| `utilisateurs` | Tous les comptes (id, nom, prenom, telephone, email, actif) |
| `roles` | Rôles disponibles (admin, enseignant, parent…) |
| `permissions` | Permissions atomiques (edt.lire, edt.modifier_ponctuel…) |
| `roles_permissions` | M2M rôles–permissions |
| `utilisateur_roles` | Rôle d'un utilisateur dans un établissement |
| `eleves` | Élève (id, nom, prenom, classe_id, etablissement_id) |
| `parents_eleves` | M2M parents–élèves (parent_id, eleve_id, lien) |
| `otp_verifications` | Codes OTP SMS (telephone, code_hash SHA-256, expire_at, utilise) |
| `sessions` | Sessions JWT actives |

### Domaine 3 — Pédagogie (`003_domaine3_pedagogie.sql`)

| Table | Description |
|-------|-------------|
| `matieres` | Matières (id, nom, etablissement_id) |
| `disciplines_matieres` | Lien affectation–matière + `couleur_affichage` |
| `evaluations` | Évaluation (id, libelle, type, classe_id, matiere_id, date_eval) |
| `notes` | Note d'un élève (eleve_id, evaluation_id, valeur, sur) |
| `configs_systeme_notes` | Configuration notation par établissement |
| `bulletins` | Bulletin trimestriel par élève |
| `moyennes` | Moyennes calculées par matière/trimestre |

### Domaine 4 — Vie scolaire (`004_domaine4_vie_scolaire.sql`)

| Table | Description |
|-------|-------------|
| `emplois_du_temps` | Créneau EDT (affectation_id, jour, heure_debut, heure_fin, salle) |
| `plages_horaires` | Plages standards par établissement |
| `appels` | Appel d'une classe (classe_id, creneau_id, date, statut, enseignant_id) |
| `presences` | Présence d'un élève (appel_id, eleve_id, statut, heure_arrivee) |
| `evenements_discipline` | Incidents disciplinaires |

### Domaine 5 — Sécurité (`005_domaine5_securite.sql`)

| Table | Description |
|-------|-------------|
| `logs_connexion` | Tentatives de connexion (succès/échec, ip, user-agent) |

## Migrations

Appliquer dans l'ordre numérique. Le script `migrations/run_all_migrations.sql` les enchaîne.

Pour les tests d'intégration : `backend/tests/integration/globalSetup.js` applique chaque migration via `fs.readFileSync` + `db.raw()`.

**Ajouter une migration :**
1. Créer `migrations/NNN_description.sql`
2. L'ajouter dans `globalSetup.js` (liste `migrationFiles`)
3. L'appliquer en local : `docker exec ecole_postgres psql -U ecole_user -d ecole_manager -f /migrations/NNN.sql`

## Conventions colonnes

| Convention | Exemple |
|------------|---------|
| Clé primaire | `id UUID DEFAULT gen_random_uuid()` |
| Timestamps | `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at` |
| Booléens actif | `actif BOOLEAN DEFAULT true` |
| FK | `{table_singulier}_id UUID REFERENCES {table}(id)` |
| Enum en CHECK | `CHECK (statut IN ('valeur1', 'valeur2'))` |
| Code officiel | `code_officiel VARCHAR(20) UNIQUE` |

## Clés de cache Redis

| Pattern | Domaine | Invalidation |
|---------|---------|-------------|
| `edt_ens:{enseignant_id}:{semaine}` | EDT enseignant | PUT /edt/:id/salle |
