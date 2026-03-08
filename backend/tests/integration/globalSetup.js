'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * globalSetup — Crée la base de test et exécute les migrations.
 *
 * Utilise `docker exec` sur le conteneur ecole_postgres
 * (psql n'est pas installé localement).
 */
module.exports = async function globalSetup() {
  const DB_NAME = 'ecole_manager_test';
  const DB_USER = process.env.POSTGRES_USER || 'ecole_user';
  const CONTAINER = process.env.PG_CONTAINER || 'ecole_postgres';

  const opts = { stdio: 'pipe', timeout: 60000 };

  /**
   * Exécute une commande SQL via docker exec psql.
   */
  function psql(database, sql) {
    return execSync(
      `docker exec ${CONTAINER} psql -U ${DB_USER} -d ${database} -c "${sql}"`,
      opts
    ).toString();
  }

  /**
   * Exécute un fichier SQL copié dans le conteneur.
   */
  function psqlFile(database, hostPath) {
    const containerPath = `/tmp/${path.basename(hostPath)}`;
    // Copier le fichier dans le conteneur
    execSync(`docker cp "${hostPath}" ${CONTAINER}:${containerPath}`, opts);
    // Exécuter
    return execSync(
      `docker exec ${CONTAINER} psql -U ${DB_USER} -d ${database} -f ${containerPath}`,
      opts
    ).toString();
  }

  // 1. Drop + Create la base de test
  try {
    psql('postgres', `DROP DATABASE IF EXISTS ${DB_NAME};`);
  } catch { /* ignore */ }

  psql('postgres', `CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};`);
  console.log(`✓ Base ${DB_NAME} créée`);

  // 2. Appliquer les migrations
  const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'migrations');

  const migrationFiles = [
    '000_extensions.sql',
    '000_extensions_types.sql',
    '001_domaine1_identites.sql',
    '002_domaine2_acteurs.sql',
    '003_domaine3_pedagogie.sql',
    '004_domaine4_vie_scolaire.sql',
    '005_domaine5_securite.sql',
    '006_donnees_reference.sql',
    '007_vues_et_fonctions.sql',
  ];

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  ⚠ ${file} non trouvé, ignoré`);
      continue;
    }
    try {
      psqlFile(DB_NAME, filePath);
      console.log(`  ✓ ${file}`);
    } catch (err) {
      const stderr = err.stderr?.toString().slice(0, 300) || err.message;
      console.error(`  ✗ ${file} — ${stderr}`);
      throw new Error(`Migration ${file} échouée`);
    }
  }

  // 3. Corriger journal_audit si la table partitionnée n'a pas été créée
  try {
    psql(DB_NAME, "SELECT 1 FROM journal_audit LIMIT 0;");
  } catch {
    console.log('  ⚠ journal_audit partitionnée absente — création simple');
    psql(DB_NAME, `
      CREATE TABLE IF NOT EXISTS journal_audit (
        id BIGSERIAL PRIMARY KEY,
        etablissement_id UUID REFERENCES etablissements(id) ON DELETE SET NULL,
        utilisateur_id UUID REFERENCES utilisateurs(id) ON DELETE SET NULL,
        session_id UUID,
        ip_address INET,
        action VARCHAR(80) NOT NULL,
        resultat VARCHAR(10) NOT NULL DEFAULT 'succes',
        table_cible VARCHAR(60),
        enregistrement_id UUID,
        valeur_avant JSONB,
        valeur_apres JSONB,
        details JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  console.log('✓ Migrations appliquées');
};
