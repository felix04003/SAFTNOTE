'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');
const { getOrSet, invalidatePattern } = require('../../../infrastructure/cache/redis');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── Helper ───────────────────────────────────────────────────────
async function getAnneeCourante(db, etablissementId) {
  const annee = await db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id', 'libelle');
  if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');
  return annee;
}

// ═════════════════════════════════════════════════════════════════
// GET /moyennes/classe/:classeId
// Moyennes par matière pour une classe entière
// ═════════════════════════════════════════════════════════════════
async function fetchMoyennesClasse(db, classeId, etablissementId, periodeIdParam) {
  const annee = await getAnneeCourante(db, etablissementId);

  const classe = await db('classes as c')
    .join('niveaux as n', 'n.id', 'c.niveau_id')
    .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
    .where({ 'c.id': classeId, 'a.etablissement_id': etablissementId, 'a.est_courante': true })
    .first('c.id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"), 'n.nom as niveau');

  if (!classe) return null;

  let periodeId = periodeIdParam;
  if (!periodeId) {
    const periode = await db('periodes')
      .where({ annee_scolaire_id: annee.id })
      .orderBy('numero', 'desc')
      .first('id');
    if (periode) periodeId = periode.id;
  }

  const moyennes = await db('moyennes_matieres as mm')
    .join('inscriptions as i', 'i.id', 'mm.inscription_id')
    .join('matieres as m',     'm.id', 'mm.matiere_id')
    .join('eleves as el',      'el.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id',  'el.utilisateur_id')
    .where({ 'i.classe_id': classeId, 'mm.periode_id': periodeId, 'i.statut': 'actif' })
    .orderBy(['m.nom', 'u.nom', 'u.prenom'])
    .select(
      'u.id as eleve_id', 'u.nom', 'u.prenom',
      'm.id as matiere_id', 'm.nom as matiere', 'm.code as matiere_code',
      'mm.moyenne', 'mm.coefficient', 'mm.rang_dans_classe',
      'mm.appreciation_enseignant', 'mm.est_complete'
    );

  const parMatiere = {};
  for (const m of moyennes) {
    if (!parMatiere[m.matiere_id]) {
      parMatiere[m.matiere_id] = {
        matiere_id: m.matiere_id, matiere: m.matiere, code: m.matiere_code,
        coefficient: m.coefficient, eleves: [],
      };
    }
    parMatiere[m.matiere_id].eleves.push({
      eleve_id: m.eleve_id, nom: m.nom, prenom: m.prenom,
      moyenne: m.moyenne, rang: m.rang_dans_classe, appreciation: m.appreciation_enseignant,
    });
  }

  const resultats = Object.values(parMatiere).map(mat => {
    const notes = mat.eleves.filter(e => e.moyenne !== null).map(e => parseFloat(e.moyenne));
    return {
      ...mat,
      stats: {
        moyenne_classe: notes.length > 0 ? (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(2) : null,
        note_min: notes.length > 0 ? Math.min(...notes) : null,
        note_max: notes.length > 0 ? Math.max(...notes) : null,
        nb_eleves: mat.eleves.length,
      },
    };
  });

  return { classe: classe.classe, niveau: classe.niveau, annee: annee.libelle, matieres: resultats };
}

router.get('/moyennes/classe/:classeId', auth, isoler, perm('notes.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const { periode_id } = req.query;
    const periodeKey = periode_id || 'courante';
    const cle = `moyennes_classe:${req.params.classeId}:${periodeKey}`;

    let data;
    try {
      data = await getOrSet(cle, () => fetchMoyennesClasse(db, req.params.classeId, req.etablissement_id, periode_id), 300);
    } catch {
      data = await fetchMoyennesClasse(db, req.params.classeId, req.etablissement_id, periode_id);
    }

    if (!data) throw ApiError.nonTrouve('Classe introuvable');
    return ok(res, data);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /moyennes/eleve/:eleveId
// Moyennes d'un élève pour toutes les matières et périodes
// ═════════════════════════════════════════════════════════════════
router.get('/moyennes/eleve/:eleveId', auth, isoler, perm('notes.voir_eleve'), async (req, res, next) => {
  try {
    const db = getDB();

    const inscription = await db('inscriptions as i')
      .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
      .join('classes as c', 'c.id', 'i.classe_id')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .join('eleves as el', 'el.id', 'i.eleve_id')
      .where({
        'el.utilisateur_id': req.params.eleveId,
        'a.etablissement_id': req.etablissement_id,
        'a.est_courante': true, 'i.statut': 'actif',
      })
      .first('i.id as inscription_id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"), 'a.libelle as annee');

    if (!inscription) throw ApiError.nonTrouve('Inscription courante introuvable');

    const [moyennesMatieres, moyennesGenerales] = await Promise.all([
      db('moyennes_matieres as mm')
        .join('matieres as m', 'm.id', 'mm.matiere_id')
        .join('periodes as p', 'p.id', 'mm.periode_id')
        .where({ 'mm.inscription_id': inscription.inscription_id })
        .orderBy(['m.nom', 'p.numero'])
        .select(
          'm.nom as matiere', 'm.code as matiere_code',
          'mm.moyenne', 'mm.coefficient', 'mm.points',
          'mm.rang_dans_classe', 'mm.rang_sur',
          'mm.appreciation_enseignant', 'mm.est_complete',
          'p.numero as trimestre', 'p.libelle as periode'
        ),
      db('moyennes_generales as mg')
        .join('periodes as p', 'p.id', 'mg.periode_id')
        .where({ 'mg.inscription_id': inscription.inscription_id })
        .orderBy('p.numero')
        .select(
          'mg.moyenne_generale', 'mg.rang', 'mg.rang_sur',
          'mg.mention', 'mg.decision_conseil', 'mg.appreciation_conseil', 'mg.note_conduite',
          'p.numero as trimestre', 'p.libelle as periode'
        ),
    ]);

    return ok(res, {
      classe: inscription.classe, annee: inscription.annee,
      moyennes_matieres: moyennesMatieres, moyennes_generales: moyennesGenerales,
    });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /moyennes/calculer
// Recalcul batch des moyennes (admin/directeur)
// ═════════════════════════════════════════════════════════════════
router.post('/moyennes/calculer', auth, isoler, perm('moyennes.calculer'),
  valider(z.object({
    classe_id:  z.string().uuid(),
    periode_id: z.string().uuid(),
    matiere_id: z.string().uuid().optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();
      const { classe_id, periode_id, matiere_id } = req.body;

      // Vérifier la classe
      const classe = await db('classes as c')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'c.id': classe_id, 'a.etablissement_id': req.etablissement_id })
        .first('c.id');
      if (!classe) throw ApiError.nonTrouve('Classe introuvable');

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

      logger.info('Moyennes recalculées', { classe_id, periode_id, nb: nbCalculees, par: req.session.utilisateur_id });

      try { await invalidatePattern(`moyennes_classe:${classe_id}`); } catch { /* Redis down */ }

      return ok(res, {
        message: `${nbCalculees} moyennes recalculées`,
        nb_eleves: inscriptions.length,
        nb_matieres: matieres.length,
      });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// GET /moyennes/classement/:classeId
// Classement des élèves par moyenne générale
// ═════════════════════════════════════════════════════════════════
router.get('/moyennes/classement/:classeId', auth, isoler, perm('notes.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const { periode_id } = req.query;
    const annee = await getAnneeCourante(db, req.etablissement_id);

    const classe = await db('classes as c')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
      .where({ 'c.id': req.params.classeId, 'a.etablissement_id': req.etablissement_id, 'a.est_courante': true })
      .first('c.id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"));

    if (!classe) throw ApiError.nonTrouve('Classe introuvable');

    let periodeId = periode_id;
    if (!periodeId) {
      const periode = await db('periodes').where({ annee_scolaire_id: annee.id }).orderBy('numero', 'desc').first('id');
      if (periode) periodeId = periode.id;
    }

    const classement = await db('moyennes_generales as mg')
      .join('inscriptions as i', 'i.id', 'mg.inscription_id')
      .join('eleves as el',      'el.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id',  'el.utilisateur_id')
      .where({ 'i.classe_id': req.params.classeId, 'mg.periode_id': periodeId, 'i.statut': 'actif' })
      .orderBy('mg.rang', 'asc')
      .select(
        'u.id as eleve_id', 'u.nom', 'u.prenom', 'u.photo_url', 'el.matricule',
        'mg.moyenne_generale', 'mg.rang', 'mg.rang_sur',
        'mg.total_points', 'mg.total_coefficients',
        'mg.mention', 'mg.decision_conseil', 'mg.note_conduite'
      );

    const notes = classement.filter(e => e.moyenne_generale !== null).map(e => parseFloat(e.moyenne_generale));
    const stats = {
      effectif: classement.length,
      moyenne_classe: notes.length > 0 ? (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(2) : null,
      note_min: notes.length > 0 ? Math.min(...notes).toFixed(2) : null,
      note_max: notes.length > 0 ? Math.max(...notes).toFixed(2) : null,
      nb_admis: notes.filter(n => n >= 10).length,
      taux_reussite: notes.length > 0 ? ((notes.filter(n => n >= 10).length / notes.length) * 100).toFixed(1) + '%' : null,
    };

    return ok(res, { classe: classe.classe, annee: annee.libelle, classement, stats });
  } catch (err) { next(err); }
});

module.exports = router;
