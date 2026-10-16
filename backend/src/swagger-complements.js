'use strict';

// Routes documentées hors du fichier principal (swagger.js) : fin d'année, gestion du référentiel, parents d'un élève,
// exports CSV, authentification multi-écoles, appels, évaluations, etc. Fusionnées dans la spécification par swagger.js.
// tests/utils/swagger-couverture.test.js vérifie que chaque route Express figure dans la spécification.

const uuid = { type: 'string', format: 'uuid' };
const date = { type: 'string', format: 'date', example: '2026-10-01' };
const chemin = (nom, description) => ({ name: nom, in: 'path', required: true, schema: uuid, ...(description ? { description } : {}) });
const requete = (nom, schema, description) => ({ name: nom, in: 'query', schema, ...(description ? { description } : {}) });
const corps = (properties, required = [], description) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', ...(required.length ? { required } : {}), properties, ...(description ? { description } : {}) } } },
});
const csv = (description) => ({ 200: { description, content: { 'text/csv': { schema: { type: 'string' } } }, headers: { 'Content-Disposition': { schema: { type: 'string' } } } } });
const reponses = (ok, ...autres) => ({ ...ok, ...Object.assign({}, ...autres) });
const R = {
  401: { 401: { description: 'Session absente ou expirée' } },
  403: { 403: { description: 'Permission manquante' } },
  404: { 404: { description: 'Ressource introuvable (ou d\'un autre établissement)' } },
  409: { 409: { description: 'Conflit' } },
  422: { 422: { description: 'Données invalides' } },
};
const op = (tag, summary, extra = {}) => ({ tags: [tag], summary, ...extra });
const public_ = { security: [] };

const decisions = ['admis', 'redouble', 'diplome', 'transfere', 'abandonne', 'exclu'];
const typesSanction = ['avertissement_oral', 'avertissement_ecrit', 'retenue', 'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive'];

const paths = {
  // ═══ Authentification ═══
  '/auth/refresh': { post: op('Auth', 'Renouveler le jeton d\'accès', { ...public_,
    requestBody: corps({ refresh_token: { type: 'string' } }, ['refresh_token']),
    responses: reponses({ 200: { description: 'Nouveaux jetons' } }, R[401]) }) },
  '/auth/profil': { get: op('Auth', 'Profil de l\'utilisateur connecté', {
    description: 'Contient aussi `doit_changer_mdp` : tant qu\'il est vrai, seules les routes de changement de mot de passe, de profil et de déconnexion répondent (403 MDP_CHANGEMENT_REQUIS ailleurs).',
    responses: reponses({ 200: { description: 'Profil, rôles et permissions' } }, R[401]) }) },
  '/auth/mot-de-passe-oublie': { post: op('Auth', 'Demander un code de réinitialisation par SMS', { ...public_,
    requestBody: corps({ identifiant: { type: 'string', description: 'Email ou téléphone' }, etablissement_code: { type: 'string' } }, ['identifiant', 'etablissement_code']),
    responses: reponses({ 200: { description: 'Réponse identique que le compte existe ou non' } }, R[422]) }) },
  '/auth/reinitialiser-mot-de-passe': { post: op('Auth', 'Réinitialiser le mot de passe avec le code reçu', { ...public_,
    requestBody: corps({ identifiant: { type: 'string' }, etablissement_code: { type: 'string' }, code: { type: 'string', pattern: '^\\d{6}$' }, nouveau_mot_de_passe: { type: 'string' } }, ['identifiant', 'etablissement_code', 'code', 'nouveau_mot_de_passe']),
    description: 'Le nouveau mot de passe suit la politique unique (8 caractères minimum, minuscule, majuscule, chiffre, 72 octets maximum).',
    responses: reponses({ 200: { description: 'Mot de passe changé' } }, R[422]) }) },
  '/auth/otp/choisir': { post: op('Auth', 'Parent multi-écoles : choisir l\'école après le code SMS', { ...public_,
    description: 'Suite de `POST /auth/otp/valider` quand la réponse est `{ choix_requis, ticket, etablissements }` (ticket valable 5 minutes).',
    requestBody: corps({ ticket: { type: 'string' }, etablissement_code: { type: 'string' } }, ['ticket', 'etablissement_code']),
    responses: reponses({ 200: { description: 'Session ouverte dans l\'école choisie' } }, R[401]) }) },
  '/auth/mes-etablissements': { get: op('Auth', 'Écoles du parent connecté', {
    description: 'Alimente les sélecteurs d\'école du portail parent et du profil mobile.',
    responses: reponses({ 200: { description: 'Liste des établissements du même numéro' } }, R[401]) }) },
  '/auth/changer-etablissement': { post: op('Auth', 'Parent : basculer vers une autre école du même numéro', {
    description: 'Réservé aux comptes sans mot de passe (parents, authentifiés par SMS).',
    requestBody: corps({ etablissement_code: { type: 'string' } }, ['etablissement_code']),
    responses: reponses({ 200: { description: 'Nouvelle session' } }, R[403], R[404]) }) },
  '/inscription': { post: op('Identites', 'Créer un établissement et son directeur (parcours public)', { ...public_,
    description: 'Point d\'entrée unique de création d\'école (limité à 5 par heure et par adresse). Génère le code établissement, l\'année scolaire et les niveaux.',
    responses: reponses({ 201: { description: 'Établissement et directeur créés' } }, R[409], R[422]) }) },
  '/setup': { post: op('Identites', 'Amorçage interne d\'un établissement', { ...public_,
    description: 'Jamais appelé par l\'interface (bootstrap interne).', responses: reponses({ 201: { description: 'Créé' } }, R[422]) }) },
  '/setup/status': { get: op('Identites', 'L\'amorçage a-t-il eu lieu ?', { ...public_, responses: { 200: { description: 'État de l\'installation' } } }) },
  '/dashboard': { get: op('Identites', 'Indicateurs du tableau de bord de la direction', {
    description: 'Permission : rapports.voir', responses: reponses({ 200: { description: 'Effectifs, moyennes, absences, alertes' } }, R[403]) }) },
  '/notifications': { get: op('Securite', 'Alertes de l\'établissement (appels manqués, absences…)', {
    description: 'Calculées à la demande : il n\'existe pas d\'état « lu ».', responses: { 200: { description: 'Catégories d\'alertes et total' } } }) },

  // ═══ Données personnelles (RGPD) ═══
  '/utilisateurs/moi/donnees': { get: op('Auth', 'Exporter mes données personnelles', { responses: reponses({ 200: { description: 'Données de l\'utilisateur, jamais celles des autres' } }, R[401]) }) },
  '/utilisateurs/moi': { delete: op('Auth', 'Droit à l\'effacement : anonymiser mon compte', {
    description: 'Les élèves, notes et bulletins de l\'école sont conservés. Refusé (409 DERNIER_DIRECTEUR) pour le dernier directeur actif.',
    responses: reponses({ 200: { description: 'Compte anonymisé, sessions fermées' } }, R[409]) }) },
  '/utilisateurs/moi/consentements': { get: op('Auth', 'Mes consentements', { responses: { 200: { description: 'Consentements accordés ou retirés' } } }) },
  '/utilisateurs/moi/consentement': { post: op('Auth', 'Accorder ou retirer un consentement', {
    requestBody: corps({ type: { type: 'string', example: 'notifications_sms' }, accorde: { type: 'boolean' } }, ['type', 'accorde']),
    responses: reponses({ 200: { description: 'Enregistré' } }, R[422]) }) },

  // ═══ Référentiel : niveaux, classes, matières, affectations ═══
  '/niveaux': { get: op('Identites', 'Niveaux de l\'établissement', { description: 'Permission : eleves.voir', responses: { 200: { description: 'Niveaux par ordre croissant' } } }) },
  '/classes': { post: op('Identites', 'Créer une classe', {
    description: 'Permission : config.modifier. Le nom (« A », « B »…) est unique par niveau et par année, sans tenir compte de la casse.',
    requestBody: corps({ niveau_id: uuid, nom: { type: 'string', maxLength: 10 }, salle_principale: { type: 'string' }, effectif_max: { type: 'integer', minimum: 1, maximum: 200 } }, ['niveau_id', 'nom']),
    responses: reponses({ 201: { description: 'Classe créée' } }, R[409], R[422]) }) },
  '/classes/{classe_id}': {
    put: op('Identites', 'Corriger une classe (nom, salle, capacité)', {
      description: 'Permission : config.modifier. Le niveau ne change jamais. Rien n\'est supprimé en base.',
      parameters: [chemin('classe_id')],
      requestBody: corps({ nom: { type: 'string', maxLength: 10 }, salle_principale: { type: 'string', nullable: true }, effectif_max: { type: 'integer', nullable: true } }),
      responses: reponses({ 200: { description: 'Classe modifiée' } }, R[404], R[409], R[422]) }),
    delete: op('Identites', 'Archiver une classe', {
      description: 'Permission : config.modifier. Pose `actif = false`. Refusé (409) tant que des élèves y sont inscrits ou que des enseignants y sont affectés.',
      parameters: [chemin('classe_id')], responses: reponses({ 200: { description: 'Classe archivée' } }, R[404], R[409]) }),
  },
  '/classes/{classe_id}/affectations': { get: op('Identites', 'Matières et enseignants d\'une classe (année courante)', {
    parameters: [chemin('classe_id')], responses: { 200: { description: 'Affectations' } } }) },
  '/affectations': { post: op('Enseignants', 'Affecter un enseignant à une matière dans une classe', {
    description: 'Permission : config.modifier',
    requestBody: corps({ enseignant_id: uuid, classe_id: uuid, matiere_id: uuid, est_titulaire: { type: 'boolean', default: true } }, ['enseignant_id', 'classe_id', 'matiere_id']),
    responses: reponses({ 201: { description: 'Affectation créée' } }, R[409], R[422]) }) },
  '/affectations/{id}': { delete: op('Enseignants', 'Retirer une affectation', {
    description: 'Permission : config.modifier', parameters: [chemin('id')], responses: reponses({ 200: { description: 'Affectation retirée' } }, R[404], R[409]) }) },
  '/configs/coefficients': { post: op('Configs', 'Ajouter une configuration matière × niveau', {
    description: 'Permission : config.coefficients',
    requestBody: corps({ matiere_id: uuid, niveau_id: uuid, serie_id: { ...uuid, nullable: true }, coefficient: { type: 'number', minimum: 0.5, maximum: 10, default: 1 }, est_eliminatoire: { type: 'boolean' }, seuil_eliminatoire: { type: 'number', nullable: true } }, ['matiere_id', 'niveau_id']),
    responses: reponses({ 201: { description: 'Configuration créée' } }, R[409], R[422]) }) },
  '/configs/matieres/{id}': {
    put: op('Configs', 'Corriger une matière', {
      description: 'Permission : config.modifier. `actif: false` l\'archive (refusé tant qu\'un enseignant y est affecté cette année).',
      parameters: [chemin('id')],
      requestBody: corps({ nom: { type: 'string' }, nom_court: { type: 'string', nullable: true }, code: { type: 'string' }, discipline_id: { ...uuid, nullable: true }, compte_dans_moyenne: { type: 'boolean' }, est_eliminatoire: { type: 'boolean' }, seuil_eliminatoire: { type: 'number', nullable: true }, est_optionnelle: { type: 'boolean' }, actif: { type: 'boolean' } }),
      responses: reponses({ 200: { description: 'Matière modifiée' } }, R[404], R[409], R[422]) }),
    delete: op('Configs', 'Archiver une matière', {
      description: 'Permission : config.modifier. Rien n\'est supprimé : les notes et bulletins la référencent.',
      parameters: [chemin('id')], responses: reponses({ 200: { description: 'Matière archivée' } }, R[404], R[409]) }),
  },

  // ═══ Plages horaires ═══
  '/plages-horaires': {
    get: op('EDT', 'Plages horaires de l\'établissement', { description: 'Permission : edt.voir', responses: { 200: { description: 'Plages par numéro' } } }),
    post: op('EDT', 'Créer une plage horaire', {
      description: 'Permission : config.modifier',
      requestBody: corps({ numero: { type: 'integer' }, libelle: { type: 'string' }, heure_debut: { type: 'string', example: '07:30' }, heure_fin: { type: 'string', example: '08:25' } }, ['numero', 'libelle', 'heure_debut', 'heure_fin']),
      responses: reponses({ 201: { description: 'Plage créée' } }, R[409], R[422]) }),
  },
  '/plages-horaires/{id}': {
    put: op('EDT', 'Modifier une plage horaire', { description: 'Permission : config.modifier', parameters: [chemin('id')],
      requestBody: corps({ numero: { type: 'integer' }, libelle: { type: 'string' }, heure_debut: { type: 'string' }, heure_fin: { type: 'string' } }, ['numero', 'libelle', 'heure_debut', 'heure_fin']),
      responses: reponses({ 200: { description: 'Plage modifiée' } }, R[404], R[409], R[422]) }),
    delete: op('EDT', 'Supprimer une plage horaire', { description: 'Permission : config.modifier. Refusé (409) tant que des créneaux l\'utilisent.', parameters: [chemin('id')],
      responses: reponses({ 200: { description: 'Plage supprimée' } }, R[404], R[409]) }),
  },
  '/enseignants/moi/affectations': { get: op('Enseignants', 'Mes affectations (année courante)', { responses: { 200: { description: 'Classes et matières de l\'enseignant connecté' } } }) },
  '/enseignants/moi/edt/{creneau_id}/salle': { put: op('Enseignants', 'Changer la salle d\'un de mes créneaux', {
    description: 'Permission : edt.modifier_ponctuel', parameters: [chemin('creneau_id')],
    requestBody: corps({ salle: { type: 'string', maxLength: 50, nullable: true } }), responses: reponses({ 200: { description: 'Salle modifiée' } }, R[404]) }) },
  '/enseignants': {
    get: op('Enseignants', 'Liste des enseignants', { description: 'Permission : config.voir', responses: { 200: { description: 'Enseignants de l\'établissement' } } }),
    post: op('Enseignants', 'Créer un enseignant', {
      description: 'Permission : config.modifier. Sans mot de passe fourni, un mot de passe provisoire aléatoire est généré et envoyé par SMS (`sms_envoye: false` et mot de passe dans la réponse si le SMS n\'a pas pu partir). Le compte a `mdp_a_changer`.',
      requestBody: corps({ nom: { type: 'string' }, prenom: { type: 'string' }, telephone: { type: 'string' }, email: { type: 'string', format: 'email' }, genre: { type: 'string', enum: ['M', 'F'] }, specialite: { type: 'string' }, type_contrat: { type: 'string', enum: ['titulaire', 'vacataire', 'contractuel', 'benevole'] } }, ['nom', 'prenom', 'telephone']),
      responses: reponses({ 201: { description: 'Enseignant créé' } }, R[422]) }),
  },
  '/enseignants/{id}/mot-de-passe-provisoire': { post: op('Enseignants', 'Renvoyer un mot de passe provisoire par SMS', {
    description: 'Permission : config.modifier', parameters: [chemin('id')], responses: reponses({ 200: { description: 'Nouveau mot de passe provisoire envoyé' } }, R[404]) }) },

  // ═══ Élèves ═══
  '/eleves/{eleve_id}': { put: op('Eleves', 'Corriger la fiche d\'un élève', {
    description: 'Permission : eleves.modifier (identité, téléphone, matricule, classe de l\'année courante). Les données médicales exigent en plus eleves.medicale. Le journal d\'audit garde les noms des champs, jamais les valeurs.',
    parameters: [chemin('eleve_id', 'Identifiant utilisateur de l\'élève')],
    requestBody: corps({
      nom: { type: 'string' }, prenom: { type: 'string' }, date_naissance: { ...date, nullable: true }, genre: { type: 'string', enum: ['M', 'F'], nullable: true },
      telephone: { type: 'string', nullable: true }, adresse: { type: 'string', nullable: true }, matricule: { type: 'string' }, redoublant: { type: 'boolean' }, classe_id: uuid,
      allergies: { type: 'string', nullable: true }, conditions_medicales: { type: 'string', nullable: true }, groupe_sanguin: { type: 'string', nullable: true }, medecin_urgence: { type: 'string', nullable: true },
    }),
    responses: reponses({ 200: { description: 'Fiche modifiée' } }, R[403], R[404], R[409], R[422]) }) },
  '/eleves/{eleve_id}/statut': { put: op('Eleves', 'Retirer ou réintégrer un élève', {
    description: 'Permission : eleves.archiver. `transfere`, `abandonne` et `exclu` exigent un motif ; `actif` réintègre. `GET /eleves?statut=retires` liste les élèves retirés.',
    parameters: [chemin('eleve_id')],
    requestBody: corps({ statut: { type: 'string', enum: ['actif', 'transfere', 'abandonne', 'exclu'] }, motif: { type: 'string', minLength: 3, maxLength: 200 } }, ['statut']),
    responses: reponses({ 200: { description: 'Statut modifié' } }, R[404], R[422]) }) },
  '/eleves/{eleve_id}/notes': { get: op('Eleves', 'Notes d\'un élève', {
    description: 'Permission : notes.voir_eleve (staff) ou lien parent/élève.', parameters: [chemin('eleve_id')], responses: reponses({ 200: { description: 'Notes publiées' } }, R[403]) }) },
  '/eleves/{eleve_id}/parents': { post: op('Eleves', 'Rattacher un parent ou tuteur à un élève', {
    description: 'Permission : parents.modifier. Un numéro déjà connu de l\'établissement est RÉUTILISÉ (jamais un second compte) : les nom et prénom saisis sont alors ignorés et la réponse dit à qui appartient le compte. Le premier parent d\'un élève est contact principal d\'office.',
    parameters: [chemin('eleve_id')],
    requestBody: corps({ nom: { type: 'string' }, prenom: { type: 'string' }, telephone: { type: 'string' }, lien: { type: 'string', enum: ['pere', 'mere', 'tuteur', 'autre'], default: 'tuteur' }, est_contact_principal: { type: 'boolean' } }, ['nom', 'prenom', 'telephone']),
    responses: reponses({ 201: { description: 'Parent rattaché' } }, R[404], R[409], R[422]) }) },
  '/eleves/{eleve_id}/parents/{parent_id}': {
    put: op('Eleves', 'Corriger le lien, les droits ou l\'identité d\'un parent', {
      description: 'Permission : parents.modifier. Les droits `peut_voir_*` sont PAR enfant ; le nom et le numéro sont ceux du COMPTE (ils changent pour tous les enfants du parent) et sont refusés (409 COMPTE_PERSONNEL) si le compte a un autre rôle que parent. Un seul contact principal par élève.',
      parameters: [chemin('eleve_id'), chemin('parent_id')],
      requestBody: corps({ lien: { type: 'string' }, est_contact_principal: { type: 'boolean' }, peut_voir_notes: { type: 'boolean' }, peut_voir_absences: { type: 'boolean' }, peut_voir_bulletins: { type: 'boolean' }, peut_voir_discipline: { type: 'boolean' }, nom: { type: 'string' }, prenom: { type: 'string' }, telephone: { type: 'string' } }),
      responses: reponses({ 200: { description: 'Parent modifié' } }, R[404], R[409], R[422]) }),
    delete: op('Eleves', 'Détacher un parent d\'un élève', {
      description: 'Permission : parents.modifier. Le compte reste ; le plus ancien parent restant devient contact principal ; l\'accès du parent à l\'enfant est coupé aussitôt.',
      parameters: [chemin('eleve_id'), chemin('parent_id')], responses: reponses({ 200: { description: 'Parent détaché' } }, R[404]) }),
  },

  // ═══ Fin d'année ═══
  '/annees-scolaires/passage/apercu': { get: op('Identites', 'Fin d\'année : propositions par élève', {
    description: 'Permission : config.annee_scolaire. Pour chaque inscrit, une proposition : décision du conseil de classe, sinon moyenne annuelle (moyenne simple des moyennes de période) contre le seuil, sinon diplôme au dernier niveau. Propose aussi les dates de l\'année suivante.',
    parameters: [requete('seuil', { type: 'number', minimum: 0, maximum: 20, default: 10 }, 'Moyenne annuelle minimale pour passer')],
    responses: reponses({ 200: { description: 'Année, proposition de nouvelle année, classes avec leurs élèves et classes d\'accueil possibles' } }, R[403], R[409]) }) },
  '/annees-scolaires/passage': { post: op('Identites', 'Fin d\'année : clôturer l\'année et réinscrire les élèves', {
    description: 'Permission : config.annee_scolaire. Une seule transaction (tout ou rien) avec verrou sur l\'année courante : clôture (`cloturee_at`), nouvelle année et périodes, reconduction des classes (salle et capacité) plus les classes d\'accueil manquantes, une NOUVELLE inscription par élève admis ou redoublant, `decision_fin_annee` sur l\'ancienne. Une décision est exigée pour CHAQUE inscrit (5000 au plus). Notes, moyennes et bulletins restent rattachés à l\'année clôturée. Remplace `POST /annees-scolaires` tant que des élèves sont inscrits (409 PASSAGE_REQUIS).',
    requestBody: corps({
      libelle: { type: 'string', example: '2026-2027' }, date_debut: date, date_fin: date,
      nb_periodes: { type: 'integer', enum: [2, 3] },
      periodes: { type: 'array', items: { type: 'object', properties: { numero: { type: 'integer' }, libelle: { type: 'string' }, date_debut: date, date_fin: date } } },
      copier_affectations: { type: 'boolean', default: false, description: 'Reconduit les affectations (mêmes enseignant, matière et classe)' },
      copier_edt: { type: 'boolean', default: false, description: 'Reconduit aussi l\'emploi du temps de la semaine ; exige copier_affectations (422 sinon). Les créneaux déjà terminés ne sont pas reconduits.' },
      decisions: { type: 'array', items: { type: 'object', required: ['inscription_id', 'decision'], properties: {
        inscription_id: uuid, decision: { type: 'string', enum: decisions },
        classe_cible: { type: 'object', properties: { niveau_id: uuid, nom: { type: 'string' } }, description: 'Classe d\'accueil choisie (admis ou redoublant)' } } } },
    }, ['libelle', 'date_debut', 'date_fin', 'decisions']),
    responses: reponses({ 201: { description: 'Compte rendu : annee_id, libelle, ancienne_annee, classes_creees, reinscrits, admis, redoublants, diplomes, transferts, abandons, exclus, affectations_copiees, creneaux_copies' } }, R[403], R[409], R[422]) }) },

  // ═══ Parents : bulletins par année ═══
  // (le chemin /parents/moi/enfants/{id}/bulletins existe dans swagger.js ; son paramètre annee_id est ajouté dans swagger.js)

  // ═══ Sécurité ═══
  '/securite/directeurs': { post: op('Securite', 'Nommer un second directeur', {
    description: 'Réservé à un directeur en exercice (pas à tout porteur de admin.utilisateurs). Mot de passe provisoire aléatoire envoyé par SMS, `mdp_a_changer`, mêmes contrôles de doublons que les enseignants, entrée d\'audit `utilisateurs.creer_directeur`. Limité en fréquence.',
    requestBody: corps({ nom: { type: 'string' }, prenom: { type: 'string' }, telephone: { type: 'string' }, email: { type: 'string', format: 'email' } }, ['nom', 'prenom', 'telephone']),
    responses: reponses({ 201: { description: 'Directeur créé' } }, R[403], R[409], R[422]) }) },
  '/securite/comptes-bloques': { get: op('Securite', 'Comptes bloqués par la politique de connexion', {
    description: 'Permission : admin.audit', responses: reponses({ 200: { description: 'Comptes et adresses bloqués' } }, R[403]) }) },
  '/securite/politique': {
    get: op('Securite', 'Politique de sécurité de l\'établissement', { description: 'Permission : config.voir', responses: { 200: { description: 'Politique (créée automatiquement avec l\'établissement)' } } }),
    put: op('Securite', 'Modifier la politique de sécurité', {
      description: 'Permission : config.modifier. La longueur du mot de passe ne peut que durcir la règle commune. Modification journalisée (avant/après).',
      requestBody: corps({ mdp_longueur_min: { type: 'integer', minimum: 8, maximum: 32 }, blocage_nb_tentatives: { type: 'integer', minimum: 3, maximum: 10 }, blocage_duree_minutes: { type: 'integer', minimum: 5, maximum: 120 }, session_max_simultanees: { type: 'integer', minimum: 1, maximum: 5 } }, ['mdp_longueur_min', 'blocage_nb_tentatives', 'blocage_duree_minutes', 'session_max_simultanees']),
      responses: reponses({ 200: { description: 'Politique modifiée' } }, R[403], R[422]) }),
  },

  // ═══ Discipline ═══
  '/discipline/eleves/{id}/dossier': { get: op('Discipline', 'Dossier disciplinaire d\'un élève', {
    description: 'Permission : discipline.voir', parameters: [chemin('id', 'Identifiant utilisateur de l\'élève')], responses: reponses({ 200: { description: 'Incidents et sanctions' } }, R[404]) }) },

  // ═══ Évaluations et notes ═══
  '/evaluations': {
    get: op('Moyennes', 'Évaluations', { description: 'Permission : notes.voir_classe', responses: { 200: { description: 'Évaluations de l\'année courante' } } }),
    post: op('Moyennes', 'Créer une évaluation', {
      description: 'Permission : evaluations.creer',
      requestBody: corps({ affectation_id: uuid, periode_id: uuid, type: { type: 'string', enum: ['devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet'] }, numero: { type: 'integer', minimum: 1, maximum: 5 }, titre: { type: 'string' }, note_max: { type: 'number', minimum: 0, maximum: 20, default: 20 }, date_evaluation: date }, ['affectation_id', 'periode_id', 'type', 'numero']),
      responses: reponses({ 201: { description: 'Évaluation créée' } }, R[404], R[409], R[422]) }),
  },
  '/evaluations/{evaluation_id}/notes': {
    get: op('Moyennes', 'Notes d\'une évaluation', { description: 'Permission : notes.voir_classe', parameters: [chemin('evaluation_id')], responses: reponses({ 200: { description: 'Notes de la classe' } }, R[404]) }),
    post: op('Moyennes', 'Saisir les notes', { description: 'Permission : notes.saisir', parameters: [chemin('evaluation_id')],
      requestBody: corps({ notes: { type: 'array', items: { type: 'object', required: ['eleve_id'], properties: { eleve_id: uuid, note: { type: 'number', minimum: 0, maximum: 20, nullable: true } } } } }, ['notes']),
      responses: reponses({ 200: { description: 'Notes enregistrées' } }, R[404], R[422]) }),
    put: op('Moyennes', 'Corriger les notes (absences comprises)', { description: 'Permission : notes.saisir', parameters: [chemin('evaluation_id')],
      requestBody: corps({ notes: { type: 'array', items: { type: 'object', required: ['eleve_id', 'inscription_id'], properties: { eleve_id: uuid, inscription_id: uuid, valeur: { type: 'number', minimum: 0, maximum: 20, nullable: true }, est_absent: { type: 'boolean' }, absence_justifiee: { type: 'boolean' }, appreciation: { type: 'string' } } } } }, ['notes']),
      responses: reponses({ 200: { description: 'Notes corrigées' } }, R[404], R[422]) }),
  },
  '/evaluations/{evaluation_id}/publier': { put: op('Moyennes', 'Publier une évaluation', {
    description: 'Permission : notes.publier. Un SMS par parent est mis en file (plafond mensuel de l\'établissement) et le calcul des moyennes est lancé.',
    parameters: [chemin('evaluation_id')], responses: reponses({ 200: { description: 'Évaluation publiée' } }, R[404], R[409]) }) },
  '/bulletins/classes': { get: op('Bulletins', 'Avancement des bulletins par classe', {
    description: 'Permission : bulletins.voir', parameters: [requete('periode_id', uuid)], responses: { 200: { description: 'Générés et validés par classe' } } }) },
  '/bulletins/jobs/{jobId}': { get: op('Bulletins', 'État d\'une génération de PDF', {
    description: 'Permission : bulletins.voir', parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string' } }], responses: reponses({ 200: { description: 'État du job' } }, R[404]) }) },

  // ═══ Vie scolaire ═══
  '/appels/cours': { get: op('Discipline', 'Cours du jour à appeler', { description: 'Permission : absences.faire_appel', responses: { 200: { description: 'Créneaux de l\'enseignant pour la date' } } }) },
  '/appels': { post: op('Discipline', 'Ouvrir l\'appel d\'une séance', {
    description: 'Permission : absences.faire_appel. Réponse envoyée APRÈS validation de la transaction.',
    requestBody: corps({ emploi_du_temps_id: uuid, date_cours: date }, ['emploi_du_temps_id', 'date_cours']),
    responses: reponses({ 201: { description: 'Appel ouvert avec une présence par élève' } }, R[404], R[409], R[422]) }) },
  '/appels/{appel_id}/presences': { put: op('Discipline', 'Saisir les présences d\'un appel', {
    description: 'Permission : absences.faire_appel', parameters: [chemin('appel_id')],
    requestBody: corps({
      presences: { type: 'array', items: { type: 'object', required: ['inscription_id', 'statut'], properties: { inscription_id: uuid, statut: { type: 'string', enum: ['present', 'absent', 'retard', 'sorti_avant', 'dispense'] }, minutes_retard: { type: 'integer', minimum: 1, maximum: 120 }, est_justifie: { type: 'boolean' }, justification: { type: 'string' } } } },
      cloturer: { type: 'boolean', default: true },
    }, ['presences']),
    responses: reponses({ 200: { description: 'Présences enregistrées' } }, R[404], R[422]) }) },
  '/presences/absences': { get: op('Discipline', 'Absences et retards de l\'année courante', {
    description: 'Permission : absences.voir_classe', parameters: [requete('classe_id', uuid), requete('limite', { type: 'integer', default: 50 }), requete('page', { type: 'integer', default: 1 })],
    responses: { 200: { description: 'Absences et retards, plus récents d\'abord' } } }) },
  '/presences/{presence_id}/justifier': { put: op('Discipline', 'Justifier une absence', {
    description: 'Permission : absences.justifier', parameters: [chemin('presence_id')],
    requestBody: corps({ justification: { type: 'string', minLength: 3 }, document_url: { type: 'string', format: 'uri' } }, ['justification']),
    responses: reponses({ 200: { description: 'Absence justifiée' } }, R[404], R[422]) }) },

  // ═══ Exports CSV ═══
  '/exports/eleves.csv': { get: op('Exports', 'Exporter la liste des élèves (CSV)', {
    description: 'Permissions : rapports.exporter et eleves.voir. CSV pour Excel français (séparateur « ; », BOM UTF-8, décimales à virgule, cellules commençant par = + - @ neutralisées). Sans données médicales. Chaque export est inscrit au journal d\'audit (nombre de lignes, jamais le contenu).',
    parameters: [requete('statut', { type: 'string', enum: ['actif', 'retires', 'tous'], default: 'actif' }), requete('classe_id', uuid)],
    responses: reponses(csv('Fichier eleves-AAAA-AAAA.csv'), R[401], R[403], R[422]) }) },
  '/exports/moyennes.csv': { get: op('Exports', 'Exporter les moyennes d\'une période (CSV)', {
    description: 'Permissions : rapports.exporter et notes.voir_classe',
    parameters: [{ ...requete('periode_id', uuid), required: true }, requete('classe_id', uuid)],
    responses: reponses(csv('Fichier moyennes-<période>-AAAA-AAAA.csv'), R[403], R[404], R[422]) }) },
  '/exports/absences.csv': { get: op('Exports', 'Exporter les absences et retards (CSV)', {
    description: 'Permissions : rapports.exporter et absences.voir_classe. Année courante.',
    parameters: [requete('du', date), requete('au', date), requete('classe_id', uuid)],
    responses: reponses(csv('Fichier absences-AAAA-AAAA.csv'), R[403], R[422]) }) },
  '/exports/sanctions.csv': { get: op('Exports', 'Exporter les sanctions (CSV)', {
    description: 'Permissions : rapports.exporter et discipline.voir. Année courante.',
    parameters: [requete('type', { type: 'string', enum: typesSanction }), requete('classe_id', uuid)],
    responses: reponses(csv('Fichier sanctions-AAAA-AAAA.csv'), R[403], R[422]) }) },
};

const tags = [
  { name: 'Exports', description: 'Exports CSV pour la direction (Excel)' },
  { name: 'Systeme', description: 'Santé et supervision' },
];

/** Fusionne les compléments dans une spécification OpenAPI sans écraser les opérations déjà décrites */
function fusionner(spec) {
  for (const [chemin_, operations] of Object.entries(paths)) {
    spec.paths[chemin_] = { ...operations, ...(spec.paths[chemin_] || {}) };
  }
  const connus = new Set((spec.tags || []).map((t) => t.name));
  spec.tags = [...(spec.tags || []), ...tags.filter((t) => !connus.has(t.name))];
  return spec;
}

module.exports = { paths, fusionner };
