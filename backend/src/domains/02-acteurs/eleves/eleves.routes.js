'use strict';

const express  = require('express');
const { z }    = require('zod');
const { v4: uuid } = require('uuid');

const { getDB }      = require('../../../infrastructure/database/pool');
const { authentifier } = require('../../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../../middleware/permission.middleware');
const { valider }    = require('../../../middleware/validate.middleware');
const { ok, cree, liste, paginee, getPagination } = require('../../../utils/reponse');
const ApiError       = require('../../../utils/ApiError');
const { invalidatePattern } = require('../../../infrastructure/cache/redis');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ── GET /eleves ──────────────────────────────────────────────────
router.get('/eleves', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const { page, limite, offset } = getPagination(req.query);
    const { classe_id, niveau_id, recherche } = req.query;

    let query = db('inscriptions as i')
      .join('eleves as e',          'e.id',             'i.eleve_id')
      .join('utilisateurs as u',    'u.id',             'e.utilisateur_id')
      .join('classes as c',         'c.id',             'i.classe_id')
      .join('niveaux as n',         'n.id',             'c.niveau_id')
      .join('annees_scolaires as a','a.id',             'i.annee_scolaire_id')
      .where({
        'a.etablissement_id': req.etablissement_id,
        'a.est_courante':     true,
        'i.statut':           'actif',
      });

    if (classe_id)  query = query.where('i.classe_id', classe_id);
    if (niveau_id)  query = query.where('c.niveau_id', niveau_id);
    if (recherche) {
      const terme = `%${recherche}%`;
      query = query.andWhere(function() {
        this.whereILike('u.nom', terme)
          .orWhereILike('u.prenom', terme)
          .orWhereILike('e.matricule', terme);
      });
    }

    const [{ count }] = await query.clone().count('u.id as count');
    const eleves = await query
      .orderBy(['n.ordre', 'u.nom', 'u.prenom'])
      .limit(limite).offset(offset)
      .select(
        'u.id', 'u.nom', 'u.prenom', 'u.photo_url', 'u.telephone',
        'e.matricule', 'i.id as inscription_id',
        'n.nom as niveau', db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        // Dernière moyenne générale calculée
        db.raw(`(
          SELECT mg.moyenne_generale
          FROM moyennes_generales mg
          JOIN periodes per ON per.id = mg.periode_id
          WHERE mg.inscription_id = i.id
          ORDER BY per.numero DESC
          LIMIT 1
        ) as moyenne`),
        // Nombre d'absences injustifiées sur l'année
        db.raw(`(
          SELECT COUNT(*)
          FROM presences pr
          JOIN appels ap ON ap.id = pr.appel_id
          WHERE pr.inscription_id = i.id
            AND pr.statut = 'absent'
            AND pr.est_justifie = FALSE
        ) as nb_absences`),
        // Nom du parent principal
        db.raw(`(
          SELECT u2.prenom || ' ' || u2.nom
          FROM parents_eleves pe
          JOIN utilisateurs u2 ON u2.id = pe.parent_id
          WHERE pe.eleve_id = e.id
          ORDER BY pe.created_at
          LIMIT 1
        ) as parent_nom`)
      );

    return paginee(res, eleves, { total: parseInt(count), page, limite });
  } catch (err) { next(err); }
});

// ── POST /eleves ─────────────────────────────────────────────────
router.post('/eleves', auth, isoler, perm('eleves.creer'),
  valider(z.object({
    nom:            z.string().min(2),
    prenom:         z.string().min(2),
    date_naissance: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    genre:          z.enum(['M', 'F']).optional(),
    telephone:      z.string().optional(),
    adresse:        z.string().optional(),
    matricule:      z.string().optional(),
    classe_id:      z.string().uuid('ID classe invalide'),
    // Parent optionnel à créer en même temps
    parent:         z.object({
      nom:       z.string(),
      prenom:    z.string(),
      telephone: z.string(),
      lien:      z.enum(['pere', 'mere', 'tuteur', 'grand_parent', 'oncle_tante', 'autre']).default('tuteur'),
    }).optional(),
  })),
  async (req, res, next) => {
    const db = getDB();
    try {
      const result = await db.transaction(async trx => {
        // Récupérer l'année courante
        const annee = await trx('annees_scolaires')
          .where({ etablissement_id: req.etablissement_id, est_courante: true })
          .first('id');
        if (!annee) throw ApiError.validationEchouee('Aucune année scolaire courante');

        // Créer l'utilisateur
        const utilisateurId = uuid();
        await trx('utilisateurs').insert({
          id:               utilisateurId,
          etablissement_id: req.etablissement_id,
          nom:              req.body.nom,
          prenom:           req.body.prenom,
          date_naissance:   req.body.date_naissance,
          genre:            req.body.genre,
          telephone:        req.body.telephone,
          adresse:          req.body.adresse,
          actif:            true,
        });

        // Créer le profil élève
        const [eleveRecord] = await trx('eleves').insert({
          utilisateur_id: utilisateurId,
          matricule:      req.body.matricule || genMatricule(req.etablissement_id),
          date_inscription: trx.raw('NOW()'),
        }).returning('id');

        // Attribuer le rôle élève
        const role = await trx('roles').where({ code: 'eleve' }).first('id');
        await trx('utilisateur_roles').insert({
          id:               uuid(),
          utilisateur_id:   utilisateurId,
          role_id:          role.id,
          etablissement_id: req.etablissement_id,
        });

        // Inscrire dans la classe
        const inscriptionId = uuid();
        await trx('inscriptions').insert({
          id:               inscriptionId,
          eleve_id:         eleveRecord.id,
          classe_id:        req.body.classe_id,
          annee_scolaire_id: annee.id,
          statut:           'actif',
        });

        // Créer le parent si fourni
        if (req.body.parent) {
          const parentId = uuid();
          await trx('utilisateurs').insert({
            id:               parentId,
            etablissement_id: req.etablissement_id,
            nom:              req.body.parent.nom,
            prenom:           req.body.parent.prenom,
            telephone:        req.body.parent.telephone,
            actif:            true,
          });

          const roleParent = await trx('roles').where({ code: 'parent' }).first('id');
          await trx('utilisateur_roles').insert({
            id:               uuid(),
            utilisateur_id:   parentId,
            role_id:          roleParent.id,
            etablissement_id: req.etablissement_id,
          });

          await trx('parents_eleves').insert({
            id:                   uuid(),
            parent_id:            parentId,
            eleve_id:             eleveRecord.id,
            lien:                 req.body.parent.lien,
            est_contact_principal: true,
            peut_voir_notes:      true,
            peut_voir_absences:   true,
          });

          // Initialiser les préférences de notification
          await trx('notifications_preferences').insert({
            id:             uuid(),
            utilisateur_id: parentId,
            canal_prefere:  'sms',
          });
        }

        return { utilisateur_id: utilisateurId, inscription_id: inscriptionId };
      });

      try { await invalidatePattern(`classe_eleves:${req.body.classe_id}`); } catch { /* Redis indisponible — ignoré */ }
      return cree(res, result);
    } catch (err) { next(err); }
  }
);

// ── GET /eleves/:eleve_id ─────────────────────────────────────────
router.get('/eleves/:eleve_id', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const eleve = await db('utilisateurs as u')
      .join('eleves as e', 'e.utilisateur_id', 'u.id')
      .where({ 'u.id': req.params.eleve_id, 'u.etablissement_id': req.etablissement_id })
      .first(
        'u.id', 'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre',
        'u.telephone', 'u.adresse', 'u.photo_url',
        'e.matricule', 'e.date_inscription', 'e.groupe_sanguin'
      );

    if (!eleve) throw ApiError.nonTrouve('Élève introuvable');
    return ok(res, eleve);
  } catch (err) { next(err); }
});

// ── GET /eleves/:eleve_id/tableau-de-bord ────────────────────────
// Endpoint le plus consulté depuis l'app mobile — optimisé
router.get('/eleves/:eleve_id/tableau-de-bord', auth, isoler, perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();

    // Inscription courante
    const inscription = await db('inscriptions as i')
      .join('eleves as e',            'e.id', 'i.eleve_id')
      .join('classes as c',          'c.id', 'i.classe_id')
      .join('niveaux as n',          'n.id', 'c.niveau_id')
      .join('annees_scolaires as a', 'a.id', 'i.annee_scolaire_id')
      .where({
        'e.utilisateur_id':   req.params.eleve_id,
        'a.est_courante':     true,
        'a.etablissement_id': req.etablissement_id,
        'i.statut':           'actif',
      })
      .first(
        'i.id as inscription_id',
        db.raw("CONCAT(n.nom, ' ', c.nom) as classe"),
        'n.nom as niveau', 'c.id as classe_id',
        'a.id as annee_id'
      );

    if (!inscription) throw ApiError.nonTrouve('Inscription courante introuvable');

    // Lancer toutes les requêtes en parallèle
    const [moyennesRecentes, absencesTotal, notesRecentes, edt] = await Promise.all([
      // Moyennes par matière — période courante
      db('moyennes_matieres as mm')
        .join('matieres as m',  'm.id',  'mm.matiere_id')
        .join('periodes as p',  'p.id',  'mm.periode_id')
        .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
        .where({
          'mm.inscription_id': inscription.inscription_id,
          'a.est_courante':    true,
        })
        .orderBy('p.numero')
        .select('m.nom as matiere', 'm.couleur_affichage', 'mm.moyenne', 'mm.rang_dans_classe', 'p.numero as trimestre'),

      // Total absences
      db('recapitulatifs_absences as ra')
        .join('periodes as p', 'p.id', 'ra.periode_id')
        .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
        .where({
          'ra.inscription_id': inscription.inscription_id,
          'a.est_courante':    true,
        })
        .select(
          db.raw('SUM(ra.nb_seances_absences_just) as justifiees'),
          db.raw('SUM(ra.nb_seances_absences_injust) as injustifiees'),
          db.raw('SUM(ra.nb_seances_retards) as retards')
        )
        .first(),

      // 5 dernières notes publiées
      db('notes as n')
        .join('evaluations as ev',              'ev.id',  'n.evaluation_id')
        .join('affectations_enseignants as ae',  'ae.id',  'ev.affectation_id')
        .join('matieres as m',                   'm.id',   'ae.matiere_id')
        .where({
          'n.eleve_id':        req.params.eleve_id,
          'ev.notes_publiees': true,
        })
        .orderBy('ev.date_evaluation', 'desc')
        .limit(5)
        .select('m.nom as matiere', 'ev.type', 'n.valeur', 'ev.date_evaluation'),

      // EDT de la semaine
      db('emplois_du_temps as edt')
        .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
        .join('matieres as m',   'm.id',  'ae.matiere_id')
        .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
        .where({ 'edt.classe_id': inscription.classe_id })
        .orderBy(['edt.jour_semaine', 'ph.heure_debut'])
        .select(
          'edt.jour_semaine', 'm.nom as matiere', 'm.couleur_affichage',
          'ph.heure_debut', 'ph.heure_fin', 'edt.salle'
        ),
    ]);

    return ok(res, {
      eleve: { inscription_id: inscription.inscription_id, classe: inscription.classe, niveau: inscription.niveau },
      moyennes: moyennesRecentes,
      absences: absencesTotal || { justifiees: 0, injustifiees: 0, retards: 0 },
      notes_recentes: notesRecentes,
      emploi_du_temps: edt,
    });

  } catch (err) { next(err); }
});

// ── GET /eleves/:eleve_id/absences ──────────────────────────────
router.get('/eleves/:eleve_id/absences', auth, isoler, perm('absences.voir_eleve'), async (req, res, next) => {
  try {
    const db = getDB();
    const { depuis } = req.query; // Filtre optionnel pour sync offline

    let query = db('presences as pr')
      .join('appels as ap',              'ap.id',  'pr.appel_id')
      .join('emplois_du_temps as edt',   'edt.id', 'ap.emploi_du_temps_id')
      .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
      .join('matieres as m',             'm.id',   'ae.matiere_id')
      .join('inscriptions as i',         'i.id',   'pr.inscription_id')
      .where({
        'i.eleve_id': req.params.eleve_id,
        'pr.statut':  'absent',
      })
      .whereNot({ 'pr.statut': 'present' })
      .orderBy('ap.date_cours', 'desc')
      .select(
        'ap.date_cours', 'm.nom as matiere', 'pr.statut',
        'pr.est_justifie', 'pr.justification', 'pr.created_at'
      );

    if (depuis) query = query.where('pr.updated_at', '>', depuis);

    const absences = await query.limit(100);
    return liste(res, absences);
  } catch (err) { next(err); }
});

// ── Helpers ──────────────────────────────────────────────────────
function genMatricule(etablissementId) {
  const annee = new Date().getFullYear().toString().slice(2);
  const rand  = Math.floor(1000 + Math.random() * 9000);
  return `E${annee}${rand}`;
}

module.exports = router;
