'use strict';

/**
 * E2E — Un trimestre complet de A à Z
 *
 * Scénario :
 *   1. Création école + directeur (POST /setup)
 *   2. Connexion directeur → JWT
 *   3. Création classe + matière + affectation enseignant
 *   4. Inscription élèves + parent lié
 *   5. Enseignant fait l'appel → 1 absent
 *   6. Enseignant crée évaluation → saisit notes → publie
 *   7. Directeur calcule moyennes de la classe (T1)
 *   8. Directeur génère les bulletins → valide un bulletin
 *   9. Parent se connecte → consulte notes / absences / bulletins
 *
 * Prérequis : Docker `ecole_postgres` en cours (jest.integration.config.js)
 */

const supertest = require('supertest');
const bcrypt    = require('bcryptjs');
const {
  getTestDB, closeTestDB, truncateData,
  createIntegrationApp, creerSession,
} = require('./helpers');

// ── État partagé entre les phases ─────────────────────────────
let app, req;
let db;

let etablissement, annee, periodes;
let niveau, classe;
let directeurUser, directeurToken;
let enseignantUser, enseignant, enseignantToken;
let parentUser, parentToken;
const eleves = [];
let matiere, affectation;
let edtId;
let appel;
let evaluation;
let bulletinId;

// ── Setup global ───────────────────────────────────────────────

beforeAll(async () => {
  app = createIntegrationApp();
  req = supertest(app);
  db  = getTestDB();

  await truncateData();

  // Réinjecter rôles + permissions (truncate cascade les supprime)
  await db.raw(`
    INSERT INTO roles (code, libelle, description) VALUES
      ('directeur',  'Directeur',   'Accès établissement'),
      ('enseignant', 'Enseignant',  'Notes et appels'),
      ('parent',     'Parent',      'Consultation'),
      ('eleve',      'Élève',       'Consultation propre')
    ON CONFLICT (code) DO NOTHING;
  `);

  await db.raw(`
    INSERT INTO permissions (code, description, domaine) VALUES
      ('notes.voir_classe',          'Voir notes classe',           'notes'),
      ('notes.voir_eleve',           'Voir notes élève',            'notes'),
      ('notes.saisir',               'Saisir notes',                'notes'),
      ('notes.modifier_toutes',      'Modifier notes publiées',     'notes'),
      ('notes.publier',              'Publier notes',               'notes'),
      ('notes.supprimer',            'Supprimer note',              'notes'),
      ('evaluations.creer',          'Créer évaluation',            'notes'),
      ('evaluations.modifier',       'Modifier évaluation',         'notes'),
      ('evaluations.supprimer',      'Supprimer évaluation',        'notes'),
      ('moyennes.calculer',          'Calculer moyennes',           'bulletins'),
      ('bulletins.voir',             'Voir bulletins',              'bulletins'),
      ('bulletins.generer',          'Générer bulletins',           'bulletins'),
      ('bulletins.valider',          'Valider bulletin',            'bulletins'),
      ('bulletins.envoyer',          'Envoyer bulletins',           'bulletins'),
      ('bulletins.conseil',          'Conseil de classe',           'bulletins'),
      ('absences.faire_appel',       'Faire appel',                 'absences'),
      ('absences.voir_classe',       'Voir absences classe',        'absences'),
      ('absences.voir_eleve',        'Voir absences élève',         'absences'),
      ('absences.justifier',         'Justifier absence',           'absences'),
      ('absences.stats',             'Stats absences',              'absences'),
      ('edt.voir',                   'Voir EDT',                    'edt'),
      ('edt.creer',                  'Créer EDT',                   'edt'),
      ('edt.modifier_ponctuel',      'Modifier EDT ponctuel',       'edt'),
      ('eleves.voir',                'Voir élèves',                 'eleves'),
      ('eleves.creer',               'Inscrire élève',              'eleves'),
      ('eleves.modifier',            'Modifier élève',              'eleves'),
      ('eleves.archiver',            'Archiver élève',              'eleves'),
      ('eleves.medicale',            'Données médicales',           'eleves'),
      ('parents.voir_contact',       'Voir contacts parents',       'parents'),
      ('parents.modifier',           'Modifier parents',            'parents'),
      ('enseignants.voir',           'Voir enseignants',            'enseignants'),
      ('enseignants.creer',          'Créer enseignant',            'enseignants'),
      ('enseignants.affecter',       'Affecter enseignant',         'enseignants'),
      ('config.voir',                'Voir config',                 'config'),
      ('config.modifier',            'Modifier config',             'config'),
      ('config.annee_scolaire',      'Gérer années scolaires',      'config'),
      ('config.coefficients',        'Modifier coefficients',       'config'),
      ('rapports.voir',              'Voir rapports',               'rapports'),
      ('rapports.exporter',          'Exporter données',            'rapports'),
      ('admin.utilisateurs',         'Gérer utilisateurs',          'admin'),
      ('admin.audit',                'Journaux audit',              'admin'),
      ('discipline.saisir_incident', 'Signaler incident',           'discipline'),
      ('discipline.voir',            'Voir incidents',              'discipline'),
      ('discipline.prononcer',       'Prononcer sanction',          'discipline'),
      ('discipline.conseil',         'Conseil discipline',          'discipline')
    ON CONFLICT (code) DO NOTHING;
  `);

  await db.raw(`
    SELECT affecter_permissions('directeur', ARRAY[
      'notes.voir_classe','notes.saisir','notes.modifier_toutes','notes.publier','notes.supprimer',
      'evaluations.creer','evaluations.modifier','evaluations.supprimer',
      'moyennes.calculer','bulletins.voir','bulletins.generer','bulletins.valider',
      'bulletins.envoyer','bulletins.conseil',
      'absences.faire_appel','absences.voir_classe','absences.voir_eleve',
      'absences.justifier','absences.stats',
      'discipline.saisir_incident','discipline.voir','discipline.prononcer','discipline.conseil',
      'edt.voir','edt.creer','edt.modifier_ponctuel',
      'eleves.voir','eleves.creer','eleves.modifier','eleves.archiver','eleves.medicale',
      'parents.voir_contact','parents.modifier',
      'enseignants.voir','enseignants.creer','enseignants.affecter',
      'config.voir','config.modifier','config.annee_scolaire','config.coefficients',
      'rapports.voir','rapports.exporter','admin.utilisateurs','admin.audit'
    ]);
    SELECT affecter_permissions('enseignant', ARRAY[
      'notes.voir_classe','notes.saisir','notes.publier',
      'evaluations.creer','evaluations.modifier',
      'absences.faire_appel','absences.voir_classe',
      'edt.voir','edt.modifier_ponctuel',
      'eleves.voir','rapports.voir'
    ]);
    SELECT affecter_permissions('parent', ARRAY[
      'notes.voir_eleve','bulletins.voir','absences.voir_eleve','edt.voir'
    ]);
    SELECT affecter_permissions('eleve', ARRAY[
      'notes.voir_eleve','bulletins.voir','edt.voir'
    ]);
  `);
}, 30000);

afterAll(async () => {
  await closeTestDB();
});

// ═══════════════════════════════════════════════════════════════
// PHASE 1 — Création de l'école
// ═══════════════════════════════════════════════════════════════

describe('Phase 1 — Création école + directeur (POST /setup)', () => {
  it('crée école, directeur, année scolaire et niveaux', async () => {
    const res = await req
      .post('/api/v1/setup')
      .send({
        etablissement: {
          nom:           'Lycée Cheikh Anta Diop',
          code_officiel: 'LCD-E2E',
          type:          'lycee',
          pays:          'Sénégal',
          region:        'Dakar',
          ville:         'Dakar',
        },
        directeur: {
          nom:          'Sarr',
          prenom:       'Ibrahima',
          email:        'directeur@lcd-e2e.sn',
          telephone:    '+221771234567',
          mot_de_passe: 'DirecteurTest1!',
        },
        annee_scolaire: {
          libelle:      '2024-2025',
          date_debut:   '2024-10-01',
          date_fin:     '2025-07-15',
          nb_periodes:  3,
          type_periode: 'trimestre',
        },
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('etablissement_id');

    etablissement = await db('etablissements').where({ code_officiel: 'LCD-E2E' }).first();
    annee   = await db('annees_scolaires').where({ etablissement_id: etablissement.id, est_courante: true }).first();
    periodes = await db('periodes').where({ annee_scolaire_id: annee.id }).orderBy('numero');

    expect(etablissement).toBeDefined();
    expect(annee).toBeDefined();
    expect(periodes).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 2 — Connexion directeur
// ═══════════════════════════════════════════════════════════════

describe('Phase 2 — Connexion directeur', () => {
  it('POST /auth/connexion retourne un token JWT valide', async () => {
    const res = await req
      .post('/api/v1/auth/connexion')
      .send({
        identifiant:        'directeur@lcd-e2e.sn',
        mot_de_passe:       'DirecteurTest1!',
        etablissement_code: 'LCD-E2E',
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    directeurToken = res.body.data.token;
    directeurUser  = res.body.data.utilisateur;
  });

  it('POST /auth/connexion rejette un mauvais mot de passe', async () => {
    await req
      .post('/api/v1/auth/connexion')
      .send({
        identifiant:        'directeur@lcd-e2e.sn',
        mot_de_passe:       'mauvais',
        etablissement_code: 'LCD-E2E',
      })
      .expect(401);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 3 — Configuration pédagogique
// ═══════════════════════════════════════════════════════════════

describe('Phase 3 — Configuration pédagogique', () => {
  it('crée un niveau Terminale et une classe Term S1', async () => {
    const [niv] = await db('niveaux').insert({
      etablissement_id: etablissement.id,
      nom: 'Terminale', nom_court: 'Tle',
      cycle: 'lycee', ordre: 12,
    }).returning('*');
    niveau = niv;

    const [cls] = await db('classes').insert({
      niveau_id: niveau.id,
      nom: 'Term S1',
      annee_scolaire_id: annee.id,
      effectif_max: 40,
    }).returning('*');
    classe = cls;

    expect(classe.nom).toBe('Term S1');
  });

  it('crée un enseignant et l\'affecte en Mathématiques', async () => {
    const hash = await bcrypt.hash('Enseignant1!', 10);

    const [user] = await db('utilisateurs').insert({
      etablissement_id: etablissement.id,
      nom: 'Fall', prenom: 'Aissatou',
      email: 'enseignant@lcd-e2e.sn',
      telephone: '+221771234568',
      mot_de_passe_hash: hash,
      actif: true,
    }).returning('*');
    enseignantUser = user;

    const roleEns = await db('roles').where({ code: 'enseignant' }).first();
    await db('utilisateur_roles').insert({
      utilisateur_id:  enseignantUser.id,
      role_id:         roleEns.id,
      etablissement_id: etablissement.id,
      actif: true,
    });

    const [ens] = await db('enseignants').insert({
      utilisateur_id: enseignantUser.id,
      matricule_fonct: 'ENS-E2E-001',
      specialite: 'Mathématiques',
      type_contrat: 'titulaire',
    }).returning('*');
    enseignant = ens;

    enseignantToken = await creerSession(enseignantUser.id, etablissement.id);

    const [mat] = await db('matieres').insert({
      etablissement_id: etablissement.id,
      nom: 'Mathématiques', code: 'MATH',
    }).returning('*');
    matiere = mat;

    const [aff] = await db('affectations_enseignants').insert({
      enseignant_id: enseignant.id,
      matiere_id:    matiere.id,
      classe_id:     classe.id,
      annee_scolaire_id: annee.id,
    }).returning('*');
    affectation = aff;

    expect(affectation).toBeDefined();
  });

  it('crée un créneau EDT lundi matin', async () => {
    const plage = await db('plages_horaires').first('id');
    if (!plage) {
      console.warn('  ⚠ Aucune plage horaire — EDT ignoré');
      return;
    }

    const [edt] = await db('emplois_du_temps').insert({
      classe_id:      classe.id,
      affectation_id: affectation.id,
      plage_id:       plage.id,
      jour_semaine:   1,
      salle:          'Salle 10',
      actif:          true,
    }).returning('*');
    edtId = edt.id;

    expect(edtId).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 4 — Inscription élèves + parent
// ═══════════════════════════════════════════════════════════════

describe('Phase 4 — Inscription élèves et parent', () => {
  it('inscrit 3 élèves dans la classe', async () => {
    const elevesData = [
      { nom: 'Diallo', prenom: 'Fatou',   genre: 'F', matricule: 'E2E-001', tel: '+221770000101' },
      { nom: 'Ndiaye', prenom: 'Mamadou', genre: 'M', matricule: 'E2E-002', tel: '+221770000102' },
      { nom: 'Gueye',  prenom: 'Rokhaya', genre: 'F', matricule: 'E2E-003', tel: '+221770000103' },
    ];

    const roleEl = await db('roles').where({ code: 'eleve' }).first();

    for (const e of elevesData) {
      const [user] = await db('utilisateurs').insert({
        etablissement_id: etablissement.id,
        nom: e.nom, prenom: e.prenom, genre: e.genre,
        telephone: e.tel, actif: true,
      }).returning('*');

      await db('utilisateur_roles').insert({
        utilisateur_id: user.id,
        role_id: roleEl.id,
        etablissement_id: etablissement.id,
        actif: true,
      });

      const [eleve] = await db('eleves').insert({
        utilisateur_id: user.id,
        matricule: e.matricule,
        date_inscription: '2024-10-01',
      }).returning('*');

      const [inscription] = await db('inscriptions').insert({
        eleve_id: eleve.id,
        classe_id: classe.id,
        annee_scolaire_id: annee.id,
        statut: 'actif',
      }).returning('*');

      eleves.push({ user, eleve, inscription });
    }

    expect(eleves).toHaveLength(3);
  });

  it('crée un parent et le lie au premier élève', async () => {
    const hash = await bcrypt.hash('Parent1234!', 10);
    const rolePar = await db('roles').where({ code: 'parent' }).first();

    const [user] = await db('utilisateurs').insert({
      etablissement_id: etablissement.id,
      nom: 'Diallo', prenom: 'Oumar',
      telephone: '+221770000200',
      mot_de_passe_hash: hash,
      actif: true,
    }).returning('*');
    parentUser = user;

    await db('utilisateur_roles').insert({
      utilisateur_id: parentUser.id,
      role_id: rolePar.id,
      etablissement_id: etablissement.id,
      actif: true,
    });

    await db('parents_eleves').insert({
      utilisateur_id:       parentUser.id,
      eleve_id:             eleves[0].eleve.id,
      lien:                 'pere',
      peut_voir_notes:      true,
      peut_voir_absences:   true,
      peut_voir_bulletins:  true,
      est_contact_urgence:  true,
    });

    parentToken = await creerSession(parentUser.id, etablissement.id);
    expect(parentToken).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 5 — Appel et absences
// ═══════════════════════════════════════════════════════════════

describe('Phase 5 — Appel et absences', () => {
  it('POST /appels crée un appel pour la classe', async () => {
    if (!edtId) return;

    const res = await req
      .post('/api/v1/appels')
      .set('Authorization', `Bearer ${enseignantToken}`)
      .send({
        emploi_du_temps_id: edtId,
        date_cours: '2024-11-04',
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('appel_id');
    appel = res.body.data;
  });

  it('PUT /appels/:id/presences marque le 2e élève absent', async () => {
    if (!appel?.appel_id) return;

    const presencesDB = await db('presences')
      .where({ appel_id: appel.appel_id })
      .select('id', 'eleve_id', 'statut');

    expect(presencesDB.length).toBeGreaterThan(0);

    const mises_a_jour = presencesDB.map((p, i) => ({
      presence_id: p.id,
      statut: i === 1 ? 'absent' : 'present',
    }));

    const res = await req
      .put(`/api/v1/appels/${appel.appel_id}/presences`)
      .set('Authorization', `Bearer ${enseignantToken}`)
      .send({ presences: mises_a_jour })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('GET /presences/absences retourne les absences de la classe', async () => {
    if (!classe) return;

    const res = await req
      .get('/api/v1/presences/absences')
      .set('Authorization', `Bearer ${enseignantToken}`)
      .query({ classe_id: classe.id })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 6 — Évaluation, saisie des notes, publication
// ═══════════════════════════════════════════════════════════════

describe('Phase 6 — Évaluation et notes', () => {
  it('POST /evaluations crée un devoir de Mathématiques', async () => {
    const res = await req
      .post('/api/v1/evaluations')
      .set('Authorization', `Bearer ${enseignantToken}`)
      .send({
        affectation_id:  affectation.id,
        periode_id:      periodes[0].id,
        titre:           'Devoir 1 — Fonctions',
        type:            'devoir',
        numero:          1,
        date_evaluation: '2024-11-15',
        note_max:        20,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    evaluation = res.body.data;
  });

  it('POST /evaluations/:id/notes saisit les notes des 3 élèves', async () => {
    const notes = [
      { eleve_id: eleves[0].user.id, note: 16 },
      { eleve_id: eleves[1].user.id, note: 12 },
      { eleve_id: eleves[2].user.id, note: 18 },
    ];

    const res = await req
      .post(`/api/v1/evaluations/${evaluation.id}/notes`)
      .set('Authorization', `Bearer ${enseignantToken}`)
      .send({ notes })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('PUT /evaluations/:id/publier publie les notes', async () => {
    const res = await req
      .put(`/api/v1/evaluations/${evaluation.id}/publier`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('GET /evaluations retourne l\'évaluation créée', async () => {
    const res = await req
      .get('/api/v1/evaluations')
      .set('Authorization', `Bearer ${enseignantToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.some(e => e.id === evaluation.id)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 7 — Calcul des moyennes
// ═══════════════════════════════════════════════════════════════

describe('Phase 7 — Calcul des moyennes', () => {
  it('POST /moyennes/calculer calcule les moyennes T1 de la classe', async () => {
    const res = await req
      .post('/api/v1/moyennes/calculer')
      .set('Authorization', `Bearer ${directeurToken}`)
      .send({ classe_id: classe.id, periode_id: periodes[0].id })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('GET /moyennes/classe/:id retourne les moyennes par matière', async () => {
    const res = await req
      .get(`/api/v1/moyennes/classe/${classe.id}`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .query({ periode_id: periodes[0].id })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /moyennes/eleve/:id retourne la moyenne de Fatou Diallo', async () => {
    const eleveId = eleves[0].eleve.id;

    const res = await req
      .get(`/api/v1/moyennes/eleve/${eleveId}`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .query({ periode_id: periodes[0].id })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });

  it('GET /moyennes/classement/:id retourne le classement de la classe', async () => {
    const res = await req
      .get(`/api/v1/moyennes/classement/${classe.id}`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .query({ periode_id: periodes[0].id })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 8 — Génération et validation des bulletins
// ═══════════════════════════════════════════════════════════════

describe('Phase 8 — Bulletins', () => {
  it('POST /bulletins/generer lance la génération pour le T1', async () => {
    const res = await req
      .post('/api/v1/bulletins/generer')
      .set('Authorization', `Bearer ${directeurToken}`)
      .send({ classe_id: classe.id, periode_id: periodes[0].id })
      .expect(202);

    expect(res.body.succes).toBe(true);
  });

  it('GET /bulletins liste les bulletins de la classe', async () => {
    const res = await req
      .get('/api/v1/bulletins')
      .set('Authorization', `Bearer ${directeurToken}`)
      .query({ classe_id: classe.id, periode_id: periodes[0].id })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);

    if (res.body.data.length > 0) {
      bulletinId = res.body.data[0].id;
    }
  });

  it('PUT /bulletins/:id/valider valide le premier bulletin', async () => {
    if (!bulletinId) return;

    const res = await req
      .put(`/api/v1/bulletins/${bulletinId}/valider`)
      .set('Authorization', `Bearer ${directeurToken}`)
      .send({
        decision_conseil:       'Passage en classe supérieure',
        appreciation_generale:  'Bon trimestre, continue ainsi.',
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// PHASE 9 — Vue parent : notes, absences, bulletins
// ═══════════════════════════════════════════════════════════════

describe('Phase 9 — Parent consulte le dossier de son enfant', () => {
  it('GET /parents/moi/enfants liste l\'enfant lié', async () => {
    const res = await req
      .get('/api/v1/parents/moi/enfants')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /parents/moi/tableau-de-bord retourne les stats agrégées', async () => {
    const res = await req
      .get('/api/v1/parents/moi/tableau-de-bord')
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('enfants');
  });

  it('GET /parents/moi/enfants/:id/notes retourne les notes publiées de Fatou', async () => {
    const eleveId = eleves[0].eleve.id;

    const res = await req
      .get(`/api/v1/parents/moi/enfants/${eleveId}/notes`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /parents/moi/enfants/:id/absences retourne le récapitulatif', async () => {
    const eleveId = eleves[0].eleve.id;

    const res = await req
      .get(`/api/v1/parents/moi/enfants/${eleveId}/absences`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('recapitulatif');
    expect(res.body.data).toHaveProperty('detail');
  });

  it('GET /parents/moi/enfants/:id/bulletins retourne les bulletins validés', async () => {
    const eleveId = eleves[0].eleve.id;

    const res = await req
      .get(`/api/v1/parents/moi/enfants/${eleveId}/bulletins`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /parents/moi/enfants/:id/notes retourne 403 pour un élève non lié', async () => {
    const autreEleveId = eleves[2].eleve.id;

    await req
      .get(`/api/v1/parents/moi/enfants/${autreEleveId}/notes`)
      .set('Authorization', `Bearer ${parentToken}`)
      .expect(403);
  });
});
