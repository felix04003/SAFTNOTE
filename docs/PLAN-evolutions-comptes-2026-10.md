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
| C1 | `utilisateurs.telephone` est `UNIQUE` pour toute la base : un parent (ou un enseignant vacataire) ne peut avoir de compte que dans **un** établissement | Fonctionnelle (bloquante pour le cas multi-écoles) | 3 |
| C2 | `otp_verifications` est indexé par téléphone seul ; `otp/demander` invalide **tous** les codes du numéro | À corriger avant C1 (sinon un code demandé pour l'école B annule celui de l'école A) | 3 |
| C3 | `est_compte_bloque()` (SQL) lit `MAX(blocage_nb_tentatives)` sur **toutes** les écoles : si une école assouplit sa politique, elle assouplit celle de toutes | Moyenne (aucune route n'écrit `politique_securite` aujourd'hui, donc latent) | 2 |
| C4 | Le mot de passe provisoire d'un enseignant est renvoyé en clair au directeur | Moyenne | 2 |
| C5 | Des mots de passe faibles antérieurs aux nouvelles règles existent encore (téléphone, `123456`…) | Moyenne | 2 |
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

Cas de l'enseignant vacataire (plusieurs écoles) : même mécanisme, mais **sans** bascule automatique de session —
un compte à mot de passe se reconnecte avec son mot de passe dans chaque école.

### 3.1 — Corriger les OTP avant d'ouvrir le multi-comptes (C2)

- `auth.routes.js`, `POST /auth/otp/demander` : n'invalider que les codes du même couple
  `(telephone, utilisateur_id)` ; `POST /auth/otp/valider` : incrémenter `nb_tentatives` et chercher le code sur ce
  même couple (aujourd'hui sur le téléphone seul).
- Test d'intégration : le même numéro a un compte dans A et dans B ; un code demandé pour A reste valable après une
  demande pour B ; chaque code n'ouvre que sa propre école (le contrôle de la phase 1 reste vert).

### 3.2 — Migration : unicité du téléphone par établissement (C1)

- `migrations/023_telephone_unique_par_etablissement.sql` : supprimer `utilisateurs_telephone_key`, créer
  `UNIQUE (etablissement_id, telephone)` ; conserver l'index de recherche par téléphone seul.
  Sans risque pour les données : toute paire respectant l'unicité globale respecte l'unicité par école.
- `error.middleware.js` : mettre à jour `MESSAGES_DOUBLON` (nouveau nom de contrainte) et le message
  (« …déjà utilisé dans cet établissement »).
- Critère d'acceptation : deux comptes de même numéro dans deux écoles s'insèrent ; deux comptes de même numéro dans
  la même école sont refusés.

### 3.3 — Revoir toutes les recherches par téléphone

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

### 4.1 — Corriger la barre latérale (C6)

- `dashboard/src/auth.ts`, `populateSidebar` : viser `sb-user-nom`, `sb-user-role`, `sb-user-avatar` (initiales),
  `sb-etab-nom` — les mêmes identifiants et le même rendu que `app.ts` (lignes 10-13) et `par-app.ts` (37-40).
  Ne pas toucher à ces deux derniers fichiers (ils fonctionnent).
- Test Vitest (jsdom) : un DOM minimal avec ces quatre identifiants reçoit le nom, le rôle, les initiales et
  l'établissement du profil stocké.

### 4.2 — Lier les deux connexions (C7)

- `login.html` : lien « Parent ? Connexion par code SMS → » vers `parent-login.html`.
- Test Playwright ou Vitest sur la présence et la cible du lien.

### 4.3 — Signaler l'absence de réseau (C8)

- Bandeau global « Pas de connexion — l'appel et les notes ne peuvent pas être enregistrés depuis le web.
  Utilisez l'application mobile (mode hors ligne). » basé sur `navigator.onLine` + événements `online`/`offline`,
  et désactivation des boutons d'enregistrement tant que hors ligne (`ens-appel.ts`, `ens-notes.ts`).
- Documenter la différence dans `docs/README.md` : web = en ligne, mobile = hors ligne + synchronisation.
- Hors périmètre : transformer le dashboard en PWA hors ligne (chantier à part, à chiffrer).

### 4.4 — Message clair quand une session est fermée par un autre appareil (C9)

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
