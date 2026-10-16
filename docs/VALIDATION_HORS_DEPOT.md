# EcoleManager — Validation hors dépôt avant la mise en production

> Ce que les tests automatiques ne peuvent pas prouver : ils tournent sans opérateur SMS, sans téléphone,
> sans Render, sans stockage S3 et sans les vraies données d'une école. Cette liste est à faire par une personne,
> **avant** d'ouvrir l'application à une première école, et à refaire après un changement d'hébergeur ou d'opérateur.
> Chaque point dit quoi faire, ce qu'on doit voir, et quoi consigner. Un point non vérifié reste « non vérifié » :
> ne le cochez pas par habitude.

Les repères marqués **[verify]** sont des faits que je n'ai pas pu confirmer depuis le dépôt (offres et règles de
fournisseurs, comportement d'un conteneur). Vérifiez-les à la source avant de vous y fier.

## Vue d'ensemble

| # | Vérification | Qui | Durée | Peut bloquer la mise en production |
|---|--------------|-----|-------|-------------------------------------|
| V1 | SMS réels (+221, +225…) | Quelqu'un avec un compte Africa's Talking et des téléphones locaux | 1 h | Oui : sans SMS, ni connexion parent ni mot de passe provisoire |
| V2 | Appli mobile sur un vrai téléphone, hors ligne | Quelqu'un avec un Android d'entrée de gamme | 2 h | Oui |
| V3 | Scripts de reprise de données en simulation | Quelqu'un qui a accès à la base de production | 30 min | Seulement si des données existent déjà |
| V4 | Déploiement Render depuis `render.yaml` | Titulaire du compte Render | 1 h | Oui |
| V5 | PDF de bulletins réels (Chromium, S3/R2, mémoire) | Idem | 1 h | Oui pour les bulletins |
| V6 | Connexion lente (2G/3G) | N'importe qui | 30 min | Non, mais fixe les attentes |
| V7 | Secrets, proxy, sauvegardes | Titulaire du compte | 1 h | Oui |
| V8 | Exports CSV ouverts dans Excel | Un secrétaire ou directeur | 15 min | Non |
| V9 | Répétition de la fin d'année sur une copie | Quelqu'un avec accès à la base | 1 h | Oui avant la première fin d'année |

Ordre conseillé : V4 → V7 → V1 → V5 → V2 → V9 → V8 → V6 → V3. V4 d'abord, car tout le reste suppose un déploiement qui tient.

---

## V1 — SMS réels

**Pourquoi.** Les tests simulent l'opérateur. Seul un envoi réel prouve que la clé, l'identifiant d'expéditeur, le
format E.164 et la longueur des messages fonctionnent dans chaque pays.

**Prérequis.** `AT_API_KEY` et `AT_USERNAME` renseignés sur le service API **et** sur le service `ecolemanager-workers`
(les SMS de notification partent du worker). Un téléphone par pays visé (+221 Sénégal, +225 Côte d'Ivoire, +223 Mali,
+226 Burkina Faso). L'enregistrement d'un identifiant d'expéditeur (Sender ID) est exigé par certains pays ou opérateurs
**[verify]** : à confirmer auprès d'Africa's Talking pour chaque pays.

**Étapes (pour chaque pays).**
1. Créer une école de test par `inscription.html`, puis ajouter un parent avec **votre** numéro (fiche élève > « + Ajouter »).
2. Ouvrir `parent-login.html`, saisir le numéro, demander le code : le SMS doit arriver. Noter le délai.
3. Créer un enseignant avec votre numéro, sans mot de passe : le mot de passe provisoire doit arriver par SMS
   (`sms_envoye: true` dans la réponse). Le renvoyer par « 🔑 MDP ».
4. Saisir une note, la publier : le parent reçoit un SMS (un seul par parent, même avec plusieurs enfants dans la classe).
5. Prononcer une sanction (page Discipline) : le parent reçoit un SMS.
6. Dashboard > Paramètres > plafond SMS (ou `GET /notifications/sms/consommation`) : la consommation a augmenté de
   1 segment par SMS de notification (pas par code de connexion ni par mot de passe provisoire : ils ne comptent pas).

**À voir.** Chaque message tient en 1 segment, sans caractère remplacé de façon illisible ; le numéro affiché dans le
tableau de bord est en `+221…`. **À consigner :** pays, opérateur du destinataire, délai, coût par segment facturé,
captures des messages.

**Si ça échoue.** Aucun SMS : voir les journaux du service worker (Render > ecolemanager-workers > Logs), qui doivent montrer le
traitement du job ; sans worker en marche rien ne part (CLAUDE.md, règle 17). SMS reçu seulement dans certains pays :
Sender ID ou liste blanche de l'opérateur.

## V2 — Appli mobile sur un vrai téléphone

**Pourquoi.** Les tests mobiles tournent sur Node (SQLite en mémoire). Ils ne disent rien de la lenteur sur un
téléphone modeste, du stockage, ni de ce que voit l'utilisateur.

**Prérequis.** Compte Expo. `cd mobile && eas build --platform android --profile preview` produit un APK interne
qui pointe sur `https://ecolemanager-api.onrender.com/api/v1` (voir `mobile/eas.json` : adapter l'URL si le service
porte un autre nom). Un Android d'entrée de gamme (≤ 2 Go de RAM) et une carte SIM avec peu de données.

**Parcours à jouer.**
1. Installer l'APK, se connecter en enseignant (changer le mot de passe provisoire si demandé).
2. **Mode avion.** Faire l'appel d'une classe, saisir des notes, redémarrer l'appli : les saisies sont toujours là, marquées « en attente ».
3. Réactiver le réseau : la synchronisation envoie tout (indicateur de synchro, puis plus aucune saisie en attente).
4. Vérifier côté dashboard que l'appel et les notes sont arrivés, une seule fois.
5. Se connecter en parent (code SMS) : enfants, notes publiées, absences, bulletins. Si le numéro est dans deux écoles : le sélecteur d'école apparaît.
6. Tuer l'appli pendant une synchronisation, puis la rouvrir : pas de doublon, pas de perte.
7. Après une fin d'année faite sur le serveur (V9), resynchroniser : la base locale est vidée puis retéléchargée, sauf s'il restait des saisies en attente (celles-ci sont conservées).

**À consigner.** Temps de la première synchronisation, taille téléchargée, ressenti sur l'appareil, tout écran blanc ou message incompréhensible. Les bulletins consultés sur mobile sont ceux de l'année courante ; l'historique des années clôturées n'est pour l'instant que dans `parent.html`.

## V3 — Scripts de reprise de données (en simulation)

**Pourquoi.** Ils corrigent des données existantes : on regarde ce qu'ils changeraient avant de les laisser écrire.

1. Faire une sauvegarde : `pg_dump "$DATABASE_URL" > sauvegarde-AAAA-MM-JJ.sql` puis vérifier que le fichier n'est pas vide.
2. Depuis le shell du service API : `cd backend && npm run normaliser:telephones` (simulation, n'écrit rien). Lire la liste : chaque ligne
   « avant → après » doit être un numéro réel mal formaté, jamais un numéro déjà correct ni deux comptes fusionnés.
3. `npm run auditer:mots-de-passe` (simulation) : la liste est celle des comptes à mot de passe prévisible, qui seront forcés au changement.
4. Seulement si les deux listes sont saines : relancer avec `-- --appliquer`, puis relire les listes (elles doivent être vides).

**À consigner.** Nombre de lignes de chaque liste, et la décision prise.

## V4 — Déploiement Render depuis `render.yaml`

1. Render > New > Blueprint > choisir le dépôt. La validation doit passer sans erreur (un champ non permis par le plan bloque
   la synchro de **tout** le Blueprint, y compris le site statique).
2. Cinq ressources : `ecolemanager-api` (web, plan gratuit), `ecolemanager-workers` (worker Docker, plan **payant**),
   `ecolemanager-redis` (key-value), `ecolemanager-dashboard` (site statique) et la base `ecolemanager-db`. Les offres et
   limites des plans gratuits (veille du service, durée de vie de la base gratuite) changent : **[verify]** sur la page
   des tarifs Render avant de s'y fier pour une école réelle.
3. Variables à renseigner à la main (marquées « sync: false » dans le fichier) : `AT_API_KEY`, `AT_USERNAME`, `META_WA_TOKEN`,
   `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `MEDICAL_ENCRYPTION_KEY`, `MONITORING_TOKEN`.
   `FRONTEND_URL` a une valeur dans le fichier (`https://ecolemanager-dashboard.onrender.com`) : la corriger si le site statique porte un autre nom.
   Sur le worker : les mêmes pour SMS et S3.
4. Premier déploiement : le journal de build doit se terminer par « migration(s) appliquée(s) avec succès » (la migration est dans le
   `buildCommand` : un échec fait échouer le build). `GET /api/v1/health` répond `{"status":"ok"}`.
5. Ouvrir le dashboard, créer une école, se connecter. Aucune erreur CORS dans la console (sinon `FRONTEND_URL` est faux).
6. `GET /health/deep` avec l'en-tête `Authorization: Bearer <MONITORING_TOKEN>` : base et Redis « ok ». Sans le jeton : 401 ; si `MONITORING_TOKEN` n'est pas défini : 403.

## V5 — PDF de bulletins réels

**Prérequis.** V4 et les variables `S3_*` sur l'API **et** le worker. Une classe d'au moins 40 élèves avec des notes.

1. Dashboard > Bulletins : « Générer tous » sur la classe, puis surveiller la mémoire du worker (Render > Metrics).
   Le plan `starter` offre 512 Mo : Chromium peut les dépasser. Si le job échoue ou si le service redémarre, passer le worker en `standard`
   (commentaire dans `render.yaml`).
2. Ouvrir trois PDF : accents, tableaux, nom de l'école, mention et rang corrects. Les polices viennent du paquet `font-noto` et `ttf-freefont` du Dockerfile.
3. Le lien de téléchargement est une URL signée fraîche : la copier, attendre son expiration, vérifier qu'elle ne marche plus.
4. Chemin de Chromium : le Dockerfile fixe `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` et installe le paquet Alpine
   `chromium`. Que ce chemin existe dans l'image n'a pas été vérifié ici **[verify]** :
   `docker run --rm <image> ls -l /usr/bin/chromium*`. S'il manque, corriger la variable avant tout autre test PDF.
5. Parent : le bulletin validé s'ouvre depuis `parent.html` et depuis le mobile.

## V6 — Connexion lente

Chrome > DevTools > Network > « Slow 3G » (puis hors ligne). Mesurer : connexion directeur, liste des élèves, ouverture d'une fiche,
synchronisation mobile. Consigner les temps. Repères à fixer avec l'école ; rien n'est garanti par les tests.

## V7 — Secrets, proxy, sauvegardes

1. `JWT_SECRET` d'au moins 32 caractères aléatoires ; `MEDICAL_ENCRYPTION_KEY` définie (sinon le démarrage avertit que les données médicales sont stockées en clair).
2. `TRUST_PROXY_HOPS=1` derrière Render : deux téléphones sur deux connexions différentes ne doivent pas se bloquer mutuellement
   au limiteur de débit (sinon toutes les requêtes semblent venir du proxy).
3. Se tromper 5 fois de mot de passe sur un compte de test : blocage de 15 minutes (défaut), déblocage visible dans Sécurité > Comptes bloqués.
4. **Sauvegarde et restauration** : prendre une sauvegarde de la base, la restaurer dans une base vide, démarrer l'API dessus, se connecter.
   Une sauvegarde jamais restaurée n'est qu'une hypothèse.

## V8 — Exports CSV dans Excel

Télécharger les quatre exports (Élèves, Moyennes d'une période, Absences, Discipline) et les ouvrir dans Excel en français, puis dans LibreOffice.
À voir : accents corrects, une colonne par champ, moyennes avec virgule, dates lisibles, numéros `+221…` conservés, aucune cellule
interprétée comme une formule (un nom commençant par `=` apparaît précédé d'une apostrophe).

## V9 — Répétition de la fin d'année

L'opération est irréversible. Ne jamais la jouer d'abord sur la production.

1. Restaurer une sauvegarde récente dans une base de répétition (voir V7.4) et y démarrer l'API.
2. Fin d'année > relire les propositions : les élèves sans moyenne ont-ils la décision attendue ? Le seuil de 10/20 convient-il à l'école ?
   La moyenne annuelle est la moyenne simple des moyennes de période, **sans pondération** : à valider avec le conseil de classe.
3. Confirmer avec « Reconduire les affectations » et « leur emploi du temps ». Contrôler : nombre de réinscrits, classes créées, redoublants à leur place,
   emploi du temps de deux classes, bulletins de l'année clôturée toujours consultables par un parent (sélecteur d'année).
4. Resynchroniser un téléphone (V2.7).
5. Seulement alors, planifier la vraie fin d'année, hors des heures de saisie.

---

## Feuille de résultats

| Vérif. | Date | Personne | Résultat (OK / réserve / échec) | Remarques, captures |
|--------|------|----------|----------------------------------|---------------------|
| V1 SMS +221 | | | | |
| V1 SMS +225 | | | | |
| V2 mobile | | | | |
| V3 scripts | | | | |
| V4 Render | | | | |
| V5 PDF | | | | |
| V6 réseau lent | | | | |
| V7 secrets et sauvegarde | | | | |
| V8 exports | | | | |
| V9 fin d'année | | | | |

**Mise en production refusée tant que** V1, V2, V4, V5 (si les bulletins papier sont remplacés), V7 et V9 ne sont pas à « OK ».
