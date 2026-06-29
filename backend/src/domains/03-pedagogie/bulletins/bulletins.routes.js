'use strict';

const express    = require('express');
const { z }      = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, liste, paginee, getPagination } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const logger         = require('../../../utils/logger');
const { enqueuerGenerationBulletins, getQueue, QUEUES } = require('../../../infrastructure/queue/bullmq');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /bulletins/classes — Résumé par classe (dashboard directeur)
// ═════════════════════════════════════════════════════════════════
router.get('/bulletins/classes', auth, isoler, perm('bulletins.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { periode_id } = req.query;

    const annee = await db('annees_scolaires')
      .where({ etablissement_id: req.etablissement_id, est_courante: true })
      .first('id');
    if (!annee) return liste(res, []);

    // Période par défaut = dernière période avec des moyennes
    let periodeId = periode_id;
    if (!periodeId) {
      const der = await db('periodes as p')
        .join('moyennes_generales as mg', 'mg.periode_id', 'p.id')
        .join('inscriptions as i', 'i.id', 'mg.inscription_id')
        .join('classes as c', 'c.id', 'i.classe_id')
        .where('c.annee_scolaire_id', annee.id)
        .orderBy('p.numero', 'desc')
        .first('p.id');
      periodeId = der?.id || null;
    }

    if (!periodeId) return liste(res, []);

    const classes = await db('classes as c')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .where('c.annee_scolaire_id', annee.id)
      .orderBy(['n.ordre', 'c.nom'])
      .select(
        'c.id',
        db.raw("n.nom || ' ' || c.nom AS classe"),
        // Effectif
        db.raw(`(SELECT COUNT(*) FROM inscriptions i WHERE i.classe_id = c.id AND i.statut = 'actif') as effectif`),
        // Bulletins générés
        db.raw(`(SELECT COUNT(*) FROM moyennes_generales mg
                 JOIN inscriptions i ON i.id = mg.inscription_id
                 WHERE i.classe_id = c.id AND mg.periode_id = ? AND mg.bulletin_genere = TRUE) as generes`, [periodeId]),
        // Bulletins validés
        db.raw(`(SELECT COUNT(*) FROM moyennes_generales mg
                 JOIN inscriptions i ON i.id = mg.inscription_id
                 WHERE i.classe_id = c.id AND mg.periode_id = ? AND mg.valide_at IS NOT NULL) as valides`, [periodeId]),
        // Moyenne classe
        db.raw(`(SELECT ROUND(AVG(mg.moyenne_generale)::NUMERIC, 1) FROM moyennes_generales mg
                 JOIN inscriptions i ON i.id = mg.inscription_id
                 WHERE i.classe_id = c.id AND mg.periode_id = ? AND mg.moyenne_generale IS NOT NULL) as moyenne_classe`, [periodeId]),
        // 1er de classe
        db.raw(`(SELECT u.prenom || ' ' || u.nom FROM moyennes_generales mg
                 JOIN inscriptions i ON i.id = mg.inscription_id
                 JOIN eleves el ON el.id = i.eleve_id
                 JOIN utilisateurs u ON u.id = el.utilisateur_id
                 WHERE i.classe_id = c.id AND mg.periode_id = ? AND mg.rang = 1
                 LIMIT 1) as premier_classe`, [periodeId]),
        // Taux de réussite (>= 10/20)
        db.raw(`CASE WHEN (SELECT COUNT(*) FROM inscriptions i WHERE i.classe_id = c.id AND i.statut = 'actif') > 0
                THEN ROUND(
                  (SELECT COUNT(*) FROM moyennes_generales mg JOIN inscriptions i ON i.id = mg.inscription_id
                   WHERE i.classe_id = c.id AND mg.periode_id = ? AND mg.moyenne_generale >= 10)::NUMERIC
                  / (SELECT COUNT(*) FROM inscriptions i WHERE i.classe_id = c.id AND i.statut = 'actif') * 100, 0
                )::TEXT || '%'
                ELSE '—' END as taux_reussite`, [periodeId])
      );

    return liste(res, classes);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /bulletins — Liste des bulletins (filtre: classe, trimestre)
// ═════════════════════════════════════════════════════════════════
router.get('/bulletins', auth, isoler, perm('bulletins.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { page, limite, offset } = getPagination(req.query);
    const { classe_id, periode_id, valide_seulement } = req.query;

    let query = db('moyennes_generales as mg')
      .join('inscriptions as i',      'i.id', 'mg.inscription_id')
      .join('eleves as el',           'el.id', 'i.eleve_id')
      .join('utilisateurs as u',      'u.id', 'el.utilisateur_id')
      .join('classes as c',           'c.id', 'i.classe_id')
      .join('niveaux as n',           'n.id', 'c.niveau_id')
      .join('periodes as p',          'p.id', 'mg.periode_id')
      .join('annees_scolaires as a',  'a.id', 'p.annee_scolaire_id')
      .where({ 'a.etablissement_id': req.etablissement_id, 'a.est_courante': true, 'i.statut': 'actif' });

    if (classe_id)  query = query.where('i.classe_id', classe_id);
    if (periode_id) query = query.where('mg.periode_id', periode_id);
    if (valide_seulement === 'true') query = query.whereNotNull('mg.valide_at');

    const [{ count }] = await query.clone().count('mg.id as count');
    const bulletins = await query
      .orderBy(['n.ordre', 'c.nom', 'p.numero', 'mg.rang'])
      .limit(limite).offset(offset)
      .select(
        'mg.id', 'u.id as eleve_id', 'u.nom', 'u.prenom', 'el.matricule',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        'p.numero as trimestre', 'p.libelle as periode',
        'mg.moyenne_generale', 'mg.rang', 'mg.rang_sur',
        'mg.mention', 'mg.decision_conseil',
        'mg.bulletin_genere', 'mg.bulletin_url', 'mg.valide_at'
      );

    return paginee(res, bulletins, { total: parseInt(count), page, limite });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /bulletins/:id — Un bulletin complet avec toutes les notes
// ═════════════════════════════════════════════════════════════════
router.get('/bulletins/:id', auth, isoler, perm('bulletins.voir'), async (req, res, next) => {
  try {
    const db = getDB();

    const bulletin = await db('moyennes_generales as mg')
      .join('inscriptions as i',      'i.id', 'mg.inscription_id')
      .join('eleves as el',           'el.id', 'i.eleve_id')
      .join('utilisateurs as u',      'u.id', 'el.utilisateur_id')
      .join('classes as c',           'c.id', 'i.classe_id')
      .join('niveaux as n',           'n.id', 'c.niveau_id')
      .join('periodes as p',          'p.id', 'mg.periode_id')
      .join('annees_scolaires as a',  'a.id', 'p.annee_scolaire_id')
      .where({ 'mg.id': req.params.id, 'a.etablissement_id': req.etablissement_id })
      .first(
        'mg.*', 'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre', 'el.matricule',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"), 'n.nom as niveau',
        'p.numero as trimestre', 'p.libelle as periode', 'a.libelle as annee_scolaire',
        'i.id as inscription_id'
      );

    if (!bulletin) throw ApiError.nonTrouve('Bulletin introuvable');

    const [matieres, conduite, etablissement] = await Promise.all([
      db('moyennes_matieres as mm')
        .join('matieres as m', 'm.id', 'mm.matiere_id')
        .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
        .where({ 'mm.inscription_id': bulletin.inscription_id, 'mm.periode_id': bulletin.periode_id })
        .orderBy(['dm.ordre', 'm.nom'])
        .select(
          'm.nom as matiere', 'm.code as matiere_code', 'm.couleur_affichage',
          'dm.nom as discipline',
          'mm.moyenne', 'mm.coefficient', 'mm.points',
          'mm.somme_notes_devoirs', 'mm.nb_devoirs_comptes',
          'mm.note_composition', 'mm.denominateur',
          'mm.rang_dans_classe', 'mm.rang_sur',
          'mm.appreciation_enseignant', 'mm.est_complete'
        ),
      db('notes_conduite')
        .where({ inscription_id: bulletin.inscription_id, periode_id: bulletin.periode_id })
        .first('valeur', 'appreciation', 'commentaire'),
      db('etablissements').where({ id: req.etablissement_id })
        .first('nom', 'code_officiel', 'ville', 'pays', 'telephone', 'logo_url'),
    ]);

    return ok(res, {
      etablissement,
      eleve: {
        nom: bulletin.nom, prenom: bulletin.prenom,
        date_naissance: bulletin.date_naissance, genre: bulletin.genre,
        matricule: bulletin.matricule, classe: bulletin.classe, niveau: bulletin.niveau,
      },
      periode: { trimestre: bulletin.trimestre, libelle: bulletin.periode, annee_scolaire: bulletin.annee_scolaire },
      matieres,
      conduite: conduite || null,
      resultat: {
        total_points: bulletin.total_points, total_coefficients: bulletin.total_coefficients,
        moyenne_generale: bulletin.moyenne_generale, rang: bulletin.rang, rang_sur: bulletin.rang_sur,
        mention: bulletin.mention, decision_conseil: bulletin.decision_conseil,
        appreciation_conseil: bulletin.appreciation_conseil,
      },
      absences: {
        justifiees: bulletin.nb_absences_justifiees,
        injustifiees: bulletin.nb_absences_injustifiees,
        retards: bulletin.nb_retards,
      },
      validation: {
        valide_at: bulletin.valide_at, bulletin_genere: bulletin.bulletin_genere,
        bulletin_url: bulletin.bulletin_url,
      },
    });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /bulletins/generer — Génération des bulletins pour une classe
// ═════════════════════════════════════════════════════════════════
router.post('/bulletins/generer', auth, isoler, perm('bulletins.generer'),
  valider(z.object({
    classe_id:  z.string().uuid(),
    periode_id: z.string().uuid(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();
      const { classe_id, periode_id } = req.body;

      const classe = await db('classes as c')
        .join('niveaux as n', 'n.id', 'c.niveau_id')
        .join('annees_scolaires as a', 'a.id', 'c.annee_scolaire_id')
        .where({ 'c.id': classe_id, 'a.etablissement_id': req.etablissement_id })
        .first('c.id', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"));

      if (!classe) throw ApiError.nonTrouve('Classe introuvable');

      const bulletins = await db('moyennes_generales as mg')
        .join('inscriptions as i', 'i.id', 'mg.inscription_id')
        .where({ 'i.classe_id': classe_id, 'mg.periode_id': periode_id, 'i.statut': 'actif' })
        .whereNotNull('mg.moyenne_generale')
        .select('mg.id', 'mg.inscription_id');

      if (bulletins.length === 0) {
        throw ApiError.validationEchouee('Aucune moyenne calculée. Lancez le calcul des moyennes d\'abord.');
      }

      await db.transaction(async trx => {
        for (const b of bulletins) {
          const recap = await trx('recapitulatifs_absences')
            .where({ inscription_id: b.inscription_id, periode_id })
            .first();

          const updates = { bulletin_genere: true, bulletin_genere_at: trx.raw('NOW()') };
          if (recap) {
            updates.nb_absences_justifiees   = recap.nb_seances_absences_just;
            updates.nb_absences_injustifiees = recap.nb_seances_absences_injust;
            updates.nb_retards               = recap.nb_seances_retards;
          }

          await trx('moyennes_generales').where('id', b.id).update(updates);
        }
      });

      // Enqueuer la génération PDF asynchrone
      const job = await enqueuerGenerationBulletins({
        classe_id,
        periode_id,
        etablissement_id: req.etablissement_id,
      });

      logger.info('Bulletins générés + job PDF enqueued', { classe_id, periode_id, nb: bulletins.length, jobId: job.id, par: req.session.utilisateur_id });
      return cree(res, { message: `${bulletins.length} bulletins générés`, classe: classe.classe, nb_bulletins: bulletins.length, job_id: job.id });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// PUT /bulletins/:id/valider — Signature directeur
// ═════════════════════════════════════════════════════════════════
router.put('/bulletins/:id/valider', auth, isoler, perm('bulletins.valider'),
  valider(z.object({
    appreciation_conseil: z.string().optional(),
    decision_conseil:     z.enum(['felicitations', 'encouragements', 'tableau_honneur', 'avert_travail', 'avert_conduite', 'aucune']).optional(),
    decision_passage:     z.enum(['admis', 'ajourne', 'redoublant', 'exclu', 'en_attente']).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      const bulletin = await db('moyennes_generales as mg')
        .join('inscriptions as i',     'i.id', 'mg.inscription_id')
        .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
        .where({ 'mg.id': req.params.id, 'a.etablissement_id': req.etablissement_id })
        .first('mg.id');

      if (!bulletin) throw ApiError.nonTrouve('Bulletin introuvable');

      const updates = { valide_par: req.session.utilisateur_id, valide_at: db.raw('NOW()'), updated_at: db.raw('NOW()') };
      if (req.body.appreciation_conseil) updates.appreciation_conseil = req.body.appreciation_conseil;
      if (req.body.decision_conseil)     updates.decision_conseil = req.body.decision_conseil;
      if (req.body.decision_passage)     updates.decision_passage = req.body.decision_passage;

      const [updated] = await db('moyennes_generales').where({ id: req.params.id }).update(updates).returning('*');

      logger.info('Bulletin validé', { id: req.params.id, par: req.session.utilisateur_id });
      return ok(res, { message: 'Bulletin validé', bulletin: updated });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// GET /bulletins/:id/download — URL signée du PDF
// ═════════════════════════════════════════════════════════════════
router.get('/bulletins/:id/download', auth, isoler, perm('bulletins.voir'), async (req, res, next) => {
  try {
    const db = getDB();

    const bulletin = await db('moyennes_generales as mg')
      .join('inscriptions as i',     'i.id', 'mg.inscription_id')
      .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
      .where({ 'mg.id': req.params.id, 'a.etablissement_id': req.etablissement_id, 'mg.bulletin_genere': true })
      .first('mg.bulletin_url', 'mg.valide_at');

    if (!bulletin) throw ApiError.nonTrouve('Bulletin introuvable ou non encore généré');
    if (!bulletin.valide_at) throw ApiError.interdit('Ce bulletin n\'a pas encore été validé');
    if (!bulletin.bulletin_url) throw ApiError.nonTrouve('Le fichier PDF n\'est pas encore disponible');

    return ok(res, { download_url: bulletin.bulletin_url, expire_dans: '1h' });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /bulletins/jobs/:jobId — Statut du job de génération PDF
// ═════════════════════════════════════════════════════════════════
router.get('/bulletins/jobs/:jobId', auth, isoler, perm('bulletins.voir'), async (req, res, next) => {
  try {
    const queue = getQueue(QUEUES.BULLETINS);
    const job   = await queue.getJob(req.params.jobId);

    if (!job) throw ApiError.nonTrouve('Job introuvable');

    const etat     = await job.getState();
    const progress = job.progress;
    const result   = job.returnvalue;
    const erreur   = job.failedReason;

    return ok(res, { job_id: req.params.jobId, etat, progress, result, erreur });
  } catch (err) { next(err); }
});

module.exports = router;
