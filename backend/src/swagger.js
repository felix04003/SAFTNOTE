'use strict';

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'EcoleManager API',
      version: '1.0.0',
      description:
        'API de gestion scolaire offline-first pour les etablissements d\'Afrique de l\'Ouest francophone (Senegal, Cote d\'Ivoire, Mali, Burkina Faso).',
      contact: { name: 'EcoleManager', email: 'contact@ecolemanager.com' },
      license: { name: 'Proprietary' },
    },
    servers: [
      { url: '/api/v1', description: 'API v1' },
    ],
    tags: [
      { name: 'Auth',         description: 'Authentification (mot de passe + OTP SMS)' },
      { name: 'Identites',    description: 'Etablissement, annees scolaires, classes' },
      { name: 'Eleves',       description: 'Gestion des eleves et inscriptions' },
      { name: 'Enseignants',  description: 'Profils enseignants, classes, EDT' },
      { name: 'Parents',      description: 'Portail parents : enfants, notes, absences, bulletins' },
      { name: 'Moyennes',     description: 'Calcul et consultation des moyennes' },
      { name: 'Bulletins',    description: 'Generation, validation et telechargement des bulletins' },
      { name: 'Configs',      description: 'Coefficients et matieres de l\'etablissement' },
      { name: 'EDT',          description: 'Emploi du temps (classes et enseignants)' },
      { name: 'Discipline',   description: 'Sanctions et dossier disciplinaire' },
      { name: 'Evenements',   description: 'Agenda : sorties, reunions, conges, examens' },
      { name: 'Securite',     description: 'Audit, sessions, blocage de comptes' },
      { name: 'Sync',         description: 'Synchronisation offline mobile <-> serveur' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Token JWT obtenu via POST /auth/connexion ou /auth/otp/valider',
        },
      },
      schemas: {
        // ── Reponses generiques ──
        SuccessResponse: {
          type: 'object',
          properties: {
            succes: { type: 'boolean', example: true },
            data:   { type: 'object' },
          },
        },
        PaginatedResponse: {
          type: 'object',
          properties: {
            succes: { type: 'boolean', example: true },
            data:   { type: 'array', items: { type: 'object' } },
            meta: {
              type: 'object',
              properties: {
                total:  { type: 'integer', example: 42 },
                page:   { type: 'integer', example: 1 },
                limite: { type: 'integer', example: 20 },
                pages:  { type: 'integer', example: 3 },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            succes:  { type: 'boolean', example: false },
            erreur:  { type: 'string', example: 'Ressource introuvable' },
            code:    { type: 'string', example: 'RESSOURCE_INTROUVABLE' },
            details: { type: 'object' },
          },
        },
        // ── Modeles metier ──
        Etablissement: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            nom:            { type: 'string', example: 'Lycee Blaise Diagne' },
            code_officiel:  { type: 'string', example: 'LBD-DKR' },
            telephone:      { type: 'string', example: '+221338001234' },
            email:          { type: 'string', format: 'email' },
            ville:          { type: 'string', example: 'Dakar' },
            pays:           { type: 'string', example: 'Senegal' },
            logo_url:       { type: 'string', format: 'uri' },
            actif:          { type: 'boolean' },
            created_at:     { type: 'string', format: 'date-time' },
          },
        },
        AnneeScolaire: {
          type: 'object',
          properties: {
            id:           { type: 'string', format: 'uuid' },
            libelle:      { type: 'string', example: '2025-2026' },
            date_debut:   { type: 'string', format: 'date', example: '2025-10-01' },
            date_fin:     { type: 'string', format: 'date', example: '2026-07-15' },
            nb_periodes:  { type: 'integer', example: 3 },
            est_courante: { type: 'boolean' },
          },
        },
        Utilisateur: {
          type: 'object',
          properties: {
            id:     { type: 'string', format: 'uuid' },
            nom:    { type: 'string', example: 'Diallo' },
            prenom: { type: 'string', example: 'Moussa' },
            email:  { type: 'string', format: 'email' },
            telephone: { type: 'string', example: '+221771234567' },
          },
        },
        Eleve: {
          type: 'object',
          properties: {
            id:              { type: 'string', format: 'uuid' },
            nom:             { type: 'string' },
            prenom:          { type: 'string' },
            matricule:       { type: 'string', example: 'E254321' },
            date_naissance:  { type: 'string', format: 'date' },
            genre:           { type: 'string', enum: ['M', 'F'] },
            classe:          { type: 'string', example: '6eme A' },
            inscription_id:  { type: 'string', format: 'uuid' },
          },
        },
        Sanction: {
          type: 'object',
          properties: {
            id:             { type: 'string', format: 'uuid' },
            type:           { type: 'string', enum: ['avertissement_oral', 'avertissement_ecrit', 'retenue', 'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive'] },
            motif:          { type: 'string' },
            date_prononcee: { type: 'string', format: 'date' },
          },
        },
        Evenement: {
          type: 'object',
          properties: {
            id:         { type: 'string', format: 'uuid' },
            titre:      { type: 'string' },
            type:       { type: 'string', enum: ['sortie_scolaire', 'reunion_parents', 'examen_officiel', 'conseil_classe', 'conseil_discipline', 'journee_sportive', 'journee_portes_ouvertes', 'conge', 'formation_enseignants', 'autre'] },
            date_debut: { type: 'string', format: 'date' },
            date_fin:   { type: 'string', format: 'date' },
          },
        },
      },
      parameters: {
        PageParam: {
          name: 'page', in: 'query', schema: { type: 'integer', default: 1 },
          description: 'Numero de page',
        },
        LimiteParam: {
          name: 'limite', in: 'query', schema: { type: 'integer', default: 20 },
          description: 'Nombre d\'elements par page',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      // ════════════════════════════════════════════════
      // AUTH
      // ════════════════════════════════════════════════
      '/auth/connexion': {
        post: {
          tags: ['Auth'],
          summary: 'Connexion par mot de passe',
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['identifiant', 'mot_de_passe', 'etablissement_code'],
            properties: {
              identifiant:        { type: 'string', minLength: 3, description: 'Email ou telephone' },
              mot_de_passe:       { type: 'string', minLength: 6 },
              etablissement_code: { type: 'string', minLength: 2 },
            },
          }}}},
          responses: {
            200: { description: 'Connexion reussie — retourne le token JWT et l\'utilisateur' },
            401: { description: 'Identifiants incorrects' },
            429: { description: 'Rate limit depasse (10 tentatives / 15 min)' },
          },
        },
      },
      '/auth/otp/demander': {
        post: {
          tags: ['Auth'],
          summary: 'Demander un code OTP par SMS (parents)',
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['telephone', 'etablissement_code'],
            properties: {
              telephone:          { type: 'string', pattern: '^\\+?[0-9]{8,15}$' },
              etablissement_code: { type: 'string', minLength: 2 },
            },
          }}}},
          responses: {
            200: { description: 'Code envoye par SMS (reponse identique si le numero existe ou non — anti-enumeration)' },
            429: { description: 'Rate limit depasse' },
          },
        },
      },
      '/auth/otp/valider': {
        post: {
          tags: ['Auth'],
          summary: 'Valider un code OTP et creer une session',
          security: [],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['telephone', 'code', 'etablissement_code'],
            properties: {
              telephone:          { type: 'string', pattern: '^\\+?[0-9]{8,15}$' },
              code:               { type: 'string', pattern: '^\\d{6}$', minLength: 6, maxLength: 6 },
              etablissement_code: { type: 'string', minLength: 2 },
            },
          }}}},
          responses: {
            200: { description: 'OTP valide — retourne le token JWT' },
            401: { description: 'Code invalide, expire ou trop de tentatives' },
          },
        },
      },
      '/auth/deconnexion': {
        post: {
          tags: ['Auth'], summary: 'Deconnexion (revoque la session courante)',
          responses: { 200: { description: 'Deconnecte avec succes' } },
        },
      },
      '/auth/sessions': {
        get: {
          tags: ['Auth'], summary: 'Sessions actives de l\'utilisateur connecte',
          responses: { 200: { description: 'Liste des sessions actives' } },
        },
      },
      '/auth/sessions/{id}': {
        delete: {
          tags: ['Auth'], summary: 'Revoquer une de ses sessions',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Session revoquee' }, 404: { description: 'Session introuvable' } },
        },
      },

      // ════════════════════════════════════════════════
      // IDENTITES
      // ════════════════════════════════════════════════
      '/etablissement': {
        get: {
          tags: ['Identites'], summary: 'Infos de l\'etablissement',
          description: 'Permission requise : config.voir',
          responses: { 200: { description: 'Etablissement', content: { 'application/json': { schema: { $ref: '#/components/schemas/Etablissement' } } } } },
        },
        put: {
          tags: ['Identites'], summary: 'Modifier l\'etablissement',
          description: 'Permission requise : config.modifier',
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              nom:       { type: 'string', minLength: 2 },
              telephone: { type: 'string' },
              email:     { type: 'string', format: 'email' },
              ville:     { type: 'string' },
              logo_url:  { type: 'string', format: 'uri' },
            },
          }}}},
          responses: { 200: { description: 'Etablissement mis a jour' } },
        },
      },
      '/annees-scolaires': {
        get: {
          tags: ['Identites'], summary: 'Liste des annees scolaires',
          responses: { 200: { description: 'Liste des annees scolaires' } },
        },
        post: {
          tags: ['Identites'], summary: 'Creer une nouvelle annee scolaire',
          description: 'L\'annee courante precedente est automatiquement desactivee. Permission : config.annee_scolaire',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['libelle', 'date_debut', 'date_fin'],
            properties: {
              libelle:     { type: 'string', pattern: '^\\d{4}-\\d{4}$', example: '2025-2026' },
              date_debut:  { type: 'string', format: 'date' },
              date_fin:    { type: 'string', format: 'date' },
              nb_periodes: { type: 'integer', minimum: 2, maximum: 3, default: 3 },
              periodes: { type: 'array', items: { type: 'object', properties: {
                numero: { type: 'integer', minimum: 1, maximum: 3 },
                libelle: { type: 'string' }, date_debut: { type: 'string' }, date_fin: { type: 'string' },
              }}},
            },
          }}}},
          responses: { 201: { description: 'Annee scolaire creee' } },
        },
      },
      '/annees-scolaires/courante': {
        get: {
          tags: ['Identites'], summary: 'Annee scolaire courante avec ses periodes',
          responses: { 200: { description: 'Annee courante + periodes en JSON' }, 404: { description: 'Aucune annee courante definie' } },
        },
      },
      '/classes': {
        get: {
          tags: ['Identites'], summary: 'Liste des classes (annee courante)',
          description: 'Retourne les classes depuis la vue v_classes_completes. Permission : eleves.voir',
          responses: { 200: { description: 'Liste des classes' } },
        },
      },
      '/classes/{classe_id}/eleves': {
        get: {
          tags: ['Identites'], summary: 'Eleves d\'une classe',
          parameters: [{ name: 'classe_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Liste des eleves de la classe' } },
        },
      },

      // ════════════════════════════════════════════════
      // ELEVES
      // ════════════════════════════════════════════════
      '/eleves': {
        get: {
          tags: ['Eleves'], summary: 'Liste paginee des eleves (annee courante)',
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimiteParam' },
            { name: 'classe_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'niveau_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'recherche', in: 'query', schema: { type: 'string' }, description: 'Recherche par nom, prenom ou matricule' },
          ],
          responses: { 200: { description: 'Liste paginee', content: { 'application/json': { schema: { $ref: '#/components/schemas/PaginatedResponse' } } } } },
        },
        post: {
          tags: ['Eleves'], summary: 'Inscrire un nouvel eleve',
          description: 'Cree l\'utilisateur, le profil eleve, l\'inscription, et optionnellement un parent. Permission : eleves.creer',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['nom', 'prenom', 'classe_id'],
            properties: {
              nom:            { type: 'string', minLength: 2 },
              prenom:         { type: 'string', minLength: 2 },
              date_naissance: { type: 'string', format: 'date' },
              genre:          { type: 'string', enum: ['M', 'F'] },
              telephone:      { type: 'string' },
              adresse:        { type: 'string' },
              matricule:      { type: 'string' },
              classe_id:      { type: 'string', format: 'uuid' },
              parent: { type: 'object', properties: {
                nom: { type: 'string' }, prenom: { type: 'string' }, telephone: { type: 'string' },
                lien: { type: 'string', enum: ['pere', 'mere', 'tuteur', 'grand-parent'], default: 'tuteur' },
              }},
            },
          }}}},
          responses: { 201: { description: 'Eleve inscrit' } },
        },
      },
      '/eleves/{eleve_id}': {
        get: {
          tags: ['Eleves'], summary: 'Detail d\'un eleve',
          parameters: [{ name: 'eleve_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Profil eleve complet' }, 404: { description: 'Eleve introuvable' } },
        },
      },
      '/eleves/{eleve_id}/tableau-de-bord': {
        get: {
          tags: ['Eleves'], summary: 'Tableau de bord d\'un eleve (endpoint principal mobile)',
          description: 'Retourne moyennes, absences, 5 dernieres notes et EDT en un seul appel (optimise pour mobile offline).',
          parameters: [{ name: 'eleve_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Tableau de bord agrege' } },
        },
      },
      '/eleves/{eleve_id}/absences': {
        get: {
          tags: ['Eleves'], summary: 'Absences d\'un eleve',
          parameters: [
            { name: 'eleve_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Filtre pour sync offline (updated_at >)' },
          ],
          responses: { 200: { description: 'Liste des absences' } },
        },
      },

      // ════════════════════════════════════════════════
      // ENSEIGNANTS
      // ════════════════════════════════════════════════
      '/enseignants/moi/classes': {
        get: {
          tags: ['Enseignants'], summary: 'Classes de l\'enseignant connecte (annee courante)',
          description: 'Retourne les affectations avec effectif reel par classe.',
          responses: { 200: { description: 'Liste des classes avec effectifs' } },
        },
      },
      '/enseignants/moi/edt': {
        get: {
          tags: ['Enseignants'], summary: 'Emploi du temps de l\'enseignant connecte',
          description: 'Organise par jour de la semaine. Filtre optionnel par semaine (date ISO).',
          parameters: [{ name: 'semaine', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Date ISO pour filtrer par semaine' }],
          responses: { 200: { description: 'EDT organise par jour' } },
        },
      },
      '/enseignants/{id}/affectations': {
        get: {
          tags: ['Enseignants'], summary: 'Affectations d\'un enseignant (matieres x classes)',
          description: 'Accessible par l\'enseignant lui-meme ou un directeur/censeur.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'ID enseignant (table enseignants)' },
            { name: 'annee_scolaire_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filtrer par annee (defaut : courante)' },
          ],
          responses: { 200: { description: 'Liste des affectations' }, 403: { description: 'Pas vos affectations et pas admin' } },
        },
      },
      '/enseignants/{id}': {
        put: {
          tags: ['Enseignants'], summary: 'Modifier le profil d\'un enseignant',
          description: 'L\'enseignant peut modifier ses infos de contact. Le directeur/censeur peut en plus modifier les infos administratives (specialite, contrat, etc.).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              telephone:     { type: 'string', minLength: 8, maxLength: 20 },
              telephone_2:   { type: 'string', minLength: 8, maxLength: 20 },
              email:         { type: 'string', format: 'email' },
              adresse:       { type: 'string' },
              quartier:      { type: 'string' },
              ville:         { type: 'string' },
              photo_url:     { type: 'string', format: 'uri' },
              specialite:    { type: 'string', description: 'Admin seulement' },
              type_contrat:  { type: 'string', enum: ['titulaire', 'vacataire', 'contractuel', 'benevole'], description: 'Admin seulement' },
              matricule_fonct:     { type: 'string', description: 'Admin seulement' },
              date_prise_service:  { type: 'string', format: 'date', description: 'Admin seulement' },
              date_fin_contrat:    { type: 'string', format: 'date', description: 'Admin seulement' },
            },
          }}}},
          responses: { 200: { description: 'Profil mis a jour' }, 403: { description: 'Pas votre profil / champ admin interdit' } },
        },
      },

      // ════════════════════════════════════════════════
      // PARENTS
      // ════════════════════════════════════════════════
      '/parents/moi/enfants': {
        get: {
          tags: ['Parents'], summary: 'Enfants du parent connecte avec inscriptions',
          responses: { 200: { description: 'Liste des enfants' } },
        },
      },
      '/parents/moi/tableau-de-bord': {
        get: {
          tags: ['Parents'], summary: 'Tableau de bord parent (donnees agregees de tous les enfants)',
          description: 'Moyenne generale, absences, 3 dernieres notes pour chaque enfant.',
          responses: { 200: { description: 'Tableau de bord agrege' } },
        },
      },
      '/parents/moi/enfants/{id}/notes': {
        get: {
          tags: ['Parents'], summary: 'Notes d\'un enfant',
          description: 'Verifie le lien parent-enfant et la permission peut_voir_notes.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' }, description: 'ID utilisateur de l\'enfant' },
            { name: 'periode_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'matiere_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Pour sync offline' },
          ],
          responses: { 200: { description: 'Notes groupees par matiere' }, 403: { description: 'Pas autorise a voir les notes' } },
        },
      },
      '/parents/moi/enfants/{id}/absences': {
        get: {
          tags: ['Parents'], summary: 'Absences d\'un enfant',
          description: 'Recapitulatif par trimestre + detail des absences.',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Recapitulatif + detail absences' }, 403: { description: 'Pas autorise a voir les absences' } },
        },
      },
      '/parents/moi/enfants/{id}/bulletins': {
        get: {
          tags: ['Parents'], summary: 'Bulletins d\'un enfant',
          description: 'Bulletins valides avec detail des matieres.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Bulletins complets' }, 403: { description: 'Pas autorise a voir les bulletins' } },
        },
      },

      // ════════════════════════════════════════════════
      // MOYENNES
      // ════════════════════════════════════════════════
      '/moyennes/classe/{classeId}': {
        get: {
          tags: ['Moyennes'], summary: 'Moyennes par matiere pour une classe',
          description: 'Groupees par matiere avec stats (moyenne classe, min, max). Permission : notes.voir_classe',
          parameters: [
            { name: 'classeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'periode_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Defaut : derniere periode' },
          ],
          responses: { 200: { description: 'Moyennes par matiere avec classement' }, 404: { description: 'Classe introuvable' } },
        },
      },
      '/moyennes/eleve/{eleveId}': {
        get: {
          tags: ['Moyennes'], summary: 'Moyennes d\'un eleve (toutes matieres et periodes)',
          parameters: [{ name: 'eleveId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Moyennes matieres + moyennes generales par periode' } },
        },
      },
      '/moyennes/calculer': {
        post: {
          tags: ['Moyennes'], summary: 'Recalcul batch des moyennes',
          description: 'Calcule les moyennes par matiere, les rangs, les moyennes generales et les rangs generaux. Permission : moyennes.calculer',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['classe_id', 'periode_id'],
            properties: {
              classe_id:  { type: 'string', format: 'uuid' },
              periode_id: { type: 'string', format: 'uuid' },
              matiere_id: { type: 'string', format: 'uuid', description: 'Optionnel : recalculer une seule matiere' },
            },
          }}}},
          responses: { 200: { description: 'Nombre de moyennes recalculees' } },
        },
      },
      '/moyennes/classement/{classeId}': {
        get: {
          tags: ['Moyennes'], summary: 'Classement des eleves par moyenne generale',
          description: 'Avec stats : effectif, moyenne classe, taux de reussite.',
          parameters: [
            { name: 'classeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'periode_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Classement avec stats' } },
        },
      },

      // ════════════════════════════════════════════════
      // BULLETINS
      // ════════════════════════════════════════════════
      '/bulletins': {
        get: {
          tags: ['Bulletins'], summary: 'Liste paginee des bulletins',
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimiteParam' },
            { name: 'classe_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'periode_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'valide_seulement', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
          ],
          responses: { 200: { description: 'Liste paginee de bulletins' } },
        },
      },
      '/bulletins/{id}': {
        get: {
          tags: ['Bulletins'], summary: 'Un bulletin complet avec toutes les notes',
          description: 'Retourne l\'eleve, les matieres, la conduite, le resultat, les absences et l\'etat de validation.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Bulletin complet' }, 404: { description: 'Bulletin introuvable' } },
        },
      },
      '/bulletins/generer': {
        post: {
          tags: ['Bulletins'], summary: 'Generer les bulletins pour une classe',
          description: 'Marque les moyennes_generales comme bulletin_genere=true et remplit les recapitulatifs d\'absences. Permission : bulletins.generer',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['classe_id', 'periode_id'],
            properties: {
              classe_id:  { type: 'string', format: 'uuid' },
              periode_id: { type: 'string', format: 'uuid' },
            },
          }}}},
          responses: { 201: { description: 'Bulletins generes' }, 422: { description: 'Aucune moyenne calculee' } },
        },
      },
      '/bulletins/{id}/valider': {
        put: {
          tags: ['Bulletins'], summary: 'Valider (signer) un bulletin — directeur',
          description: 'Permission : bulletins.valider',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              appreciation_conseil: { type: 'string' },
              decision_conseil: { type: 'string', enum: ['felicitations', 'encouragements', 'tableau_honneur', 'avert_travail', 'avert_conduite', 'aucune'] },
              decision_passage: { type: 'string', enum: ['admis', 'ajourne', 'redoublant', 'exclu', 'en_attente'] },
            },
          }}}},
          responses: { 200: { description: 'Bulletin valide' } },
        },
      },
      '/bulletins/{id}/download': {
        get: {
          tags: ['Bulletins'], summary: 'URL signee du PDF du bulletin',
          description: 'Requiert que le bulletin soit genere ET valide.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: {
            200: { description: 'URL de telechargement (expire dans 1h)' },
            403: { description: 'Bulletin pas encore valide' },
            404: { description: 'Bulletin non genere ou PDF non disponible' },
          },
        },
      },

      // ════════════════════════════════════════════════
      // CONFIGS
      // ════════════════════════════════════════════════
      '/configs/coefficients': {
        get: {
          tags: ['Configs'], summary: 'Coefficients par matiere et niveau',
          description: 'Groupes par niveau. Permission : config.voir',
          parameters: [
            { name: 'niveau_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'serie_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          ],
          responses: { 200: { description: 'Coefficients groupes par niveau' } },
        },
        put: {
          tags: ['Configs'], summary: 'Modifier les coefficients (batch)',
          description: 'Permission : config.coefficients',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['modifications'],
            properties: {
              modifications: { type: 'array', minItems: 1, items: {
                type: 'object', required: ['config_id'],
                properties: {
                  config_id:          { type: 'string', format: 'uuid' },
                  coefficient:        { type: 'number', minimum: 0.5, maximum: 10 },
                  est_eliminatoire:   { type: 'boolean' },
                  seuil_eliminatoire: { type: 'number', minimum: 0, maximum: 20, nullable: true },
                  nb_devoirs_periode: { type: 'integer', minimum: 1, maximum: 5, nullable: true },
                  nb_compos_periode:  { type: 'integer', minimum: 0, maximum: 3, nullable: true },
                  est_obligatoire:    { type: 'boolean' },
                },
              }},
            },
          }}}},
          responses: { 200: { description: 'Coefficients modifies' } },
        },
      },
      '/configs/matieres': {
        get: {
          tags: ['Configs'], summary: 'Liste des matieres de l\'etablissement',
          parameters: [{ name: 'actif_seulement', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } }],
          responses: { 200: { description: 'Liste des matieres' } },
        },
        post: {
          tags: ['Configs'], summary: 'Creer une matiere',
          description: 'Permission : config.modifier',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['nom', 'code'],
            properties: {
              nom:                 { type: 'string', minLength: 2, maxLength: 150 },
              nom_court:           { type: 'string', maxLength: 20 },
              code:                { type: 'string', minLength: 1, maxLength: 20 },
              discipline_id:       { type: 'string', format: 'uuid' },
              compte_dans_moyenne: { type: 'boolean', default: true },
              est_eliminatoire:    { type: 'boolean', default: false },
              seuil_eliminatoire:  { type: 'number', minimum: 0, maximum: 20, nullable: true },
              est_optionnelle:     { type: 'boolean', default: false },
            },
          }}}},
          responses: { 201: { description: 'Matiere creee' }, 422: { description: 'Code deja utilise' } },
        },
      },

      // ════════════════════════════════════════════════
      // EDT
      // ════════════════════════════════════════════════
      '/edt/classe/{classeId}': {
        get: {
          tags: ['EDT'], summary: 'Emploi du temps d\'une classe',
          description: 'Organise par jour de la semaine. Permission : edt.voir',
          parameters: [
            { name: 'classeId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'semaine', in: 'query', schema: { type: 'string', format: 'date' }, description: 'Filtrer par semaine de validite' },
          ],
          responses: { 200: { description: 'EDT organise par jour' } },
        },
      },
      '/edt/enseignant/{enseignantId}': {
        get: {
          tags: ['EDT'], summary: 'Emploi du temps d\'un enseignant',
          parameters: [
            { name: 'enseignantId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'semaine', in: 'query', schema: { type: 'string', format: 'date' } },
          ],
          responses: { 200: { description: 'EDT de l\'enseignant' } },
        },
      },
      '/edt/creneaux': {
        post: {
          tags: ['EDT'], summary: 'Creer un creneau',
          description: 'Verifie : classe, affectation, plage horaire et conflit. Permission : edt.creer',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['classe_id', 'affectation_id', 'plage_id', 'jour_semaine'],
            properties: {
              classe_id:           { type: 'string', format: 'uuid' },
              affectation_id:      { type: 'string', format: 'uuid' },
              plage_id:            { type: 'string', format: 'uuid' },
              jour_semaine:        { type: 'integer', minimum: 1, maximum: 6, description: '1=Lundi ... 6=Samedi' },
              salle:               { type: 'string', maxLength: 50 },
              date_debut_validite: { type: 'string', format: 'date' },
              date_fin_validite:   { type: 'string', format: 'date' },
            },
          }}}},
          responses: { 201: { description: 'Creneau cree' }, 422: { description: 'Conflit de creneau' } },
        },
      },
      '/edt/creneaux/{id}': {
        put: {
          tags: ['EDT'], summary: 'Modifier un creneau',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              plage_id:            { type: 'string', format: 'uuid' },
              jour_semaine:        { type: 'integer', minimum: 1, maximum: 6 },
              salle:               { type: 'string', maxLength: 50 },
              affectation_id:      { type: 'string', format: 'uuid' },
              date_debut_validite: { type: 'string', format: 'date', nullable: true },
              date_fin_validite:   { type: 'string', format: 'date', nullable: true },
              actif:               { type: 'boolean' },
            },
          }}}},
          responses: { 200: { description: 'Creneau modifie' } },
        },
        delete: {
          tags: ['EDT'], summary: 'Supprimer (desactiver) un creneau',
          description: 'Soft delete : le creneau est marque comme inactif.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 204: { description: 'Creneau desactive' }, 404: { description: 'Creneau introuvable' } },
        },
      },

      // ════════════════════════════════════════════════
      // DISCIPLINE
      // ════════════════════════════════════════════════
      '/discipline/sanctions': {
        get: {
          tags: ['Discipline'], summary: 'Liste paginee des sanctions',
          description: 'Permission : discipline.voir',
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimiteParam' },
            { name: 'classe_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['avertissement_oral', 'avertissement_ecrit', 'retenue', 'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive'] } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Liste paginee de sanctions' } },
        },
        post: {
          tags: ['Discipline'], summary: 'Creer une sanction',
          description: 'Declenche une notification parent (categorie A — urgente). Permission : discipline.prononcer',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['inscription_id', 'type', 'motif'],
            properties: {
              inscription_id: { type: 'string', format: 'uuid' },
              incident_id:    { type: 'string', format: 'uuid' },
              type:           { type: 'string', enum: ['avertissement_oral', 'avertissement_ecrit', 'retenue', 'renvoi_temporaire', 'conseil_discipline', 'exclusion_definitive'] },
              motif:          { type: 'string', minLength: 5 },
              date_prononcee: { type: 'string', format: 'date' },
              date_debut:     { type: 'string', format: 'date' },
              date_fin:       { type: 'string', format: 'date' },
              nb_jours:       { type: 'integer', minimum: 1, maximum: 30 },
              date_retenue:        { type: 'string', format: 'date' },
              heure_debut_retenue: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              heure_fin_retenue:   { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              salle_retenue:       { type: 'string', maxLength: 50 },
            },
          }}}},
          responses: { 201: { description: 'Sanction creee + notification parent envoyee' } },
        },
      },
      '/discipline/sanctions/{id}': {
        put: {
          tags: ['Discipline'], summary: 'Modifier une sanction',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              motif:       { type: 'string', minLength: 5 },
              date_debut:  { type: 'string', format: 'date' },
              date_fin:    { type: 'string', format: 'date' },
              nb_jours:    { type: 'integer', minimum: 1, maximum: 30 },
              date_retenue:        { type: 'string', format: 'date' },
              heure_debut_retenue: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              heure_fin_retenue:   { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              salle_retenue:       { type: 'string', maxLength: 50 },
              approuvee_par:       { type: 'string', format: 'uuid' },
            },
          }}}},
          responses: { 200: { description: 'Sanction modifiee' } },
        },
      },
      '/discipline/eleve/{eleveId}': {
        get: {
          tags: ['Discipline'], summary: 'Dossier disciplinaire d\'un eleve',
          description: 'Incidents + sanctions. Permission : discipline.voir',
          parameters: [{ name: 'eleveId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 200: { description: 'Dossier disciplinaire complet' } },
        },
      },

      // ════════════════════════════════════════════════
      // EVENEMENTS
      // ════════════════════════════════════════════════
      '/evenements': {
        get: {
          tags: ['Evenements'], summary: 'Liste des evenements (agenda)',
          parameters: [
            { name: 'type', in: 'query', schema: { type: 'string', enum: ['sortie_scolaire', 'reunion_parents', 'examen_officiel', 'conseil_classe', 'conseil_discipline', 'journee_sportive', 'journee_portes_ouvertes', 'conge', 'formation_enseignants', 'autre'] } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'jusqua', in: 'query', schema: { type: 'string', format: 'date' } },
            { name: 'a_venir', in: 'query', schema: { type: 'string', enum: ['true'] }, description: 'Filtrer les evenements futurs' },
          ],
          responses: { 200: { description: 'Liste des evenements' } },
        },
        post: {
          tags: ['Evenements'], summary: 'Creer un evenement',
          description: 'Permission : config.modifier',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['titre', 'type', 'date_debut', 'date_fin'],
            properties: {
              titre:       { type: 'string', minLength: 3, maxLength: 200 },
              type:        { type: 'string', enum: ['sortie_scolaire', 'reunion_parents', 'examen_officiel', 'conseil_classe', 'conseil_discipline', 'journee_sportive', 'journee_portes_ouvertes', 'conge', 'formation_enseignants', 'autre'] },
              description: { type: 'string' },
              date_debut:  { type: 'string', format: 'date' },
              date_fin:    { type: 'string', format: 'date' },
              heure_debut: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              heure_fin:   { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
              lieu:        { type: 'string' },
              concerne_tout_etablissement: { type: 'boolean', default: true },
              classes_concernees:  { type: 'array', items: { type: 'string', format: 'uuid' } },
              niveaux_concernes:   { type: 'array', items: { type: 'string', format: 'uuid' } },
              necessite_autorisation: { type: 'boolean', default: false },
              date_limite_autorisation: { type: 'string', format: 'date' },
              cout_participation:  { type: 'number', minimum: 0 },
              devise_cout:         { type: 'string', maxLength: 5, default: 'XOF' },
              notif_programmee:    { type: 'boolean', default: false },
              notif_delai_jours:   { type: 'integer', minimum: 0, maximum: 30, default: 2 },
            },
          }}}},
          responses: { 201: { description: 'Evenement cree' } },
        },
      },
      '/evenements/{id}': {
        put: {
          tags: ['Evenements'], summary: 'Modifier un evenement',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', description: 'Memes champs que POST (tous optionnels)' } } } },
          responses: { 200: { description: 'Evenement modifie' }, 422: { description: 'Aucun champ a modifier' } },
        },
        delete: {
          tags: ['Evenements'], summary: 'Supprimer un evenement',
          description: 'Suppression definitive (hard delete).',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 204: { description: 'Evenement supprime' }, 404: { description: 'Evenement introuvable' } },
        },
      },

      // ════════════════════════════════════════════════
      // SECURITE
      // ════════════════════════════════════════════════
      '/securite/audit': {
        get: {
          tags: ['Securite'], summary: 'Journal d\'audit (admin seulement)',
          description: 'Permission : admin.audit',
          parameters: [
            { $ref: '#/components/parameters/PageParam' },
            { $ref: '#/components/parameters/LimiteParam' },
            { name: 'action', in: 'query', schema: { type: 'string' }, description: 'Filtrer par action (ex: utilisateurs.bloquer)' },
            { name: 'table_cible', in: 'query', schema: { type: 'string' } },
            { name: 'utilisateur_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
            { name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'jusqua', in: 'query', schema: { type: 'string', format: 'date-time' } },
          ],
          responses: { 200: { description: 'Journal d\'audit pagine' } },
        },
      },
      '/securite/sessions': {
        get: {
          tags: ['Securite'], summary: 'Sessions actives de l\'etablissement',
          description: 'Permission : admin.audit',
          parameters: [{ name: 'utilisateur_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Filtrer par utilisateur' }],
          responses: { 200: { description: 'Sessions actives' } },
        },
      },
      '/securite/sessions/{id}': {
        delete: {
          tags: ['Securite'], summary: 'Revoquer une session (admin)',
          description: 'Permission : admin.utilisateurs',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { 204: { description: 'Session revoquee' }, 404: { description: 'Session introuvable' } },
        },
      },
      '/securite/blocage/{userId}': {
        post: {
          tags: ['Securite'], summary: 'Bloquer / debloquer un compte',
          description: 'Bascule le statut actif. Si on bloque : revoque toutes les sessions. Impossible de se bloquer soi-meme. Permission : admin.utilisateurs',
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['motif'],
            properties: {
              motif: { type: 'string', minLength: 5, maxLength: 200 },
            },
          }}}},
          responses: {
            200: { description: 'Compte bloque/debloque' },
            403: { description: 'Impossible de bloquer votre propre compte' },
          },
        },
      },

      // ════════════════════════════════════════════════
      // SYNC
      // ════════════════════════════════════════════════
      '/sync': {
        get: {
          tags: ['Sync'], summary: 'Telecharger les changements (serveur -> mobile)',
          description: 'Endpoint principal de synchronisation offline-first. Retourne un payload adapte au role (enseignant ou parent) avec toutes les donnees modifiees depuis le dernier sync.',
          parameters: [{ name: 'depuis', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Dernier sync (format ISO). Si absent : sync complet.' }],
          responses: { 200: { description: 'Payload de sync (classes, eleves, notes, EDT, etc.)' } },
        },
      },
      '/sync/operations': {
        post: {
          tags: ['Sync'], summary: 'Envoyer les operations (mobile -> serveur)',
          description: 'Traite un batch d\'operations en FIFO. Types supportes : notes.saisir, presences.saisir.',
          requestBody: { required: true, content: { 'application/json': { schema: {
            type: 'object', required: ['operations'],
            properties: {
              operations: { type: 'array', minItems: 1, maxItems: 100, items: {
                type: 'object', required: ['id', 'type', 'payload', 'cree_at_local'],
                properties: {
                  id:             { type: 'string', format: 'uuid' },
                  type:           { type: 'string', description: 'notes.saisir | presences.saisir' },
                  payload:        { type: 'object' },
                  cree_at_local:  { type: 'string', format: 'date-time' },
                },
              }},
            },
          }}}},
          responses: { 200: { description: 'Resultats par operation (ok / erreur)' } },
        },
      },

      // ════════════════════════════════════════════════
      // HEALTH
      // ════════════════════════════════════════════════
      '/health': {
        get: {
          tags: ['Systeme'],
          summary: 'Health check',
          security: [],
          servers: [{ url: '/' }],
          responses: { 200: { description: 'API en ligne', content: { 'application/json': { schema: {
            type: 'object',
            properties: {
              status:    { type: 'string', example: 'ok' },
              version:   { type: 'string', example: '1.0.0' },
              env:       { type: 'string', example: 'development' },
              timestamp: { type: 'string', format: 'date-time' },
            },
          }}}}},
        },
      },
    },
  },
  apis: [], // No JSDoc annotations — all paths defined inline above
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
