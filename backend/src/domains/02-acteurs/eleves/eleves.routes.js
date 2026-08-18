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
const { preparerDonneesMediacles, selecteursMedicaux } = require('../../../utils/medical-crypto');
const { autoriserAccesEleve } = require('../../../middleware/acces-eleve.middleware');

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
    // Données médicales (stockées chiffrées via pgcrypto si MEDICAL_ENCRYPTION_KEY définie)
    allergies:            z.string().optional(),
    conditions_medicales: z.string().optional(),
    groupe_sanguin:       z.enum(['A+','A-','B+','B-','AB+','AB-','O+','O-']).optional(),
    medecin_urgence:      z.string().optional(),
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

        // Créer le profil élève (avec données médicales chiffrées si clé configurée)
        const colonnesMedicales = preparerDonneesMediacles(trx, {
          allergies:            req.body.allergies,
          conditions_medicales: req.body.conditions_medicales,
          groupe_sanguin:       req.body.groupe_sanguin,
          medecin_urgence:      req.body.medecin_urgence,
        });
        const [eleveRecord] = await trx('eleves').insert({
          utilisateur_id:   utilisateurId,
          matricule:        req.body.matricule || genMatricule(req.etablissement_id),
          date_inscription: trx.raw('NOW()'),
          ...colonnesMedicales,
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

        // Créer le parent si fourni — ou réutiliser un parent existant.
        // utilisateurs.telephone est UNIQUE au niveau BASE (pas juste par
        // établissement) : un même numéro sert à un parent pour TOUS ses
        // enfants, y compris plusieurs enfants dans le MÊME établissement
        // (cas très courant — fratrie). Sans ce contrôle, l'inscription
        // du 2e enfant plantait sur la contrainte unique avec une erreur
        // générique "DOUBLON" (reproduit en direct : 2 POST /eleves avec
        // le même parent.telephone → 201 puis 409 sur le 2e).
        if (req.body.parent) {
          const parentExistant = await trx('utilisateurs')
            .where({ telephone: req.body.parent.telephone })
            .first('id', 'etablissement_id');

          let parentId;

          if (parentExistant) {
            if (parentExistant.etablissement_id !== req.etablissement_id) {
              throw ApiError.validationEchouee(
                'Ce numéro de téléphone est déjà utilisé par un compte dans un autre établissement'
              );
            }
            parentId = parentExistant.id;

            const aDejaRoleParent = await trx('utilisateur_roles as ur')
              .join('roles as r', 'r.id', 'ur.role_id')
              .where({ 'ur.utilisateur_id': parentId, 'ur.etablissement_id': req.etablissement_id, 'r.code': 'parent' })
              .first('ur.id');

            if (!aDejaRoleParent) {
              const roleParent = await trx('roles').where({ code: 'parent' }).first('id');
              await trx('utilisateur_roles').insert({
                id:               uuid(),
                utilisateur_id:   parentId,
                role_id:          roleParent.id,
                etablissement_id: req.etablissement_id,
              });
            }
          } else {
            parentId = uuid();
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

            // Initialiser les préférences de notification (une seule fois
            // par utilisateur — notifications_preferences.utilisateur_id
            // est UNIQUE, donc jamais réinsérée pour un parent existant)
            await trx('notifications_preferences').insert({
              id:             uuid(),
              utilisateur_id: parentId,
              canal_prefere:  'sms',
            });
          }

          // Un seul contact principal par élève (idx_contact_principal_unique)
          await trx('parents_eleves').insert({
            id:                   uuid(),
            parent_id:            parentId,
            eleve_id:             eleveRecord.id,
            lien:                 req.body.parent.lien,
            est_contact_principal: true,
            peut_voir_notes:      true,
            peut_voir_absences:   true,
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
      .select(
        'u.id', 'u.nom', 'u.prenom', 'u.date_naissance', 'u.genre',
        'u.telephone', 'u.adresse', 'u.photo_url',
        'e.matricule', 'e.date_inscription',
        ...selecteursMedicaux(db, 'e')
      )
      .first();

    if (!eleve) throw ApiError.nonTrouve('Élève introuvable');
    return ok(res, eleve);
  } catch (err) { next(err); }
});

// ── GET /eleves/:eleve_id/tableau-de-bord ────────────────────────
// Endpoint le plus consulté depuis l'app mobile — optimisé
// Le rôle parent n'a jamais eu la permission 'eleves.voir' (réservée au
// staff) : cette route bloquait donc systématiquement le tableau de bord
// parent en 403. autoriserAccesEleve() laisse passer un parent lié à cet
// élève précis, ou le staff via la permission 'eleves.voir'.
router.get('/eleves/:eleve_id/tableau-de-bord', auth, isoler, autoriserAccesEleve('eleves.voir'), async (req, res, next) => {
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
      // couleur_affichage vit sur disciplines_matieres, pas matieres — jointure requise
      db('moyennes_matieres as mm')
        .join('matieres as m',  'm.id',  'mm.matiere_id')
        .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
        .join('periodes as p',  'p.id',  'mm.periode_id')
        .join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
        .where({
          'mm.inscription_id': inscription.inscription_id,
          'a.est_courante':    true,
        })
        .orderBy('p.numero')
        .select('m.nom as matiere', 'dm.couleur_affichage', 'mm.moyenne', 'mm.rang_dans_classe', 'p.numero as trimestre'),

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
      // notes.eleve_id référence eleves.id, pas utilisateurs.id — on filtre
      // par inscription_id (déjà résolu ci-dessus) plutôt que de comparer
      // n.eleve_id à req.params.eleve_id (deux espaces d'UUID différents).
      db('notes as n')
        .join('evaluations as ev',              'ev.id',  'n.evaluation_id')
        .join('affectations_enseignants as ae',  'ae.id',  'ev.affectation_id')
        .join('matieres as m',                   'm.id',   'ae.matiere_id')
        .where({
          'n.inscription_id':  inscription.inscription_id,
          'ev.notes_publiees': true,
        })
        .orderBy('ev.date_evaluation', 'desc')
        .limit(5)
        .select('m.nom as matiere', 'ev.type', 'n.valeur', 'ev.date_evaluation'),

      // EDT de la semaine — couleur_affichage vit sur disciplines_matieres
      db('emplois_du_temps as edt')
        .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
        .join('matieres as m',   'm.id',  'ae.matiere_id')
        .leftJoin('disciplines_matieres as dm', 'dm.id', 'm.discipline_id')
        .join('plages_horaires as ph', 'ph.id', 'edt.plage_id')
        .where({ 'edt.classe_id': inscription.classe_id })
        .orderBy(['edt.jour_semaine', 'ph.heure_debut'])
        .select(
          'edt.jour_semaine', 'm.nom as matiere', 'dm.couleur_affichage',
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
// Colonnes réelles de `presences` : pas de `justification` ni de
// `created_at`/`updated_at` — ce sont `commentaire_justif`, `saisie_at`,
// `modifie_at` (même classe de bug déjà corrigée ailleurs dans
// appels.routes.js/sync.routes.js lors de la session précédente, mais
// jamais portée jusqu'ici). i.eleve_id référence eleves.id, alors que
// :eleve_id (convention de ce domaine) est utilisateurs.id — d'où le
// join eleves pour résoudre correctement.
router.get('/eleves/:eleve_id/absences', auth, isoler, autoriserAccesEleve('absences.voir_eleve'), async (req, res, next) => {
  try {
    const db = getDB();
    const { depuis } = req.query; // Filtre optionnel pour sync offline

    let query = db('presences as pr')
      .join('appels as ap',              'ap.id',  'pr.appel_id')
      .join('emplois_du_temps as edt',   'edt.id', 'ap.emploi_du_temps_id')
      .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
      .join('matieres as m',             'm.id',   'ae.matiere_id')
      .join('inscriptions as i',         'i.id',   'pr.inscription_id')
      .join('eleves as el',              'el.id',  'i.eleve_id')
      .where({
        'el.utilisateur_id': req.params.eleve_id,
        'pr.statut':         'absent',
      })
      .orderBy('ap.date_cours', 'desc')
      .select(
        'ap.date_cours', 'm.nom as matiere', 'pr.statut',
        'pr.est_justifie', 'pr.commentaire_justif as justification', 'pr.saisie_at as created_at'
      );

    if (depuis) query = query.where('pr.modifie_at', '>', depuis);

    const absences = await query.limit(100);
    return liste(res, absences);
  } catch (err) { next(err); }
});

// ── Helpers ──────────────────────────────────────────────────────
function genMatricule(_etablissementId) {
  const annee = new Date().getFullYear().toString().slice(2);
  const rand  = Math.floor(1000 + Math.random() * 9000);
  return `E${annee}${rand}`;
}

module.exports = router;
