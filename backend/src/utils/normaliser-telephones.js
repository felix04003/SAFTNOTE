'use strict';

/**
 * Reprise de données : met en E.164 les numéros de téléphone déjà stockés
 * (utilisateurs.telephone / telephone_2) avant l'introduction de la
 * normalisation (utils/telephone.js).
 *
 * - Simulation par défaut : n'écrit rien tant que --appliquer n'est pas passé
 * - Le pays par défaut d'un numéro sans indicatif est celui de l'établissement
 * - Un numéro inexploitable est laissé tel quel et listé
 * - Un conflit (deux comptes qui deviendraient le même numéro, ou numéro déjà
 *   pris) est listé et ignoré : à arbitrer à la main
 * - Les otp_verifications en cours sont sans importance (expirent en 10 min)
 *
 * Usage :
 *   npm run normaliser:telephones                # simulation
 *   npm run normaliser:telephones -- --appliquer # écriture
 */

require('dotenv').config();

const { Pool } = require('pg');
const { configConnexion } = require('./migrate');
const { normaliserTelephone } = require('./telephone');

/**
 * @param {import('pg').Pool} pool
 * @param {{appliquer?: boolean, log?: Function}} [options]
 * @returns {Promise<{modifies:number, inchanges:number, invalides:object[], conflits:object[]}>}
 */
async function normaliserTelephones(pool, { appliquer = false, log = console.log } = {}) {
  const { rows } = await pool.query(
    `SELECT u.id, u.telephone, u.telephone_2, e.pays
       FROM utilisateurs u
       JOIN etablissements e ON e.id = u.etablissement_id
      WHERE u.telephone IS NOT NULL OR u.telephone_2 IS NOT NULL
      ORDER BY u.created_at`
  );

  const pris = new Set(rows.map(r => r.telephone).filter(Boolean));
  const resultat = { modifies: 0, inchanges: 0, invalides: [], conflits: [] };

  for (const r of rows) {
    const maj = {};
    for (const col of ['telephone', 'telephone_2']) {
      const brut = r[col];
      if (!brut) continue;
      const norme = normaliserTelephone(brut, r.pays);
      if (!norme) { resultat.invalides.push({ id: r.id, colonne: col, valeur: brut }); continue; }
      if (norme === brut) continue;
      // telephone est UNIQUE en base : ne pas écraser un autre compte
      if (col === 'telephone' && pris.has(norme)) {
        resultat.conflits.push({ id: r.id, valeur: brut, normalise: norme });
        continue;
      }
      maj[col] = norme;
    }

    if (!Object.keys(maj).length) { resultat.inchanges++; continue; }

    if (maj.telephone) { pris.delete(r.telephone); pris.add(maj.telephone); }
    resultat.modifies++;
    log(`${appliquer ? 'MAJ ' : 'SIM '} ${r.id}  ${JSON.stringify(maj)}`);
    if (appliquer) {
      const cols = Object.keys(maj);
      await pool.query(
        `UPDATE utilisateurs SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [r.id, ...cols.map(c => maj[c])]
      );
    }
  }

  return resultat;
}

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const pool = new Pool(configConnexion());
  try {
    const res = await normaliserTelephones(pool, { appliquer });
    console.log(`\n${appliquer ? 'Appliqué' : 'Simulation'} : ${res.modifies} compte(s) à modifier, ${res.inchanges} déjà conformes`);
    if (res.invalides.length) console.log('Numéros inexploitables (laissés tels quels) :', res.invalides);
    if (res.conflits.length)  console.log('Conflits (ignorés, à arbitrer) :', res.conflits);
    if (!appliquer && res.modifies) console.log('Relancer avec --appliquer pour écrire.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

module.exports = { normaliserTelephones };
