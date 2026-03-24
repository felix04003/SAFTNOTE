'use strict';

const knex      = require('knex');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const express   = require('express');

const JWT_SECRET = 'test_jwt_secret_32_characters_min_ok';

// ── Connexion base de test ─────────────────────────────────────

let db;

function getTestDB() {
  if (db) return db;
  db = knex({
    client: 'pg',
    connection: {
      host:     process.env.POSTGRES_HOST     || 'localhost',
      port:     parseInt(process.env.POSTGRES_PORT) || 5433,
      database: 'ecole_manager_test',
      user:     process.env.POSTGRES_USER     || 'ecole_user',
      password: process.env.POSTGRES_PASSWORD || 'ecole_password_dev',
    },
    pool: { min: 1, max: 5 },
  });
  return db;
}

async function closeTestDB() {
  if (db) {
    await db.destroy();
    db = null;
  }
}

// ── Nettoyage ──────────────────────────────────────────────────

async function truncateData() {
  const database = getTestDB();
  await database.raw(`
    DO $$ DECLARE r RECORD;
    BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename NOT IN ('schema_migrations', 'ref_coefficients', 'ref_coefficients_college', 'permissions', 'roles_permissions')
      ) LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);
}

// ── Seed données de test ───────────────────────────────────────

async function seedTestData() {
  const database = getTestDB();

  // Réinjecter les rôles (supprimés par truncate cascade)
  await database.raw(`
    INSERT INTO roles (code, libelle, description) VALUES
      ('super_admin', 'Super Administrateur', 'Accès complet'),
      ('directeur',   'Directeur',            'Accès établissement'),
      ('censeur',     'Censeur',              'Absences, EDT'),
      ('admin',       'Administrateur',       'Gestion admin'),
      ('enseignant',  'Enseignant',           'Notes et appels'),
      ('parent',      'Parent',               'Consultation'),
      ('eleve',       'Élève',                'Consultation propre')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Réinjecter les permissions (supprimées par truncate cascade)
  await database.raw(`
    INSERT INTO permissions (code, description, domaine) VALUES
      ('notes.voir_classe',       'Voir les notes d''une classe',       'notes'),
      ('notes.voir_eleve',        'Voir les notes d''un élève',         'notes'),
      ('notes.saisir',            'Saisir les notes',                   'notes'),
      ('notes.modifier_toutes',   'Modifier des notes publiées',        'notes'),
      ('notes.publier',           'Publier les notes',                  'notes'),
      ('notes.supprimer',         'Supprimer une note',                 'notes'),
      ('evaluations.creer',       'Créer une évaluation',               'notes'),
      ('evaluations.modifier',    'Modifier une évaluation',            'notes'),
      ('evaluations.supprimer',   'Supprimer une évaluation',           'notes'),
      ('moyennes.calculer',       'Calculer les moyennes',              'bulletins'),
      ('bulletins.voir',          'Voir les bulletins',                  'bulletins'),
      ('bulletins.generer',       'Générer les bulletins',              'bulletins'),
      ('bulletins.valider',       'Valider un bulletin',                'bulletins'),
      ('bulletins.envoyer',       'Envoyer les bulletins',              'bulletins'),
      ('bulletins.conseil',       'Décisions conseil de classe',        'bulletins'),
      ('absences.faire_appel',    'Faire l''appel',                     'absences'),
      ('absences.voir_classe',    'Voir absences classe',               'absences'),
      ('absences.voir_eleve',     'Voir absences élève',                'absences'),
      ('absences.justifier',      'Justifier une absence',              'absences'),
      ('absences.stats',          'Stats absences',                     'absences'),
      ('discipline.saisir_incident','Signaler un incident',             'discipline'),
      ('discipline.voir',         'Voir incidents',                     'discipline'),
      ('discipline.prononcer',    'Prononcer sanction',                 'discipline'),
      ('discipline.conseil',      'Conseil de discipline',              'discipline'),
      ('edt.voir',                'Voir EDT',                           'edt'),
      ('edt.creer',               'Créer EDT',                          'edt'),
      ('edt.modifier_ponctuel',   'Modifier EDT ponctuel',              'edt'),
      ('eleves.voir',             'Voir les élèves',                    'eleves'),
      ('eleves.creer',            'Inscrire un élève',                  'eleves'),
      ('eleves.modifier',         'Modifier un élève',                  'eleves'),
      ('eleves.archiver',         'Archiver un élève',                  'eleves'),
      ('eleves.medicale',         'Données médicales',                  'eleves'),
      ('parents.voir_contact',    'Voir contacts parents',              'parents'),
      ('parents.modifier',        'Modifier parents',                   'parents'),
      ('enseignants.voir',        'Voir enseignants',                   'enseignants'),
      ('enseignants.creer',       'Créer enseignant',                   'enseignants'),
      ('enseignants.affecter',    'Affecter enseignant',                'enseignants'),
      ('config.voir',             'Voir config',                        'config'),
      ('config.modifier',         'Modifier config',                    'config'),
      ('config.annee_scolaire',   'Gérer années scolaires',             'config'),
      ('config.coefficients',     'Modifier coefficients',              'config'),
      ('rapports.voir',           'Voir rapports',                      'rapports'),
      ('rapports.exporter',       'Exporter données',                   'rapports'),
      ('admin.utilisateurs',      'Gérer utilisateurs',                 'admin'),
      ('admin.audit',             'Journaux d''audit',                  'admin')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Affecter les permissions aux rôles via la fonction existante
  await database.raw(`
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
      'rapports.voir','rapports.exporter',
      'admin.utilisateurs','admin.audit'
    ]);
    SELECT affecter_permissions('enseignant', ARRAY[
      'notes.voir_classe','notes.saisir','notes.publier',
      'evaluations.creer','evaluations.modifier',
      'absences.faire_appel','absences.voir_classe',
      'discipline.saisir_incident',
      'edt.voir','edt.modifier_ponctuel',
      'eleves.voir',
      'rapports.voir'
    ]);
    SELECT affecter_permissions('eleve', ARRAY[
      'notes.voir_eleve','bulletins.voir','edt.voir'
    ]);
    SELECT affecter_permissions('parent', ARRAY[
      'notes.voir_eleve','bulletins.voir','absences.voir_eleve','edt.voir'
    ]);
  `);

  // 1. Établissement
  const [etab] = await database('etablissements')
    .insert({
      nom: 'Lycée Test Blaise Diagne',
      code_officiel: 'TEST_LBD',
      type: 'lycee',
      pays: 'Sénégal',
      region: 'Dakar',
      ville: 'Dakar',
      actif: true,
    })
    .returning('*');

  // 2. Année scolaire
  const [annee] = await database('annees_scolaires')
    .insert({
      etablissement_id: etab.id,
      libelle: '2024-2025',
      date_debut: '2024-10-01',
      date_fin: '2025-07-15',
      nb_periodes: 3,
      type_periode: 'trimestre',
      est_courante: true,
    })
    .returning('*');

  // 3. Périodes
  const periodes = await database('periodes')
    .insert([
      { annee_scolaire_id: annee.id, numero: 1, libelle: 'Trimestre 1', date_debut: '2024-10-01', date_fin: '2024-12-20' },
      { annee_scolaire_id: annee.id, numero: 2, libelle: 'Trimestre 2', date_debut: '2025-01-06', date_fin: '2025-03-28' },
      { annee_scolaire_id: annee.id, numero: 3, libelle: 'Trimestre 3', date_debut: '2025-04-07', date_fin: '2025-07-15' },
    ])
    .returning('*');

  // 4. Niveau + Classe
  const [niveau] = await database('niveaux')
    .insert({
      etablissement_id: etab.id,
      nom: 'Terminale',
      nom_court: 'Tle',
      cycle: 'lycee',
      ordre: 12,
    })
    .returning('*');

  const [classe] = await database('classes')
    .insert({
      niveau_id: niveau.id,
      nom: 'Term S1',
      annee_scolaire_id: annee.id,
      effectif_max: 45,
    })
    .returning('*');

  // 5. Directeur
  const mdpHash = await bcrypt.hash('Test1234!', 10);

  const [directeur] = await database('utilisateurs')
    .insert({
      etablissement_id: etab.id,
      nom: 'Diallo',
      prenom: 'Moussa',
      email: 'directeur@test.sn',
      telephone: '+221770000001',
      mot_de_passe_hash: mdpHash,
      actif: true,
    })
    .returning('*');

  const roleDir = await database('roles').where({ code: 'directeur' }).first();
  await database('utilisateur_roles').insert({
    utilisateur_id: directeur.id,
    role_id: roleDir.id,
    etablissement_id: etab.id,
    actif: true,
  });

  // 6. Enseignant
  const [enseignantUser] = await database('utilisateurs')
    .insert({
      etablissement_id: etab.id,
      nom: 'Ndiaye',
      prenom: 'Fatou',
      email: 'enseignant@test.sn',
      telephone: '+221770000002',
      mot_de_passe_hash: mdpHash,
      actif: true,
    })
    .returning('*');

  const roleEns = await database('roles').where({ code: 'enseignant' }).first();
  await database('utilisateur_roles').insert({
    utilisateur_id: enseignantUser.id,
    role_id: roleEns.id,
    etablissement_id: etab.id,
    actif: true,
  });

  const [enseignant] = await database('enseignants')
    .insert({
      utilisateur_id: enseignantUser.id,
      matricule_fonct: 'ENS-001',
      specialite: 'Mathématiques',
      type_contrat: 'titulaire',
    })
    .returning('*');

  // 7. Trois élèves
  const elevesRaw = [
    { nom: 'Traoré', prenom: 'Aminata', genre: 'F', matricule: 'ELV-001', tel: '+221770000010' },
    { nom: 'Diop',   prenom: 'Mouhamadou', genre: 'M', matricule: 'ELV-002', tel: '+221770000011' },
    { nom: 'Ba',     prenom: 'Mariama', genre: 'F', matricule: 'ELV-003', tel: '+221770000012' },
  ];

  const eleves = [];
  for (const e of elevesRaw) {
    const [user] = await database('utilisateurs')
      .insert({
        etablissement_id: etab.id,
        nom: e.nom, prenom: e.prenom, genre: e.genre,
        telephone: e.tel, actif: true,
      })
      .returning('*');

    const roleEl = await database('roles').where({ code: 'eleve' }).first();
    await database('utilisateur_roles').insert({
      utilisateur_id: user.id, role_id: roleEl.id,
      etablissement_id: etab.id, actif: true,
    });

    const [eleve] = await database('eleves')
      .insert({ utilisateur_id: user.id, matricule: e.matricule, date_inscription: '2024-10-01' })
      .returning('*');

    const [inscription] = await database('inscriptions')
      .insert({ eleve_id: eleve.id, classe_id: classe.id, annee_scolaire_id: annee.id, statut: 'actif' })
      .returning('*');

    eleves.push({ user, eleve, inscription });
  }

  // 8. Politique de sécurité
  await database('politique_securite')
    .insert({ etablissement_id: etab.id })
    .onConflict('etablissement_id')
    .ignore();

  return {
    etablissement: etab,
    annee,
    periodes,
    niveau,
    classe,
    directeur,
    enseignantUser,
    enseignant,
    eleves,
    mdpClair: 'Test1234!',
  };
}

// ── App Express d'intégration ──────────────────────────────────

/**
 * Crée l'app Express avec les vrais routeurs et le vrai pool.
 * Le pool.getDB() est patché pour retourner la connexion de test.
 */
function createIntegrationApp() {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.NODE_ENV = 'test';

  // Patcher le pool pour utiliser la base de test
  const pool = require('../../src/infrastructure/database/pool');
  pool.getDB = () => getTestDB();
  pool.connectDB = async () => {
    const database = getTestDB();
    await database.raw('SELECT 1');
    return database;
  };

  const errorHandler = require('../../src/middleware/error.middleware');
  const { notFound } = require('../../src/middleware/notFound.middleware');

  const authRouter        = require('../../src/domains/02-acteurs/auth/auth.routes');
  const identitesRouter   = require('../../src/domains/01-identites/identites.routes');
  const elevesRouter      = require('../../src/domains/02-acteurs/eleves/eleves.routes');
  const parentsRouter     = require('../../src/domains/02-acteurs/parents/parents.routes');
  const enseignantsRouter = require('../../src/domains/02-acteurs/enseignants/enseignants.routes');
  const pedagogieRouter   = require('../../src/domains/03-pedagogie/pedagogie.routes');
  const vieScolaireRouter = require('../../src/domains/04-vie-scolaire/vie-scolaire.routes');
  const securiteRouter    = require('../../src/domains/05-securite/securite.routes');

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const PREFIX = '/api/v1';
  app.use(PREFIX, authRouter);
  app.use(PREFIX, identitesRouter);
  app.use(PREFIX, elevesRouter);
  app.use(PREFIX, parentsRouter);
  app.use(PREFIX, enseignantsRouter);
  app.use(PREFIX, pedagogieRouter);
  app.use(PREFIX, vieScolaireRouter);
  app.use(PREFIX, securiteRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// ── Token + Session en base ────────────────────────────────────

/**
 * Crée une session en base et retourne le token JWT.
 * Le middleware authentifier() vérifie la session en base,
 * donc on doit en créer une vraie.
 */
async function creerSession(utilisateurId, etablissementId) {
  const database = getTestDB();

  const token = jwt.sign(
    { utilisateur_id: utilisateurId, etablissement_id: etablissementId },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  await database('sessions').insert({
    utilisateur_id: utilisateurId,
    etablissement_id: etablissementId,
    token_hash: tokenHash,
    ip_address: '127.0.0.1',
    user_agent: 'jest-integration',
    appareil: 'desktop',
    canal_connexion: 'web',
    derniere_activite: database.raw('NOW()'),
    expire_at: database.raw("NOW() + INTERVAL '1 hour'"),
    revoquee: false,
  });

  return token;
}

module.exports = {
  getTestDB,
  closeTestDB,
  truncateData,
  seedTestData,
  createIntegrationApp,
  creerSession,
  JWT_SECRET,
};
