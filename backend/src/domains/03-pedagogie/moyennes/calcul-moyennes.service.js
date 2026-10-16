'use strict';

/**
 * Recalcul des moyennes d'une classe pour une période : moyennes par matière (formule francophone de
 * calculer_moyenne_matiere), rangs par matière, moyennes générales pondérées et rangs généraux.
 *
 * Source UNIQUE du calcul : utilisée par POST /moyennes/calculer et par le worker BullMQ (calcul-moyennes) déclenché
 * à la publication des notes. Le worker appelait avant des fonctions SQL qui ne persistent rien ou n'existent pas
 * (calculer_moyenne_generale) : aucune moyenne n'était jamais enregistrée par ce chemin.
 *
 * L'appelant a déjà vérifié que la classe appartient à l'établissement de la session.
 *
 * @returns {Promise<{ nbCalculees: number, inscriptions: object[], matieres: object[] }>}
 */
const { v4: uuid } = require('uuid');

async function recalculerMoyennesClasse(db, { classe_id, periode_id, matiere_id }) {
  const inscriptions = await db('inscriptions').where({ classe_id, statut: 'actif' }).select('id', 'eleve_id');

      let matieres;
      if (matiere_id) {
        matieres = [{ matiere_id }];
      } else {
        matieres = await db('affectations_enseignants').where({ classe_id }).whereNull('date_fin').distinct('matiere_id');
      }

      let nbCalculees = 0;

      await db.transaction(async trx => {
        for (const insc of inscriptions) {
          for (const mat of matieres) {
            const result = await trx.raw('SELECT * FROM calculer_moyenne_matiere(?, ?, ?)', [insc.id, mat.matiere_id, periode_id]);
            const calc = result.rows[0];
            if (!calc) continue;

            const configCoef = await trx('configs_matieres_niveau as cmn')
              .join('classes as c', 'c.id', trx.raw('?', [classe_id]))
              .where({ 'cmn.matiere_id': mat.matiere_id, 'cmn.niveau_id': trx.raw('c.niveau_id') })
              .first('cmn.coefficient');

            const coefficient = configCoef ? parseFloat(configCoef.coefficient) : 1;

            await trx.raw(`
              INSERT INTO moyennes_matieres (id, inscription_id, matiere_id, periode_id, moyenne, coefficient, points,
                somme_notes_devoirs, nb_devoirs_comptes, note_composition, denominateur, est_complete, calculee_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
              ON CONFLICT (inscription_id, matiere_id, periode_id) DO UPDATE SET
                moyenne=EXCLUDED.moyenne, coefficient=EXCLUDED.coefficient, points=EXCLUDED.points,
                somme_notes_devoirs=EXCLUDED.somme_notes_devoirs, nb_devoirs_comptes=EXCLUDED.nb_devoirs_comptes,
                note_composition=EXCLUDED.note_composition, denominateur=EXCLUDED.denominateur,
                est_complete=EXCLUDED.est_complete, calculee_at=NOW()
            `, [uuid(), insc.id, mat.matiere_id, periode_id, calc.moyenne, coefficient,
                calc.moyenne ? (parseFloat(calc.moyenne) * coefficient).toFixed(2) : null,
                calc.somme_devoirs, calc.nb_devoirs_comptes, calc.note_composition, calc.denominateur, calc.est_complete ?? false]);

            nbCalculees++;
          }
        }

        // Rangs par matière
        for (const mat of matieres) {
          await trx.raw(`
            WITH rangs AS (
              SELECT mm.id, RANK() OVER (ORDER BY mm.moyenne DESC NULLS LAST) as rang, COUNT(*) OVER () as total
              FROM moyennes_matieres mm JOIN inscriptions i ON i.id = mm.inscription_id
              WHERE i.classe_id = ? AND mm.matiere_id = ? AND mm.periode_id = ? AND mm.moyenne IS NOT NULL
            ) UPDATE moyennes_matieres SET rang_dans_classe = rangs.rang, rang_sur = rangs.total
            FROM rangs WHERE moyennes_matieres.id = rangs.id
          `, [classe_id, mat.matiere_id, periode_id]);
        }

        // Moyennes générales
        for (const insc of inscriptions) {
          const totaux = await trx('moyennes_matieres')
            .where({ inscription_id: insc.id, periode_id }).whereNotNull('moyenne')
            .select(trx.raw('SUM(points) as total_points'), trx.raw('SUM(coefficient) as total_coefficients'))
            .first();

          if (totaux && parseFloat(totaux.total_coefficients) > 0) {
            const moyGen = (parseFloat(totaux.total_points) / parseFloat(totaux.total_coefficients)).toFixed(2);
            await trx.raw(`
              INSERT INTO moyennes_generales (id, inscription_id, periode_id, total_points, total_coefficients, moyenne_generale, calculee_at)
              VALUES (?, ?, ?, ?, ?, ?, NOW())
              ON CONFLICT (inscription_id, periode_id) DO UPDATE SET
                total_points=EXCLUDED.total_points, total_coefficients=EXCLUDED.total_coefficients,
                moyenne_generale=EXCLUDED.moyenne_generale, calculee_at=NOW()
            `, [uuid(), insc.id, periode_id, totaux.total_points, totaux.total_coefficients, moyGen]);
          }
        }

        // Rangs généraux
        await trx.raw(`
          WITH rangs AS (
            SELECT mg.id, RANK() OVER (ORDER BY mg.moyenne_generale DESC NULLS LAST) as rang, COUNT(*) OVER () as total
            FROM moyennes_generales mg JOIN inscriptions i ON i.id = mg.inscription_id
            WHERE i.classe_id = ? AND mg.periode_id = ? AND mg.moyenne_generale IS NOT NULL
          ) UPDATE moyennes_generales SET rang = rangs.rang, rang_sur = rangs.total
          FROM rangs WHERE moyennes_generales.id = rangs.id
        `, [classe_id, periode_id]);
      });

  return { nbCalculees, inscriptions, matieres };
}

module.exports = { recalculerMoyennesClasse };
