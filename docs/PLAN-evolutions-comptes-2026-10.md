# EcoleManager — Plan d'évolution des comptes
## Mots de passe · parents multi-établissements · dashboard web vs mobile

> Plan destiné à l'exécution par ATLAS (`/atlas`) — format identique à `docs/PLAN_CREATION.md`.
> Date : 2026-10-07 · Branche de travail : `claude/trusting-noether-lgj1sa`
> État de départ : backend 306 tests unitaires + 116 tests d'intégration (base réelle), dashboard 82 tests,
> migrations 000→021 appliquées.

Règles d'exécution (valables pour toutes les phases) :
- Un commit par tâche, message en français (`feat(auth): …`, `fix(dashboard): …`), terminé par les lignes
  d'attribution de la session. **Ne pas ouvrir de pull request sans demande explicite.**
- Avant chaque commit : `cd backend && npm run lint && npm test`, `cd dashboard && npx vitest run`,
  et pour tout changement SQL/auth/route : `cd backend && npm run test:integration`
  (ce script crée et supprime lui-même la base `ecole_manager_test` : ne pas utiliser ce nom pour des essais manuels).
- Toute règle de sécurité nouvelle se vérifie sur **l'API réelle** (base PostgreSQL + Redis), pas seulement avec
  les mocks Knex : trois défauts de ce plan n'étaient visibles qu'ainsi.
- Mettre à jour `CLAUDE.md` (migrations, règles de sécurité, compteurs de tests) dans le même commit que le code.
- Ne jamais committer de dump (`dump.rdb`) : lancer `redis-server` avec `--dir /tmp`.

---

## Décisions du 2026-10-07 (réponses du responsable produit)

| # | Question | Décision | Conséquence |
|---|----------|----------|-------------|
| 1 | Le cas « parent dans plusieurs écoles » est-il réel ? | **Pas encore, mais il faut s'y préparer** | Exécuter 3.1 → 3.3 (rendre la situation possible et sûre) ; différer 3.4 (sélecteur) tant qu'aucun cas réel n'existe |
| 2 | Vue agrégée « tous mes enfants, toutes écoles » | Définition demandée → voir « Vue agrégée » en phase 3 | À décider après l'explication ; ne bloque pas 3.1-3.3 |
| 3 | Coût des SMS | Chiffrage demandé → voir « Coût des SMS » ci-dessous (phase 2bis) | Tâches 2.5 et 2.6 |
| 4 | Sessions simultanées : 3 ou 5 ? | Éclaircissement demandé → voir 4.4 | Décision en attente |
| 5 | Même email pour deux écoles ? | **Oui pour un parent. Non pour un directeur et un enseignant** | Voir 3.6 |

## Avancement

| Tâche | Statut |
|-------|--------|
| 2.1 Audit des mots de passe faibles | ✅ fait (`npm run auditer:mots-de-passe`) |
| 2.2 Mot de passe provisoire par SMS | ✅ fait (`POST /enseignants`, `POST /enseignants/:id/mot-de-passe-provisoire`, bouton « 🔑 MDP » du dashboard) |
| 2.3 Blocage de connexion par établissement | ✅ fait (migration 022) |
| 2.4 Réglage de la politique par le directeur | ⏳ optionnelle, non faite |
| 2.5 Gabarits SMS en un segment | ✅ fait (voir ci-dessous) |
| 2.6 Fiabiliser et plafonner les notifications | ✅ fait (voir ci-dessous) |
| Phase 3 | ✅ 3.1, 3.2, 3.3, 3.6 faites (migration 024) ; 3.5 couverte par 2 suites d'intégration ; 3.4 (sélecteur) différée |
| Phase 4 | ✅ 4.1, 4.2, 4.3, 4.4 faites (limite de sessions inchangée : décision produit en attente) ; ⏳ 4.5 (E2E Playwright, 375 px) non faite |

---

## Diagnostic vérifié

### Déjà fait (à ne pas refaire)

| Sujet | Résultat | Preuve |
|-------|----------|--------|
| Politique de sécurité absente pour les écoles créées par `/inscription` | Migration `021_politique_securite_defaut.sql` : trigger `AFTER INSERT ON etablissements` + rattrapage des écoles existantes | `tests/integration/politique-securite.integration.test.js` (4 tests) ; essai réel : les 2 écoles créées ont leur ligne |
| `POST /auth/otp/valider` ouvrait une session pour une école où le compte n'existe pas | Contrôle `utilisateur.etablissement_id === etablissement.id` | `tests/integration/otp-etablissement.integration.test.js` ; le test échoue sans le correctif (vérifié) |
| Dashboard : boucle `login.html ↔ parent.html` + rafale de 401 jusqu'au 429 à l'expiration du jeton | `Api.request` purge la session avant de rediriger (parent → `parent-login.html`) ; `par-login.ts` conserve le `refresh_token` | 3 tests Vitest ; essai Chromium : 1 appel 401, rafraîchissement silencieux, page rétablie |

### Constats ouverts

| # | Constat | Gravité | Phase |
|---|---------|---------|-------|
| C1 | `utilisateurs.telephone` est `UNIQUE` pour toute la base : un parent (ou un enseignant vacataire) ne peut avoir de compte que dans **un** établissement | Fonctionnelle (bloquante pour le cas multi-écoles) — **Corrigé** (3.2, migration 024) | 3 ✅ |
| C2 | `otp_verifications` est indexé par téléphone seul ; `otp/demander` invalide **tous** les codes du numéro | À corriger avant C1 (sinon un code demandé pour l'école B annule celui de l'école A) — **Corrigé** (3.1) | 3 ✅ |
| C3 | ~~`est_compte_bloque()` (SQL) lit `MAX(...)` sur toutes les écoles~~ **Corrigé** (2.3, migration 022) | — | 2 ✅ |
| C4 | ~~Le mot de passe provisoire est renvoyé en clair au directeur~~ **Corrigé** (2.2) : envoyé par SMS, renvoyé au directeur seulement si le SMS échoue | — | 2 ✅ |
| C5 | ~~Mots de passe faibles antérieurs~~ **Outil livré** (2.1) : à exécuter sur la base de production (simulation d'abord) | — | 2 ✅ / 5 |
| C11 | ~~Gabarits SMS en UCS-2 (tiret long, « ê »), 2 à 3 segments facturés~~ **Corrigé** (2.5) : les 6 gabarits tiennent en 1 segment GSM-7, et `envoyerSMS` convertit tout message | — | 2.5 ✅ |
| C12 | ~~Notifications jamais envoyées~~ **Confirmé sur base réelle puis corrigé** (2.6) : le worker ne retrouvait jamais le parent (jointure `inscriptions.eleve_id` → `utilisateurs` au lieu de `eleves`) — donc AUCUN SMS d'absence, de retard, de sanction ni de note n'avait pu partir ; en plus : journal rejeté (`etablissement_id` NOT NULL), `nouvelle_note` sans `inscription_id`, report horaire cassé avec BullMQ 5 | — | 2.6 ✅ |
| C6 | Dashboard, page **enseignant** : `ens-app.ts` appelle `Auth.populateSidebar()`, qui cible `sb-nom`, `sb-role`, `sb-etab` alors que la page utilise `sb-user-nom`, `sb-user-role`, `sb-user-avatar`, `sb-etab-nom` → nom, rôle, avatar et établissement restent vides. (Les pages admin `app.ts` et parent `par-app.ts` les renseignent correctement.) | Faible (UX) | 4 |
| C7 | `login.html` n'a pas de lien vers `parent-login.html` (l'inverse existe) : un parent qui arrive sur la page du personnel ne trouve pas sa connexion | Faible (UX) | 4 |
| C8 | Le dashboard est **en ligne uniquement** : l'appel et les notes d'un enseignant ne fonctionnent pas hors connexion (contrainte terrain n°1 du projet) | Structurelle, à documenter et à signaler dans l'interface | 4 |
| C9 | `session_max_simultanees = 3` : téléphone + web + un 3ᵉ appareil ferment silencieusement la plus ancienne session | Faible | 4 |
| C10 | Tests SQL mobile (`__tests__/sql/*`) : exigent le binaire natif `better-sqlite3` ; échouent si `npm ci --ignore-scripts` | Environnement | 5 |

---

## Phase 2 — Durcissement des mots de passe

**Complexité : Moyenne · Durée estimée : 2-3 jours · Prérequis : aucun**

### 2.1 — Auditer et marquer les mots de passe faibles existants (C5)

On ne peut pas lire un mot de passe haché, mais on peut tester un petit dictionnaire de valeurs prévisibles
contre chaque hash (`bcrypt.compare`) : le téléphone du compte (toutes formes), `123456`, `password`,
`motdepasse`, le code établissement, le nom/prénom.

- Créer `backend/src/utils/auditer-mots-de-passe.js` (même modèle que `normaliser-telephones.js` :
  fonction pure testable + `main()`), script `npm run auditer:mots-de-passe`.
- **Simulation par défaut** ; `--appliquer` positionne `utilisateurs.mdp_a_changer = TRUE` pour les comptes trouvés
  (le changement forcé existant fait le reste, y compris sur mobile).
- Sortie : nombre de comptes concernés par cause, jamais le mot de passe trouvé dans les logs.
- Tests : `backend/tests/utils/auditer-mots-de-passe.test.js` (hash bas coût bcrypt 4 pour la vitesse).
- Critère d'acceptation : sur une base de test avec 3 comptes (téléphone, `123456`, mot de passe solide),
  la simulation en liste 2, `--appliquer` en marque 2, une seconde exécution n'en trouve plus rien à changer.

### 2.2 — Envoyer le mot de passe provisoire par SMS au lieu de le montrer au directeur (C4)

- `POST /enseignants` (`backend/src/domains/02-acteurs/enseignants/enseignants.routes.js`) : après la création,
  envoyer le mot de passe provisoire à l'enseignant via `envoyerSMS` (`infrastructure/notifications/sms.service.js`),
  message court : établissement + identifiant + mot de passe + rappel du changement obligatoire.
- Réponse : `{ sms_envoye: true }` **sans** le mot de passe. Si l'envoi échoue ou si `AT_API_KEY` est absent
  (dev/test), conserver le comportement actuel (mot de passe dans la réponse) avec `sms_envoye: false`
  — c'est le seul chemin de secours, il doit être explicite dans la réponse.
- Nouvelle route `POST /enseignants/:id/mot-de-passe-provisoire` (permission `config.modifier`) : génère un nouveau
  mot de passe provisoire, lève `mdp_a_changer`, révoque les sessions de l'enseignant, l'envoie par SMS
  (même repli). Évite au directeur de devoir connaître un mot de passe pour dépanner.
- Ne **jamais** journaliser le mot de passe (ni dans `logger`, ni dans `journal_audit`).
- Dashboard (`dashboard/src/pages/enseignants.ts`) : afficher « SMS envoyé au +221… » ; bouton « Renvoyer un mot
  de passe provisoire » dans la fiche ; n'afficher le mot de passe que si `sms_envoye === false`.
- Tests : unitaire (SMS mocké : succès → pas de mot de passe dans la réponse ; échec → repli) + intégration.
- Critère d'acceptation : avec `AT_API_KEY` factice et le service SMS mocké, la réponse ne contient pas le mot de
  passe ; l'enseignant peut se connecter avec le SMS reçu puis est forcé de le changer.

### 2.3 — Isoler la politique de blocage par établissement (C3)

- Nouvelle migration `022_est_compte_bloque_par_etablissement.sql` : `est_compte_bloque(p_identifiant, p_ip,
  p_etablissement_id UUID DEFAULT NULL)` lit la politique de **cette** école (repli sur 5 tentatives / 15 min).
  Garder l'ancienne signature en surcharge pour ne pas casser un déploiement en cours (même principe que 018).
- `auth.routes.js` : l'établissement est résolu *avant* l'appel à `est_compte_bloque` (aujourd'hui l'appel précède la
  recherche de l'établissement : réordonner en gardant la même réponse d'erreur pour un établissement inconnu).
- `purge.worker.js` lit aujourd'hui `MIN(conservation_audit_jours)` toutes écoles confondues : conserver ce
  comportement (c'est le plus prudent) mais le documenter par un commentaire.
- Tests d'intégration : deux écoles, politiques différentes ; le blocage de l'une n'affecte pas l'autre.
- Critère d'acceptation : l'école A à 3 tentatives bloque après 3 échecs ; l'école B à 10 ne bloque pas après 3.

### 2.5 — Ramener les SMS à un seul segment (C11) — ✅ FAIT

Réalisé : `utils/sms-texte.js` (`versGsm7`, `compterSegments`, `limiterSegments`, `preparerTexteSms`) appliqué dans `envoyerSMS` à **tout** message (notifications, OTP, alertes de monitoring, mot de passe provisoire) ; gabarits du worker réécrits (« : » à la place du tiret long, `convocation` reformulée sans « ê ») ; plafond à 3 segments quel que soit le texte ; nombre de segments journalisé (`logger`, jamais le contenu). Garde : `tests/workers/sms-gabarits.test.js` (échoue avec les anciens gabarits). Non fait : stocker les segments dans `journal_notifications` (la table n'a pas de colonne dédiée — à voir avec 2.6 pour le plafond de dépense).

État initial mesuré avant correction :

Mesure faite sur les gabarits de `workers/notification.worker.js` (données d'exemple réalistes) :

| Gabarit | Aujourd'hui | Avec « - » à la place de « — » |
|---------|-------------|--------------------------------|
| absence, retard, nouvelle_note, bulletin_disponible | UCS-2 · 2 segments | GSM-7 · **1 segment** |
| sanction | UCS-2 · 3 segments | GSM-7 · **1 segment** |
| convocation | UCS-2 · 3 segments | encore UCS-2 (« êtes ») → à reformuler sans accent circonflexe |
| code de connexion (OTP) | GSM-7 · 1 segment | inchangé |

- Ajouter `versGsm7(message)` dans `sms.service.js` (étendre le `versAscii` existant : conserver é, è, à, ù, ç… qui sont dans l'alphabet SMS de base, remplacer « — », « – », « ’ », « « » », « ê », « î », « ô », « û »…) et l'appliquer dans `envoyerSMS` à **tout** message. Retirer le tiret long des gabarits.
- Remplacer la troncature à 459 caractères (valable pour du GSM-7 uniquement) par un calcul de segments :
  plafond de 3 segments quel que soit l'encodage.
- Journaliser le nombre de segments par envoi (jamais le contenu) pour pouvoir suivre le coût réel dans `journal_notifications`.
- Test unitaire : pour chaque gabarit et ses données d'exemple, `segments === 1` (sauf cas explicitement listés).
- Critère d'acceptation : le test de mesure ci-dessus passe à 1 segment pour les 6 gabarits.

### 2.6 — Fiabiliser et plafonner l'envoi des notifications (C12) — ✅ FAIT

Réalisé (détail du chantier, mesuré sur base réelle) :

**a) Le worker ne fonctionnait pas.** Les tests du worker étaient entièrement simulés : exécuté sur PostgreSQL, il répondait « parent introuvable » pour toutes les notifications. Corrigé : jointure `inscriptions → eleves → utilisateurs`, préférences en `LEFT JOIN` (un parent sans préférences reçoit les défauts), journal complet (`etablissement_id`, `eleve_id`), journal d'échec réparé, **une panne du journal après l'envoi ne relance plus le SMS** (BullMQ l'aurait renvoyé et refacturé). Le traitement est séparé du câblage BullMQ (`workers/notification.processor.js`) pour être testable sur base réelle.

**b) Publication des notes** (`PUT /evaluations/:id/publier`) : un job `nouvelle_note` par élève ayant une note (pas pour un absent justifié ni un dispensé) avec son `inscription_id` ; publication atomique (un second appel ne renotifie pas) ; **contrôle d'établissement ajouté** (avant : n'importe quel utilisateur pouvant publier pouvait publier les notes d'un autre établissement).

**c) Report hors plage horaire** : avec BullMQ 5, le worker doit appeler `job.moveToDelayed(date, jeton)` puis lever `DelayedError` ; l'ancien code produisait des erreurs « Missing lock » et reportait toujours à *demain* même avant l'ouverture de la plage. Corrigé et vérifié avec la vraie file : un parent dont la plage est 20 h-21 h, notifié à 12 h 55, reçoit son SMS à 20 h le jour même.

**d) Plafond mensuel** (migration 023) : `politique_securite.sms_plafond_mensuel` (défaut 3 000 segments/mois, 0 = illimité). Au plafond, notes et bulletins ne partent plus (blocage tracé dans `journal_notifications`, statut `annule`, code `PLAFOND_SMS`) ; absences, retards, sanctions et convocations continuent jusqu'à 150 % (butoir). Le directeur reçoit un SMS à 80 % puis à 100 %, une seule fois par palier et par mois (réservation atomique). Les codes de connexion et les mots de passe provisoires ne sont jamais bloqués. `GET /notifications/sms/consommation` et `PUT /notifications/sms/plafond`. Les segments réels sont enregistrés par message.

**Constaté, non traité** : `bulletin_disponible` et `convocation` ont un gabarit mais **aucun code ne les met en file** (seuls absence/retard, sanction et note le font). Interface du dashboard pour le plafond : non faite (API seulement).

Plan d'origine de la tâche :

- Vérifier par un test d'intégration que publier les notes d'une évaluation crée bien une notification par parent
  concerné ; si le job est mal formé (C12), faire éclater `{ evaluation_id }` en un job par inscription côté route ou
  côté worker.
- Plafond de dépense par établissement : compteur mensuel de SMS (Redis ou table), seuil d'alerte au directeur à 80 %,
  blocage des SMS non essentiels (jamais l'OTP) à 100 %. Valeur par défaut dans `politique_securite` (nouvelle colonne
  `sms_plafond_mensuel`, migration dédiée).
- Préférence de canal WhatsApp déjà prévue dans le worker : mesurer son coût réel avant de la recommander (non chiffré ici).

## Coût des SMS

**Prix : à confirmer.** Le site d'Africa's Talking (`africastalking.com`, `developers.africastalking.com`) est bloqué depuis
l'environnement d'exécution ; aucun tarif officiel n'a pu être lu. Les chiffres ci-dessous viennent de comparateurs tiers et
**ne sont pas les tarifs d'Africa's Talking** : à remplacer par ceux de votre compte (tableau de bord Africa's Talking, ou page
« Pricing »).

Repères trouvés (estimations tierces, par SMS) : comparateur régional — Sénégal 0,0111 € (≈ 7 XOF), Côte d'Ivoire 0,0240 €
(≈ 16 XOF), Mali 0,0197 € (≈ 13 XOF), Burkina Faso 0,0215 € (≈ 14 XOF) ; opérateurs locaux, tarifs « Pro » : 8 à 15 XOF au
Sénégal, 5 à 50 XOF en Côte d'Ivoire ; passerelles internationales (Twilio, Infobip…) : 0,14 à 0,44 USD, soit 10 à 30 fois plus.
Conversion à parité fixe : 1 € = 655,957 XOF.

**Formule** : coût mensuel = nombre de SMS × segments par SMS × prix du segment. Les gabarits actuels font **2 à 3 segments**
(C11) : c'est le premier levier, avant toute négociation de tarif.

Exemple chiffré — école de 500 élèves, ~450 parents, prix de 13 XOF le segment (**hypothèse**, milieu de fourchette) :

| Poste (hypothèses entre parenthèses) | SMS / mois |
|--------------------------------------|-----------:|
| Absences et retards (5 % d'absents × 22 jours) | 550 |
| Notes, bulletins, sanctions, convocations (2 par élève) | 1 000 |
| Codes de connexion des parents (2 par parent) | 900 |
| Mots de passe provisoires (30 enseignants, une fois) | 30 |
| **Total** | **≈ 2 480** |

| Scénario | Coût mensuel |
|----------|-------------:|
| Gabarits actuels (≈ 2 segments pour les notifications) | ≈ 52 400 XOF (≈ 80 €) |
| Après 2.5 (1 segment partout) | ≈ 32 200 XOF (≈ 49 €) — **−38 %** |

Les volumes sont des hypothèses : le vrai chiffre se lit dans `journal_notifications` après un mois de pilote.
À confirmer avec Africa's Talking : facturation au segment (probable), coût d'un identifiant d'expéditeur, recharge minimale,
couverture et prix par opérateur dans les 4 pays.

### 2.4 — (Optionnel) Permettre au directeur de régler sa politique

Aucune route n'écrit `politique_securite`. Ajouter `GET/PUT /securite/politique` (permission `config.modifier`),
validation Zod bornée (longueur mot de passe 8-32, tentatives 3-10, sessions 1-5), journalisée dans `journal_audit`.
À ne faire qu'après 2.3 (sinon le point C3 devient exploitable).

---

## Phase 3 — Parent (ou enseignant) présent dans plusieurs établissements

**Complexité : Élevée · Durée estimée : 5-8 jours · Prérequis : Phase 2.3 terminée**

### Décision d'architecture (à valider avant d'exécuter)

Trois options ont été étudiées.

| Option | Principe | Avantages | Inconvénients |
|--------|----------|-----------|---------------|
| **A — un compte par établissement** (recommandée) | `UNIQUE(etablissement_id, telephone)` ; le même numéro peut avoir un compte dans chaque école | Petit changement ; isolation multi-établissement et RLS intacts ; la connexion demande déjà le code établissement ; chaque école garde sa fiche | Un parent se connecte école par école (corrigé par le sélecteur de la 3.4) |
| B — identité globale + table d'appartenance | Une table `personnes`, `utilisateurs` devient une appartenance | Une seule identité, vue agrégée possible | Refonte de toutes les requêtes qui joignent `utilisateurs.etablissement_id`, du RLS, des sessions, du mobile hors-ligne ; risque élevé |
| C — A + sélecteur d'établissement | A, plus : après vérification du code SMS, choix de l'école et bascule de session | Bon confort sans toucher au modèle | Un peu de logique de session en plus |

**Recommandation : A puis C.** B n'est justifiée que si un besoin de vue agrégée « tous mes enfants, toutes écoles »
apparaît (groupe scolaire) — décision produit à prendre, voir « Questions ouvertes ».
La clé d'identité entre écoles est le **numéro E.164** : c'est précisément ce que la normalisation du téléphone permet.

### Vue agrégée — définition

C'est **un seul écran qui rassemble les enfants d'un même parent venant de plusieurs écoles** (par exemple Moussa à l'école A et
Aida à l'école B, avec leurs notes et absences côte à côte, et une seule liste de notifications). Sans elle (options A et C),
le parent voit **une école à la fois** et change d'école avec un sélecteur. La vue agrégée demande de lire les données de
plusieurs écoles dans une même requête, alors que le système est cloisonné par école (jeton lié à une école, isolation
stricte). Deux façons de la faire : une identité globale (option B, lourde) ou une application qui ouvre une session par école
et assemble l'affichage côté client (plus simple, mais seulement dans l'application/le navigateur). **Décision : pas
maintenant** ; elle peut s'ajouter plus tard sans défaire l'option A.

Cas de l'enseignant vacataire (plusieurs écoles) : même mécanisme, mais **sans** bascule automatique de session —
un compte à mot de passe se reconnecte avec son mot de passe dans chaque école.

### 3.1 — Corriger les OTP avant d'ouvrir le multi-comptes (C2) — ✅ FAIT

- `auth.routes.js`, `POST /auth/otp/demander` : n'invalider que les codes du même couple
  `(telephone, utilisateur_id)` ; `POST /auth/otp/valider` : incrémenter `nb_tentatives` et chercher le code sur ce
  même couple (aujourd'hui sur le téléphone seul).
- Test d'intégration : le même numéro a un compte dans A et dans B ; un code demandé pour A reste valable après une
  demande pour B ; chaque code n'ouvre que sa propre école (le contrôle de la phase 1 reste vert).

### 3.2 — Migration : unicité du téléphone par établissement (C1) — ✅ FAIT

- `migrations/023_telephone_unique_par_etablissement.sql` : supprimer `utilisateurs_telephone_key`, créer
  `UNIQUE (etablissement_id, telephone)` ; conserver l'index de recherche par téléphone seul.
  Sans risque pour les données : toute paire respectant l'unicité globale respecte l'unicité par école.
- `error.middleware.js` : mettre à jour `MESSAGES_DOUBLON` (nouveau nom de contrainte) et le message
  (« …déjà utilisé dans cet établissement »).
- Critère d'acceptation : deux comptes de même numéro dans deux écoles s'insèrent ; deux comptes de même numéro dans
  la même école sont refusés.

### 3.3 — Revoir toutes les recherches par téléphone — ✅ FAIT

À modifier (déjà repérées, vérifier par `grep -rn "telephone" backend/src`) :
- `eleves/eleves.routes.js` : `parentExistant` cherche aujourd'hui dans **toute** la base puis refuse si l'école
  diffère → chercher uniquement dans `req.etablissement_id` ; supprimer le refus « autre établissement ».
- `enseignants/enseignants.routes.js` : le contrôle de doublon devient intra-établissement ; retirer le message
  « autre établissement » (devenu faux) et ses tests (`tests/domains/enseignants.creation.test.js`).
- `setup/setup.routes.js` : téléphone du directeur — décider si l'unicité globale de l'**email** doit rester
  (elle l'est aujourd'hui : « email déjà associé à un compte ») ; un directeur de deux écoles utilisera deux emails
  ou le même téléphone.
- Vérifier `workers/notification.worker.js` et `rgpd.routes.js` : ils joignent par `id`, aucun changement attendu —
  le confirmer par un test.
- `utils/normaliser-telephones.js` : le test de conflit global devient un test par établissement
  (`pris` indexé par `etablissement_id`).

### 3.4 — Sélecteur d'établissement (option C)

Pour les **parents** (comptes sans mot de passe) uniquement :
- `POST /auth/otp/valider` : si le numéro vérifié possède des comptes dans plusieurs écoles et qu'aucun
  `etablissement_code` n'est fourni, répondre `{ choix_requis: true, etablissements: [{ code, nom }], ticket }`
  où `ticket` est un JWT signé de 5 minutes qui atteste « ce numéro vient d'être vérifié ». Le code établissement
  reste accepté (compatibilité avec les clients actuels).
- `POST /auth/otp/choisir` `{ ticket, etablissement_code }` → session de l'école choisie (mêmes contrôles
  d'appartenance que la phase 1).
- `POST /auth/changer-etablissement` `{ etablissement_code }` (authentifié, rôle parent seulement) : crée une session
  dans une autre école où le **même numéro** a un compte parent ; l'ancienne session reste valable.
  Refusé pour tout compte avec mot de passe.
- `POST /auth/otp/demander` sans `etablissement_code` : envoyer un code si le numéro existe quelque part, réponse
  identique dans tous les cas (anti-énumération, comme aujourd'hui) ; limiter au numéro (pas seulement à l'IP).
- Dashboard : `parent-login.html` rend le champ « code établissement » facultatif, ajoute l'étape de choix ;
  `parent.html` ajoute un sélecteur d'école dans l'en-tête.
- Mobile : l'écran de connexion gère `choix_requis` ; un sélecteur dans le profil bascule de session. La base SQLite
  locale est vidée à la déconnexion (voir `authStore.deconnexion`) : une bascule d'école = nouvelle session + nouvelle
  synchronisation, **pas** de fusion de bases (isolation conservée).
- Pas de vue agrégée inter-écoles dans cette phase (voir Questions ouvertes).

### 3.6 — Règle d'unicité de l'email selon le rôle (décision 5) — ✅ FAIT

Un même email peut servir dans plusieurs écoles **pour un parent** ; **jamais pour un directeur ni un enseignant**.
Aujourd'hui la base n'impose que `UNIQUE(etablissement_id, email)` (un même email dans deux écoles est donc possible), et seul
`/inscription` refuse un email déjà pris, globalement.
- `POST /enseignants` : refuser un email déjà utilisé par un compte **non parent** d'une autre école (contrôle applicatif :
  la contrainte ne peut pas dépendre du rôle) ; message précis.
- `/inscription`, `/setup` : conserver la vérification globale existante, en l'étendant aux comptes non parents seulement.
- Création de parent (`POST /eleves` avec parent) : aucun contrôle d'email (les parents n'en ont pas besoin).
- Cas limite à trancher : une personne à la fois enseignante et parente d'élève dans la même école (même téléphone,
  deux rôles) reste un seul compte.
- Tests d'intégration : directeur A puis directeur B avec le même email → refusé ; deux parents de deux écoles avec le même
  email → acceptés ; enseignant avec l'email d'un directeur d'une autre école → refusé.

### 3.5 — Tests de bout en bout

- Intégration (base réelle) : parent avec un enfant dans l'école A et un dans l'école B ; connexion par SMS, choix de
  l'école, lecture des enfants de **chaque** école uniquement, impossibilité de lire l'autre école avec la mauvaise
  session, `multitenant.integration.test.js` étendu.
- Chromium : parcours complet `parent-login.html` avec numéro à deux écoles (script type
  `browser_web.js` : intercepter l'API de production vers l'API locale, voir la CSP `connect-src`).
- Critère d'acceptation : un parent saisit son numéro une fois, reçoit un SMS, choisit l'école, voit ses enfants ;
  bascule vers l'autre école sans nouveau SMS ; la bascule est refusée pour un compte enseignant.

---

## Phase 4 — Utiliser le dashboard web à la place (ou en plus) de l'application mobile

**Complexité : Faible à moyenne · Durée estimée : 2-3 jours · Prérequis : aucun (indépendante)**

État vérifié dans Chromium (dashboard servi par `vite preview`, API réelle) :

| Parcours | Web | Remarque |
|----------|-----|----------|
| Enseignant : connexion avec numéro « 77 111 00 01 » | ✅ | Normalisation côté serveur |
| Enseignant : changement de mot de passe obligatoire | ✅ | Redirection forcée, y compris à l'ouverture manuelle de `enseignant.html` |
| Enseignant : pages classes, EDT, notes, appel, discipline | ✅ chargées sans erreur réseau ni erreur JS | Données vides sur la base de test : parcours fonctionnel non éprouvé avec des données réelles |
| Parent : code SMS puis tableau de bord | ✅ enfant affiché | |
| Parent : expiration du jeton | ✅ après correction (voir « Déjà fait ») | |
| Écran mobile (≤ 768 px) | ⚠️ non vérifié | Les parents ouvriront le web depuis leur téléphone |
| Hors connexion | ❌ | Le web ne fonctionne pas hors ligne (C8) |

### 4.1 — Corriger la barre latérale (C6) — ✅ FAIT

- `dashboard/src/auth.ts`, `populateSidebar` : viser `sb-user-nom`, `sb-user-role`, `sb-user-avatar` (initiales),
  `sb-etab-nom` — les mêmes identifiants et le même rendu que `app.ts` (lignes 10-13) et `par-app.ts` (37-40).
  Ne pas toucher à ces deux derniers fichiers (ils fonctionnent).
- Test Vitest (jsdom) : un DOM minimal avec ces quatre identifiants reçoit le nom, le rôle, les initiales et
  l'établissement du profil stocké.

### 4.2 — Lier les deux connexions (C7) — ✅ FAIT

- `login.html` : lien « Parent ? Connexion par code SMS → » vers `parent-login.html`.
- Test Playwright ou Vitest sur la présence et la cible du lien.

### 4.3 — Signaler l'absence de réseau (C8) — ✅ FAIT

- Bandeau global « Pas de connexion — l'appel et les notes ne peuvent pas être enregistrés depuis le web.
  Utilisez l'application mobile (mode hors ligne). » basé sur `navigator.onLine` + événements `online`/`offline`,
  et désactivation des boutons d'enregistrement tant que hors ligne (`ens-appel.ts`, `ens-notes.ts`).
- Documenter la différence dans `docs/README.md` : web = en ligne, mobile = hors ligne + synchronisation.
- Hors périmètre : transformer le dashboard en PWA hors ligne (chantier à part, à chiffrer).

### 4.4 — Sessions simultanées : message clair et limite (C9) — ✅ FAIT

**En clair :** chaque appareil connecté (téléphone, ordinateur de l'école, ordinateur personnel…) ouvre une « session ». La
politique de l'école limite leur nombre par compte (3 aujourd'hui). Quand un 4ᵉ appareil se connecte, **la plus ancienne session
est fermée sans avertissement** : l'utilisateur de l'ancien appareil est déconnecté sans comprendre pourquoi. Exemple : un
enseignant a l'appli sur son téléphone, le dashboard sur l'ordinateur de la salle des professeurs et sur son portable ; s'il
se connecte depuis un ordinateur partagé, l'un des trois est éjecté. Compromis : une limite plus haute évite ces
déconnexions, mais laisse plus de jetons valides en même temps si un mot de passe fuit. **À décider** : 3 ou 5 pour le
personnel (les parents resteraient à 3) ; dans les deux cas, ajouter le message ci-dessous.

- Le serveur marque `sessions.motif_revocation = 'session_max_atteint'` ; `/auth/refresh` doit renvoyer un code
  distinct (`SESSION_REVOQUEE`) et le client afficher « Vous avez été déconnecté : trop d'appareils connectés ».
- Proposer 5 sessions pour le personnel dans la politique par défaut (décision produit), 3 pour les parents.

### 4.5 — Mobile navigateur et E2E

- Vérifier `login.html`, `parent-login.html`, `changer-mot-de-passe.html`, `parent.html` en 375×667 (Playwright
  `viewport`), corriger les débordements.
- Ajouter dans `dashboard/tests/specs/` : (a) enseignant avec mot de passe provisoire → changement → espace ;
  (b) parent SMS → expiration → rafraîchissement silencieux ; (c) liens entre pages de connexion.

---

## Phase 5 — Validation hors du dépôt (à faire par une personne)

**Complexité : Faible · Prérequis : accès Africa's Talking préproduction, compte Expo**

- Envoi réel d'un SMS (OTP + mot de passe provisoire) vers un vrai numéro +221 / +225 ; vérifier le format E.164
  accepté par l'opérateur et le coût par message (2.2 envoie un SMS de plus par enseignant créé).
- Build EAS de test (`eas build --profile preview`) : écran `changer-mot-de-passe.tsx` sur un appareil réel ;
  connexion enseignant avec mot de passe provisoire hors ligne puis en ligne.
- CI : confirmer que `mobile-typecheck` et les tests SQL mobiles passent là où `better-sqlite3` est compilé (C10).
- Rejouer sur la base de production, en **simulation d'abord** : `npm run normaliser:telephones`,
  puis `npm run auditer:mots-de-passe` (2.1).

---

## Ordre d'exécution et dépendances

```
Phase 2.1 ─┐
Phase 2.2 ─┤ (indépendantes entre elles)
Phase 2.3 ─┴──► Phase 2.4 (optionnelle)
      │
      └──► Phase 3.1 ─► 3.2 ─► 3.3 ─► 3.4 ─► 3.5
Phase 4.1 … 4.5  (indépendante, peut être menée en parallèle)
Phase 5 (humaine) : après 2.2 et 3.4
```

Estimation totale : 9 à 14 jours de travail, dont 5 à 8 pour la phase 3.

## Questions ouvertes (décisions produit)

1. **Le cas « parent dans plusieurs écoles » est-il réel pour vos premiers établissements ?** S'il est rare, livrer
   3.1 à 3.3 (rend la situation possible) et reporter 3.4 (confort).
2. **Vue agrégée « tous mes enfants »** (toutes écoles) : utile pour un groupe scolaire ; elle impose soit l'option B
   (identité globale), soit une agrégation côté client avec une session par école. À trancher avant 3.4.
3. **Coût SMS** : le mot de passe provisoire par SMS (2.2) et la connexion par code des parents web et mobile
   augmentent le volume d'envois. Fixer un plafond mensuel ou un canal WhatsApp (déjà prévu dans le projet).
4. **Sessions** : 3 (actuel) ou 5 pour le personnel (4.4).
5. **Un même email pour deux écoles** (directeur de deux établissements) : autoriser ? (3.3, `setup.routes.js`).
