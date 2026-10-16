'use strict';

/**
 * Audit des mots de passe prévisibles déjà en base.
 *
 * Un mot de passe haché ne se lit pas, mais on peut tester s'il est l'un des
 * mots de passe les plus évidents : le téléphone du compte (sous toutes ses
 * formes — c'était l'ancien défaut des enseignants), un mot de passe courant
 * (« 123456 », « password »…), le code de l'établissement, le nom ou le
 * prénom. Les comptes trouvés sont marqués `mdp_a_changer = TRUE` : au
 * prochain accès, ils doivent choisir un nouveau mot de passe conforme.
 *
 * - Simulation par défaut : n'écrit rien tant que --appliquer n'est pas passé
 * - Ne journalise JAMAIS le mot de passe trouvé : seulement l'id du compte et
 *   la catégorie de cause
 * - Les comptes déjà marqués (mdp_a_changer) et les comptes sans mot de passe
 *   (parents, élèves) sont ignorés
 * - Idempotent : une seconde exécution ne trouve plus rien à changer
 * - Les sessions déjà ouvertes gardent leur cache Redis (10 min au plus) avant
 *   de voir le drapeau ; les nouvelles connexions le voient tout de suite
 *
 * Usage :
 *   npm run auditer:mots-de-passe                 # simulation
 *   npm run auditer:mots-de-passe -- --appliquer  # écriture
 */

require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const { configConnexion } = require('./migrate');
const { variantesTelephone } = require('./telephone');

// Plancher d'un mot de passe testable : la connexion exige 6 caractères
const LONGUEUR_MIN_TESTEE = 6;

const MOTS_DE_PASSE_COURANTS = [
  '123456', '1234567', '12345678', '123456789', '0123456789', '000000', '111111',
  'password', 'Password1', 'passer', 'passer123', 'motdepasse', 'azerty', 'azerty123',
  'qwerty', 'qwerty123', 'admin', 'admin123', 'changeme', 'ecole', 'ecole123',
  'bienvenue', 'bienvenue1', 'dakar', 'senegal', 'abidjan',
];

/**
 * Candidats à tester pour un compte, classés par cause.
 * @returns {Array<{cause: string, valeur: string}>}
 */
function candidatsPour({ telephone, telephone_2, nom, prenom, code_officiel, pays }) {
  const liste = [];
  const ajouter = (cause, valeur) => {
    if (typeof valeur === 'string' && valeur.length >= LONGUEUR_MIN_TESTEE) liste.push({ cause, valeur });
  };

  for (const tel of [telephone, telephone_2]) {
    if (!tel) continue;
    for (const v of variantesTelephone(tel, pays)) ajouter('telephone', v);
    ajouter('telephone', tel.replace(/\D/g, ''));
  }
  for (const v of MOTS_DE_PASSE_COURANTS) ajouter('courant', v);
  if (code_officiel) {
    for (const v of [code_officiel, code_officiel.toLowerCase()]) ajouter('code_etablissement', v);
  }
  for (const id of [nom, prenom]) {
    if (!id) continue;
    for (const v of [id, id.toLowerCase(), id.toUpperCase()]) ajouter('identite', v);
  }
  return liste;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{appliquer?: boolean, log?: Function, comparer?: Function}} [options]
 *        `comparer(clair, hash)` : bcrypt.compare par défaut (injectable pour les tests)
 * @returns {Promise<{examines:number, faibles:{id:string,cause:string}[], parCause:object}>}
 */
async function auditerMotsDePasse(pool, { appliquer = false, log = console.log, comparer = bcrypt.compare } = {}) {
  const { rows } = await pool.query(
    `SELECT u.id, u.nom, u.prenom, u.telephone, u.telephone_2, u.mot_de_passe_hash,
            e.code_officiel, e.pays
       FROM utilisateurs u
       JOIN etablissements e ON e.id = u.etablissement_id
      WHERE u.mot_de_passe_hash IS NOT NULL
        AND u.actif = TRUE
        AND u.mdp_a_changer = FALSE
      ORDER BY u.created_at`
  );

  const resultat = { examines: rows.length, faibles: [], parCause: {} };

  for (const compte of rows) {
    let trouve = null;
    for (const { cause, valeur } of candidatsPour(compte)) {
      if (await comparer(valeur, compte.mot_de_passe_hash)) { trouve = cause; break; }
    }
    if (!trouve) continue;

    resultat.faibles.push({ id: compte.id, cause: trouve });
    resultat.parCause[trouve] = (resultat.parCause[trouve] || 0) + 1;
    log(`${appliquer ? 'MAJ ' : 'SIM '} ${compte.id}  cause=${trouve}`);
    if (appliquer) {
      await pool.query('UPDATE utilisateurs SET mdp_a_changer = TRUE WHERE id = $1', [compte.id]);
    }
  }

  return resultat;
}

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const pool = new Pool(configConnexion());
  try {
    const res = await auditerMotsDePasse(pool, { appliquer });
    console.log(`\n${appliquer ? 'Appliqué' : 'Simulation'} : ${res.faibles.length} compte(s) à mot de passe prévisible sur ${res.examines} examiné(s)`);
    for (const [cause, n] of Object.entries(res.parCause)) console.log(`  - ${cause} : ${n}`);
    if (!appliquer && res.faibles.length) console.log('Relancer avec --appliquer pour exiger le changement au prochain accès.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { auditerMotsDePasse, candidatsPour, MOTS_DE_PASSE_COURANTS };
