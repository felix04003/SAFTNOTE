# Audit troisième passage — M4 vérifié en direct, M3/m2 corrigés, plans M1/M2/m1

> Session de continuation directe de `2026-08-18-audit-second-passage-plan-correctifs.md`. Traite exactement les 6 items listés dans sa section 2 ("Ce qui reste identifié mais non corrigé") : M4 (vérification en exécution réelle), M3 et m2 (corrigés maintenant), M1/M2/m1 (planifiés pour une session future, non implémentés).

**Racine projet :** `/Users/A.BEYE/SAFTH ENTERPRISE/SAFTH NOTE/ecolemanager`
**Backend testé :** `http://localhost:3010` (nodemon déjà lancé, rechargé automatiquement à chaque fix)
**Comptes de test utilisés :** `directeur@test.sn`, `enseignant@test.sn` (existants) + `superadmin@test.sn` (créé cette session, migration 015)

---

## 1. Résumé exécutif

| Item | Statut cette session |
|---|---|
| **M4** — `isolerEtablissement` / super_admin | **Vérifié en exécution réelle, bug confirmé (pire que prévu), corrigé, re-testé.** |
| **M3** — route dupliquée `GET /enseignants` | **Corrigé** (suppression du code mort, vérifié identique avant/après). |
| **m2** — seed pollué cross-établissement | **Corrigé** (données déjà en base + source de la migration 010). |
| **M1** — pas de `POST /configs/coefficients` | Non implémenté — plan détaillé section 3.1. |
| **M2** — dashboard EDT en lecture seule | Non implémenté — plan détaillé section 3.2. |
| **m1** — `req.session.role` fragile multi-rôles | Non implémenté — plan détaillé section 3.3. |

3 commits créés cette session, chacun vérifié en exécution réelle avant/après, 108/108 tests unitaires verts après chaque commit, aucune régression.

---

## 2. M4 — `isolerEtablissement` ne posait pas `req.etablissement_id` pour `super_admin`

### 2.1 Lecture de code préalable

`backend/src/middleware/permission.middleware.js`, fonction `isolerEtablissement` : le retour anticipé `if (roles.includes('super_admin')) return next();` sautait la ligne `req.etablissement_id = etablissement_id;`, placée après la boucle de vérification de propriété de ressource (donc jamais atteinte par un super_admin).

Investigation complémentaire nécessaire avant de coder le fix : comment `etablissement_id` est-il normalement résolu ? Lecture de `auth.routes.js` (`POST /auth/connexion`) : **la connexion exige toujours un `etablissement_code`**, résout l'utilisateur via `utilisateurs.where({ etablissement_id: etablissement.id })` (chaque utilisateur, y compris super_admin, a un `etablissement_id` "domicile" NOT NULL en base), puis crée la session avec `creerSession(db, utilisateur.id, etablissement.id, req)`. Il n'existe **aucun mécanisme de bascule cross-établissement au login** aujourd'hui. Conclusion : `req.session.etablissement_id` est donc déjà la bonne valeur pour **tous** les rôles, super_admin compris — pas besoin d'une résolution différente (pas de `?etablissement_id=` en query param, pas de logique spéciale).

### 2.2 Compte de test créé

Migration idempotente `backend/migrations/015_test_seed_super_admin.sql` (pattern `ON CONFLICT DO NOTHING`, identique à 009/010) : utilisateur `superadmin@test.sn` / `Test1234!`, rôle `super_admin` (id=1), établissement `TEST_LBD`. Appliquée directement via `docker exec -i ecole_postgres psql -U ecole_user -d ecole_manager < backend/migrations/015_test_seed_super_admin.sql`.

### 2.3 Reproduction en direct (AVANT fix)

```
POST /auth/connexion {identifiant: superadmin@test.sn, ...} → 200 OK, session TEST_LBD

GET /discipline/sanctions  (super_admin) → 500
  "Undefined binding(s) detected when compiling SELECT.
   Undefined column(s): [a.etablissement_id]"

GET /configs/matieres      (super_admin) → 500
  "Undefined binding(s) detected when compiling SELECT.
   Undefined column(s): [m.etablissement_id]"

Comparaison — même route GET /discipline/sanctions avec directeur@test.sn → 200 OK (1 sanction retournée)
```

**Plus grave que l'hypothèse du passage précédent** : le rapport anticipait un `IS NULL` silencieux (0 résultat sans erreur). En réalité, la version de Knex utilisée refuse de compiler la requête dès qu'un binding est `undefined` et lève une exception — **500 dur**, pas un résultat vide silencieux. Impact pratique identique (super_admin ne peut utiliser aucune de ces routes) mais le mode de défaillance est plus visible en prod (erreurs serveur loguées) que ce qui était supposé.

### 2.4 Fix appliqué

`permission.middleware.js` : `req.etablissement_id = etablissement_id;` posé immédiatement après destructuration de `req.session`, **avant** le retour anticipé super_admin. Suppression de l'assignation dupliquée en fin de fonction (devenue redondante).

### 2.5 Re-vérification en direct (APRÈS fix)

```
GET /discipline/sanctions (super_admin) → 200 OK
  { data: [{ ...sanction identique à celle vue par directeur@test.sn... }] }

GET /configs/matieres     (super_admin) → 200 OK
  { data: [], meta: { total: 0 } }
```

Le fait que `GET /discipline/sanctions` renvoie exactement la même sanction que via le compte directeur (et non toutes les sanctions tous établissements confondus) confirme que le filtrage par établissement fonctionne correctement pour super_admin après le fix — pas de régression vers un accès non filtré.

### 2.6 Commit et suite de tests

Commit `dd501ca` — `fix(backend): isolerEtablissement — req.etablissement_id jamais posé pour super_admin`. Suite complète (`cd backend && npm test`) : **108/108 tests unitaires verts**.

**Verdict M4 : bug confirmé en exécution réelle (et plus sévère que documenté — 500 au lieu de silencieux), corrigé, re-testé, aucune régression.**

---

## 3. Corrections rapides appliquées

### 3.1 M3 — Route dupliquée `GET /enseignants`

Lecture de code : `enseignants.routes.js` définissait deux fois `router.get('/enseignants', ...)`. Vérification en direct **avant** modification (compte directeur) : la réponse contenait `id` = `enseignants.id` (pas de `matieres_assignees`/`nb_classes`) — confirme qu'Express n'exécute que la première route ligne 125, la seconde (ligne 543-575) est du code mort.

Décision : **suppression** plutôt que fusion. `dashboard/js/pages/enseignants.js` n'utilise ni `matieres_assignees` ni `nb_classes` — fusionner aurait ajouté de la surface de risque (nouvelles sous-requêtes SQL) sans bénéfice mesurable pour le produit actuel.

Vérification en direct **après** suppression : réponse `GET /enseignants` strictement identique (même `id`, mêmes champs) au comportement avant. 108/108 tests toujours verts.

Commit `a16ba30` — `fix(backend): enseignants.routes.js — suppression de la route GET /enseignants morte`.

### 3.2 m2 — Données de seed polluées entre établissements

Investigation en direct : `docker exec ecole_postgres psql ...` a confirmé que `affectations_enseignants` de l'enseignant de test `TEST_LBD` référençait une matière `Mathématiques` (`af4d0a71-...`) appartenant à un établissement totalement différent — **Prytanée Militaire Saint-Louis** (`PMS001`, `d88d242a-...`), probablement créé via un test antérieur de `POST /etablissements/register`. `TEST_LBD` n'avait **aucune** ligne dans `matieres` (0 lignes), confirmant que `010_test_seed_enseignant_parent.sql` avait fait `SELECT id FROM matieres WHERE nom = 'Mathématiques' LIMIT 1` sans filtre `etablissement_id`.

Fix en deux parties :
1. **Migration 016** (`016_fix_seed_matiere_cross_etablissement.sql`) : crée `Mathématiques` scopée à `TEST_LBD` (code `MATH`, unique par `etablissement_id+code` donc pas de conflit avec la ligne PMS001), puis `UPDATE` de la ligne `affectations_enseignants` polluée vers la nouvelle matière. Appliquée en direct : **1 ligne corrigée**.
2. **Source de 010 corrigée** : le `SELECT ... LIMIT 1` sans filtre est remplacé par un `INSERT ... ON CONFLICT DO NOTHING` + `SELECT` scopé à `v_etab_id`, pour qu'une ré-exécution sur base fraîche ne réintroduise pas le bug.

Vérification en direct avant/après (`GET /enseignants/moi/classes` avec `enseignant@test.sn`) : `matiere_id` passe de `af4d0a71-...` (PMS001) à `969eb911-...` (TEST_LBD), même nom affiché "Mathématiques" côté UI donc **aucune régression visible**, mais la donnée est maintenant correctement isolée par établissement. Ré-exécution de 010 et 016 confirmée idempotente (aucun changement, aucune erreur). 108/108 tests toujours verts.

Commit `bb085d7` — `fix(backend): seed TEST_LBD — affectation enseignant référençait une matière d'un autre établissement`.

---

## 4. Plans d'implémentation — M1, M2, m1 (non implémentés cette session)

### 4.1 M1 — `POST /configs/coefficients` : créer une configuration de coefficient

**Constat (rappel du passage précédent, reconfirmé en lisant `configs.routes.js`) :** `GET /configs/coefficients` et `PUT /configs/coefficients` (modification batch) existent, mais aucun endpoint ne crée une ligne `configs_matieres_niveau`. Une matière créée via `POST /configs/matieres` reste donc à jamais absente du calcul des moyennes (`moyennes.routes.js` joint `configs_matieres_niveau`).

**Fichier à modifier :** `backend/src/domains/03-pedagogie/configs/configs.routes.js` (ajouter la route juste après le bloc `PUT /configs/coefficients`, avant la section `GET /configs/matieres`).

**Contrat de l'endpoint :**

```
POST /configs/coefficients
Permission : perm('config.coefficients')   (déjà accordée à directeur + super_admin — cohérent avec PUT existant)
Body (zod) :
  {
    matiere_id:          string().uuid(),                              // requis
    niveau_id:            string().uuid(),                              // requis
    serie_id:             string().uuid().nullable().optional(),        // optionnel — cf. point d'attention ci-dessous
    coefficient:           number().min(0.5).max(10).default(1),
    est_eliminatoire:      boolean().default(false),
    seuil_eliminatoire:    number().min(0).max(20).nullable().optional(),
    nb_devoirs_periode:    number().int().min(1).max(5).nullable().optional(),
    nb_compos_periode:     number().int().min(0).max(3).nullable().optional(),
    est_obligatoire:       boolean().default(true),
  }
Réponse 201 : cree(res, configRow)  // la ligne configs_matieres_niveau créée, mêmes colonnes que fetchCoefficients()
Erreurs :
  404 si matiere_id n'appartient pas à req.etablissement_id (même pattern que POST /configs/matieres)
  404 si niveau_id n'appartient pas à req.etablissement_id
  404 si serie_id fourni mais introuvable dans `series` (pas de vérification etablissement_id nécessaire si la table series n'a pas cette colonne — À VÉRIFIER en premier avec \d series avant d'écrire le code)
  422 si une configuration existe déjà pour (matiere_id, niveau_id, serie_id, année courante)
```

**Logique métier (calquer sur `fetchCoefficients` et `POST /configs/matieres` existants) :**
1. Résoudre l'année scolaire courante (`annees_scolaires WHERE etablissement_id = req.etablissement_id AND est_courante = true`) — comme `fetchCoefficients()` le fait déjà, réutiliser le même helper si possible plutôt que dupliquer.
2. Vérifier que `matiere_id` appartient à `req.etablissement_id` (`matieres.where({ id, etablissement_id })`).
3. Vérifier que `niveau_id` appartient à `req.etablissement_id`.
4. Si `serie_id` fourni, vérifier son existence.
5. **Point d'attention critique — contrainte UNIQUE et NULL** : `configs_matieres_niveau_niveau_id_matiere_id_serie_id_annee_key` est UNIQUE sur `(niveau_id, matiere_id, serie_id, annee_scolaire_id)`. En PostgreSQL, deux `NULL` ne sont **pas égaux** dans une contrainte UNIQUE standard (`NULLS DISTINCT` par défaut) — donc si `serie_id` est `NULL` (cas le plus courant, collège sans séries), la contrainte SQL **ne bloquera pas** un doublon. Il faut donc une vérification applicative explicite avant l'insertion, avec `IS NOT DISTINCT FROM` pour gérer `NULL` correctement :
   ```js
   const existant = await db('configs_matieres_niveau')
     .where({ niveau_id, matiere_id, annee_scolaire_id: annee.id })
     .whereRaw('serie_id IS NOT DISTINCT FROM ?', [serie_id || null])
     .first('id');
   if (existant) throw ApiError.validationEchouee('Une configuration existe déjà pour cette matière/niveau/série');
   ```
6. `INSERT INTO configs_matieres_niveau` avec `uuid()`, `annee_scolaire_id: annee.id`, retourner `.returning('*')`.
7. `logger.info('Configuration coefficient créée', { ... })`.
8. `invalidatePattern(`coefficients:${req.etablissement_id}`)` (même clé de cache que GET/PUT).

**Séquencement recommandé :**
1. `docker exec ecole_postgres psql ... \d series` pour confirmer le schéma exact (colonnes, présence ou non d'`etablissement_id`) avant d'écrire la vérification d'appartenance.
2. Écrire la route, tester en direct avec `directeur@test.sn` : créer une matière test (`POST /configs/matieres`), puis assigner un coefficient via le nouvel endpoint, puis vérifier `GET /configs/coefficients` la retourne bien groupée sous le bon niveau.
3. Tester le cas doublon (même matiere_id/niveau_id/serie_id=null deux fois) → doit renvoyer 422, pas un 500 de contrainte SQL.
4. Ajouter un test unitaire dans `backend/tests/domains/` suivant le pattern des tests existants pour `configs.routes.js`.
5. Frontend (`dashboard/js/pages/parametres.js`) — ajouter une section "Coefficients" sous la liste des matières existante : un formulaire simple (select niveau via `GET /niveaux` déjà existant, select matière via `GET /configs/matieres` déjà chargé, input coefficient) qui appelle le nouvel endpoint puis rafraîchit `GET /configs/coefficients`.

**Portée volontairement réduite pour la v1 :** ne pas construire de sélecteur de `serie_id` dans l'UI — aucun `GET /series` n'existe actuellement dans le backend (vérifié : `grep` ne trouve aucune route l'exposant), et la plupart des établissements du produit n'ont pas de séries en dessous de la Terminale. Le champ `serie_id` reste supporté par l'API (nullable) mais l'écran v1 ne couvre que le cas niveau-sans-série. Ajouter `GET /series` est un chantier séparé si le besoin apparaît.

**Effort estimé :** 0.5–1 jour (endpoint ~1-2h avec tests, UI parametres.js ~2-3h).

---

### 4.2 M2 — Dashboard EDT : ajouter la création/édition de créneaux

**Constat :** le backend est déjà 100% fonctionnel et vérifié (`POST/PUT/DELETE /edt/creneaux`, y compris détection de conflit horaire) mais `dashboard/js/pages/edt.js` ne fait que `GET /classes` + `GET /edt/classe/:id` (lecture seule).

**Prérequis à corriger avant/pendant l'implémentation — bug latent découvert en lisant `edt.js` cette session (non vérifié en exécution navigateur, à confirmer en premier) :** `dashboard/js/pages/edt.js` lignes 18 et 61 lisent `res.donnees` (français) alors que **tous** les endpoints backend renvoient l'enveloppe `{ succes, data, meta }` (`backend/src/utils/reponse.js`) — le champ est `data`, jamais `donnees`. `dashboard/js/pages/enseignants.js` et `parametres.js` utilisent correctement `res.data`. Si confirmé en testant la page EDT dans un vrai navigateur contre le backend local, ceci expliquerait pourquoi le sélecteur de classe ne s'est peut-être jamais rempli en pratique locale (le passage précédent n'a vérifié le backend qu'en `curl`, jamais le JS du dashboard lui-même dans un navigateur). **Premier réflexe de la session qui implémente M2 : ouvrir la page EDT du dashboard en local et confirmer/infirmer ce point avant d'écrire une seule ligne de nouvelle UI** — corriger `res.donnees` → `res.data` si confirmé (2 occurrences, fix trivial mais bloquant pour tout le reste).

**Nouvel endpoint backend nécessaire — `GET /plages-horaires` :** aucune route n'expose actuellement la liste des plages horaires de l'établissement (vérifié : `grep -rn "router.get.*plages"` ne retourne que du code interne de jointure). Le formulaire de création de créneau a besoin de lister les plages disponibles (8h-9h, 9h-10h, etc.) pour le sélecteur.

```
Fichier : backend/src/domains/04-vie-scolaire/edt/edt.routes.js (ajouter avant POST /edt/creneaux)
GET /plages-horaires
Permission : perm('edt.voir')   (déjà accordée à admin/censeur/directeur/enseignant/parent/eleve/super_admin)
Réponse : liste(res, plages)  // id, numero, libelle, heure_debut, heure_fin, est_pause — triées par numero
```

**Endpoint existant réutilisable — `GET /classes/:classe_id/affectations`** (`backend/src/domains/01-identites/identites.routes.js` ligne 262, `perm('eleves.voir')`) : retourne déjà `{ affectation_id, matiere_id, matiere, couleur_affichage, enseignant_nom, enseignant_prenom }` pour une classe donnée — exactement ce qu'il faut pour peupler le sélecteur "matière/enseignant" du formulaire de créneau. Ne pas recréer cet endpoint.

**UI à ajouter dans `dashboard/js/pages/edt.js` :**
1. Après sélection d'une classe (mécanisme déjà en place), ajouter un bouton "+ Ajouter un créneau" qui ouvre un modal (nouveau, suivre le pattern `openModal`/`closeModal` déjà utilisé dans `enseignants.js`/`parametres.js`) avec :
   - Select "Jour" (Lundi→Samedi, valeurs 1-6, statique côté client comme `JOURS_NOMS` déjà dupliqué côté backend).
   - Select "Plage horaire" — peuplé via le nouveau `GET /plages-horaires`.
   - Select "Matière / Enseignant" — peuplé via `GET /classes/:classe_id/affectations` (valeur = `affectation_id`).
   - Input texte optionnel "Salle".
   - Bouton "Créer" → `Api.post('/edt/creneaux', { classe_id, affectation_id, plage_id, jour_semaine, salle })`.
   - Gérer l'erreur 422 de conflit horaire (`Un créneau existe déjà pour cette classe à cette plage horaire`) avec un `toast` explicite plutôt qu'un message générique — le backend renvoie déjà ce message précis dans `erreur`.
2. Rendre chaque case de la grille (`renderGrid`) cliquable quand elle contient un créneau : au clic, ouvrir le même modal pré-rempli en mode édition (`PUT /edt/creneaux/:id`), avec un bouton "Supprimer" additionnel (`DELETE /edt/creneaux/:id`, avec confirmation).
3. Après création/modification/suppression, recharger `GET /edt/classe/:id` pour rafraîchir la grille (le cache Redis backend est déjà invalidé côté serveur via `invalidatePattern`, donc le prochain GET renverra les données fraîches sans délai).

**Points d'attention :**
- `perm('edt.creer')` (création/modif/suppression) n'est accordée qu'à `directeur` et `super_admin` — cohérent, mais s'assurer que le bouton "+ Ajouter un créneau" ne s'affiche pas pour un rôle censeur/admin qui n'a que `edt.voir` (sinon clic → 403 confus). Vérifier le rôle courant côté dashboard (`localStorage` / `CONFIG.USER_KEY`, pattern déjà utilisé ailleurs dans le dashboard) avant d'afficher le bouton.
- La détection de conflit backend ne couvre que **classe + plage + jour** — elle ne détecte pas un enseignant déjà occupé sur un autre créneau à la même plage/jour pour une autre classe (double-réservation enseignant). Non bloquant pour livrer M2 v1 (le backend actuel ne le fait pas non plus), mais à noter comme limite connue plutôt que supposer que c'est couvert.
- `PUT /edt/creneaux/:id` accepte `affectation_id` en modification — donc changer la matière/enseignant d'un créneau existant est possible sans passer par une suppression/recréation ; l'UI d'édition peut réutiliser le même select "Matière/Enseignant" que la création.

**Séquencement recommandé :**
1. Confirmer/corriger le bug `res.donnees` (bloquant, 10 min).
2. Ajouter `GET /plages-horaires` backend + test.
3. Construire le modal de création (le cas le plus simple), tester en direct avec `directeur@test.sn`.
4. Ajouter l'édition/suppression sur clic de case.
5. Vérifier avec un compte `censeur` (ou équivalent `edt.voir` sans `edt.creer`) que le bouton de création n'apparaît pas / que l'API renvoie bien 403 si forcé côté client (défense en profondeur, ne pas se fier uniquement à l'UI cachée).

**Effort estimé :** 1–2 jours (endpoint + UI complète création/édition/suppression + gestion des permissions par rôle).

---

### 4.3 m1 — `req.session.role` fragile pour les comptes multi-rôles

**Constat :** `backend/src/middleware/auth.middleware.js` (lignes 65-79) charge `roles` (tableau, correct) mais pose aussi `role: roles[0]?.code` — un singulier arbitraire, sans `ORDER BY` déterministe côté SQL. `notifications.routes.js` (`GET /notifications`, ligne 217) branche exclusivement sur ce singulier :
```js
const role = req.session.role;
if (role === 'parent') { ... } else if (role === 'enseignant') { ... } else { ... /* branche admin par défaut */ }
```
Un utilisateur cumulant `enseignant` + `parent` dans le même établissement (schéma le permet : `utilisateur_roles` a une contrainte unique sur `(utilisateur_id, role_id, etablissement_id)`, donc plusieurs lignes avec des `role_id` différents sont valides) recevrait un payload de notifications dépendant de l'ordre arbitraire retourné par Postgres — pourrait afficher uniquement les notifs "enseignant" en ratant totalement les notifs "parent" (absences/notes/bulletins de ses propres enfants), ou l'inverse.

**Fichiers à modifier :**
- `backend/src/domains/notifications.routes.js` (le seul point d'usage métier de `req.session.role`, confirmé par `grep -rln "session.role\b"` — les deux autres usages sont dans `auth.middleware.js`/`auth.routes.js` et ne concernent que l'affichage informatif du rôle principal au login, pas une décision de filtrage de données).

**Fix recommandé — remplacer la branche unique par une agrégation sur `req.session.roles` (tableau déjà disponible, pas de nouvelle requête SQL nécessaire) :**

```js
router.get('/notifications', auth, isoler, async function(req, res, next) {
  const db     = getDB();
  const userId = req.session.utilisateur_id;
  const etabId = req.etablissement_id;
  const roles  = req.session.roles || [];   // tableau complet, pas roles[0]

  try {
    // Un utilisateur multi-rôle voit l'union de toutes les catégories
    // pertinentes à ses rôles — pas seulement celles du "rôle principal"
    // arbitraire (roles[0]).
    const parties = [];
    if (roles.includes('parent'))     parties.push(notifsParent(db, userId, etabId));
    if (roles.includes('enseignant')) parties.push(notifsEnseignant(db, userId, etabId));
    if (roles.some(r => ['directeur', 'censeur', 'admin', 'super_admin'].includes(r))) {
      parties.push(notifsAdmin(db, etabId));
    }
    // Élève : pas de branche notifsEleve() actuelle (à vérifier — hors
    // scope de ce fix si absente aujourd'hui, ne pas l'inventer ici).

    const resultats = await Promise.all(parties);
    const raw = resultats.reduce((acc, r) => ({
      appelsManques:  [...(acc.appelsManques  || []), ...(r.appelsManques  || [])],
      absences:       [...(acc.absences       || []), ...(r.absences       || [])],
      notes:          [...(acc.notes          || []), ...(r.notes          || [])],
      bulletins:      [...(acc.bulletins      || []), ...(r.bulletins      || [])],
      incidents:      [...(acc.incidents      || []), ...(r.incidents      || [])],
    }), {});

    // ... reste inchangé (construction de `categories`, `total`, `ok(res, ...)`)
  } catch (err) { next(err); }
});
```

**Points d'attention :**
- Vérifier le comportement actuel pour le rôle `eleve` avant de modifier : le code actuel (`role === 'parent' | 'enseignant' | else admin`) route un compte `eleve` seul vers `notifsAdmin()` par défaut — potentiellement déjà un bug distinct, mais **hors du périmètre m1** tel que documenté dans le rapport précédent. Ne pas corriger ce point sans le vérifier séparément en exécution réelle d'abord (peut être intentionnel si aucun compte élève n'a de dashboard notifications dédié).
- `Promise.all` sur les branches change le nombre de requêtes SQL en cas de multi-rôle (avant : 1 branche = quelques requêtes ; après : jusqu'à 3 branches en parallèle pour un compte cumulant tout) — impact performance négligeable vu `LIMIT 10` partout et l'absence de cas d'usage multi-rôle réel actuellement, mais à garder en tête si m1 est repoussé et que le nombre de comptes multi-rôles grandit.
- Aucune migration de données nécessaire — c'est un pur bug de logique applicative, pas de donnée corrompue.
- Test à ajouter : `backend/tests/domains/notifications.test.js` (vérifier s'il existe déjà) — cas d'un utilisateur avec `roles: ['enseignant', 'parent']` doit recevoir les catégories des deux branches, pas juste une.

**Effort estimé :** 0.5 jour (fix + tests ; pas de donnée à migrer, pas de nouvel endpoint).

---

## 5. État des lieux final

### 5.1 Total des correctifs sur les 3 passages

19 commits `fix(backend)` au total dans l'historique git à la fin de cette session (16 des passages 1-2 + 3 de cette session : `dd501ca` M4, `a16ba30` M3, `bb085d7` m2), plus les commits `fix(mobile)`/`style(design)`/`chore` annexes des passages précédents non recomptés ici (hors périmètre backend).

Répartition de cette session :
- **1 bug critique confirmé et corrigé** (M4 — pire que prévu : 500 dur, pas silencieux).
- **1 bug de code mort neutralisé** (M3 — piège désamorcé avant qu'il ne cause un incident).
- **1 pollution de données de test corrigée** (m2 — root cause dans la source de migration, corrigée pour éviter la récidive sur une base fraîche).
- **3 plans d'implémentation actionnables produits** (M1, M2, m1) — prêts à être exécutés sans re-investigation.

### 5.2 Ce qui reste

| Item | Nature | Bloquant pour... |
|---|---|---|
| M1 | Fonctionnalité manquante (assignation coefficient) | Écoles ajoutant une matière après l'onboarding initial |
| M2 | UI manquante (EDT lecture seule) | Autonomie des écoles sur la construction de leur emploi du temps |
| m1 | Fragilité de logique (rôle unique) | Comptes multi-rôles — **aucun cas d'usage réel actuellement dans les données vues** |
| Couverture `sync.routes.js` (section 3 du plan précédent) | Dette de test | Toute nouvelle opération `POST /sync/operations` |
| `dashboard/js/config.js` pointant sur Render prod (section 4 du plan précédent) | Config dev | Suite Playwright locale existante |
| Bug `res.donnees` vs `res.data` dans `edt.js` (découvert cette session, section 4.2) | Bug latent non vérifié en navigateur | Bloquant pour M2 — à confirmer en premier |

### 5.3 Verdict — priorité recommandée

**M4 était le seul item de ce lot avec un risque de sécurité/isolation réel (traversée de tenant potentielle si le comportement avait été un `IS NULL` silencieux au lieu d'un 500) — il est maintenant traité, avec preuve en exécution réelle. Ce point ne bloque plus rien.**

Pour la suite, **M1/M2/m1 sont déconnectés du développement mobile** — ce sont des lacunes fonctionnelles et de robustesse côté dashboard web (gestion des coefficients, construction d'EDT, notifications multi-rôles), aucun des trois ne touche aux endpoints consommés par l'app mobile (`sync.routes.js`, `appels`, `presences`, `notes`, tous déjà audités et corrigés lors des passages 1-2). **Rien n'empêche de reprendre le développement mobile immédiatement.**

Si une session future doit choisir un ordre pour M1/M2/m1 : **M1 avant M2** (effort moindre, débloque une vraie limitation produit — une école ne peut pas ajouter de matière utilisable après l'onboarding), **M2 ensuite** (plus gros chantier UI, mais backend déjà 100% prêt), **m1 en dernier** (aucun cas d'usage réel actuellement — traiter seulement si des comptes multi-rôles deviennent un besoin produit confirmé, pour ne pas corriger un problème hypothétique avant un problème réel).

La couverture de test de `sync.routes.js` (recommandation du passage précédent, section 3) reste la priorité la plus élevée de tout ce qui n'est pas encore fait, si le développement mobile continue d'ajouter des opérations `POST /sync/operations` — c'est le seul point qui touche directement le chemin critique mobile.

---

## 6. Annexe — commandes de vérification utilisées cette session

```bash
# Backend
curl -X POST http://localhost:3010/api/v1/auth/connexion -H "Content-Type: application/json" \
  -d '{"identifiant":"superadmin@test.sn","mot_de_passe":"Test1234!","etablissement_code":"TEST_LBD"}'

# Migrations appliquées directement (pas de tracking _migrations utilisé dans ce projet
# pour les seeds/fixes idempotents — appliquées à la main comme les migrations 009-014)
docker exec -i ecole_postgres psql -U ecole_user -d ecole_manager < backend/migrations/015_test_seed_super_admin.sql
docker exec -i ecole_postgres psql -U ecole_user -d ecole_manager < backend/migrations/016_fix_seed_matiere_cross_etablissement.sql

# Schéma réel (jamais faire confiance au code)
docker exec ecole_postgres psql -U ecole_user -d ecole_manager -c '\d configs_matieres_niveau'
docker exec ecole_postgres psql -U ecole_user -d ecole_manager -c '\d plages_horaires'
docker exec ecole_postgres psql -U ecole_user -d ecole_manager -c "SELECT id, code FROM roles ORDER BY id;"

# Suite de tests backend
cd backend && npm test
```
