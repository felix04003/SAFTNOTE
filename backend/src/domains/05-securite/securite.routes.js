'use strict';

const express  = require('express');
const { z }    = require('zod');

const { getDB }      = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider }    = require('../../middleware/validate.middleware');
const { ok, cree, liste, paginee, getPagination, vide } = require('../../utils/reponse');
const ApiError       = require('../../utils/ApiError');
const logger         = require('../../utils/logger');
const { estDernierDirecteurActif, erreurDernierDirecteur } = require('../../utils/dernier-directeur');
const bcrypt   = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { v4: uuid } = require('uuid');
const { envoyerMotDePasseProvisoire } = require('../../infrastructure/notifications/sms.service');
const { paysIso, telephoneOuErreur, variantesTelephone } = require('../../utils/telephone');
const { emailPrisParPersonnel } = require('../../utils/email-personnel');
const { exigerMotDePasseConforme, genererMotDePasseTemporaire } = require('../../utils/mot-de-passe');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

// ═════════════════════════════════════════════════════════════════
// GET /securite/audit — Journal d'audit (admin seulement)
// ═════════════════════════════════════════════════════════════════
router.get('/securite/audit', auth, isoler, perm('admin.audit'), async (req, res, next) => {
  try {
    const db = getDB();
    const { page, limite, offset } = getPagination(req.query);
    const { action, table_cible, utilisateur_id, depuis, jusqua } = req.query;

    let query = db('journal_audit as ja')
      .leftJoin('utilisateurs as u', 'u.id', 'ja.utilisateur_id')
      .where({ 'ja.etablissement_id': req.etablissement_id });

    if (action)         query = query.where('ja.action', action);
    if (table_cible)    query = query.where('ja.table_cible', table_cible);
    if (utilisateur_id) query = query.where('ja.utilisateur_id', utilisateur_id);
    if (depuis)         query = query.where('ja.created_at', '>=', depuis);
    if (jusqua)         query = query.where('ja.created_at', '<=', jusqua);

    const [{ count }] = await query.clone().count('ja.id as count');
    const entries = await query
      .orderBy('ja.created_at', 'desc')
      .limit(limite).offset(offset)
      .select(
        'ja.id', 'ja.action', 'ja.resultat',
        'ja.table_cible', 'ja.enregistrement_id',
        'ja.ip_address',
        'ja.valeur_avant', 'ja.valeur_apres', 'ja.details',
        'ja.created_at',
        'u.id as utilisateur_id',
        db.raw("CASE WHEN u.id IS NOT NULL THEN CONCAT(u.prenom, ' ', u.nom) ELSE 'Système' END as utilisateur")
      );

    return paginee(res, entries, { total: parseInt(count), page, limite });
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// GET /securite/sessions — Sessions actives
// ═════════════════════════════════════════════════════════════════
router.get('/securite/sessions', auth, isoler, perm('admin.audit'), async (req, res, next) => {
  try {
    const db = getDB();
    const { utilisateur_id } = req.query;

    let query = db('sessions as s')
      .join('utilisateurs as u', 'u.id', 's.utilisateur_id')
      .where({ 's.etablissement_id': req.etablissement_id, 's.revoquee': false })
      .where('s.expire_at', '>', db.raw('NOW()'));

    if (utilisateur_id) query = query.where('s.utilisateur_id', utilisateur_id);

    const sessions = await query
      .orderBy('s.derniere_activite', 'desc')
      .select(
        's.id', 's.utilisateur_id',
        db.raw("CONCAT(u.prenom, ' ', u.nom) as utilisateur"),
        's.ip_address', 's.user_agent', 's.appareil', 's.canal_connexion',
        's.expire_at', 's.derniere_activite', 's.created_at'
      );

    return liste(res, sessions);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// DELETE /securite/sessions/:id — Révoquer une session
// ═════════════════════════════════════════════════════════════════
router.delete('/securite/sessions/:id', auth, isoler, perm('admin.utilisateurs'), async (req, res, next) => {
  try {
    const db = getDB();

    const session = await db('sessions')
      .where({ id: req.params.id, etablissement_id: req.etablissement_id, revoquee: false })
      .first('id', 'utilisateur_id');

    if (!session) throw ApiError.nonTrouve('Session introuvable ou déjà révoquée');

    await db('sessions').where({ id: req.params.id }).update({
      revoquee:         true,
      motif_revocation: 'Révoquée par un administrateur',
      revoquee_at:      db.raw('NOW()'),
    });

    logger.info('Session révoquée', {
      session_id: req.params.id,
      utilisateur_cible: session.utilisateur_id,
      revoquee_par: req.session.utilisateur_id,
    });

    return vide(res);
  } catch (err) { next(err); }
});

// ═════════════════════════════════════════════════════════════════
// POST /securite/blocage/:userId — Bloquer un compte
// ═════════════════════════════════════════════════════════════════
// GET /securite/comptes-bloques — comptes de l'établissement désactivés (blocage manuel ou effacement RGPD).
// POST /securite/blocage/:userId est une bascule : sans cette liste, un compte bloqué ne pouvait être
// retrouvé (il disparaît des listes d'enseignants et de sessions) donc jamais débloqué depuis l'interface.
router.get('/securite/comptes-bloques', auth, isoler, perm('admin.audit'), async (req, res, next) => {
  try {
    const db = getDB();
    const comptes = await db('utilisateurs as u')
      .leftJoin('utilisateur_roles as ur', function() {
        this.on('ur.utilisateur_id', 'u.id').andOn('ur.etablissement_id', 'u.etablissement_id');
      })
      .leftJoin('roles as r', 'r.id', 'ur.role_id')
      .where({ 'u.etablissement_id': req.etablissement_id, 'u.actif': false })
      // un compte anonymisé (droit à l'effacement) n'est pas un compte « bloqué » : on ne propose pas de le rouvrir
      .whereNot('u.prenom', 'Anonyme')
      .groupBy('u.id')
      .orderBy('u.nom')
      .select('u.id', 'u.nom', 'u.prenom', db.raw("string_agg(DISTINCT r.code, ', ') as roles"), 'u.updated_at as bloque_depuis');
    return liste(res, comptes);
  } catch (err) { next(err); }
});

router.post('/securite/blocage/:userId', auth, isoler, perm('admin.utilisateurs'),
  valider(z.object({
    motif: z.string().min(5).max(200),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Vérifier que l'utilisateur cible existe dans l'établissement
      const utilisateur = await db('utilisateurs')
        .where({ id: req.params.userId, etablissement_id: req.etablissement_id })
        .first('id', 'nom', 'prenom', 'actif');

      if (!utilisateur) throw ApiError.nonTrouve('Utilisateur introuvable');

      // Empêcher de se bloquer soi-même
      if (req.params.userId === req.session.utilisateur_id) {
        throw ApiError.interdit('Vous ne pouvez pas bloquer votre propre compte');
      }

      // Basculer le statut actif
      const nouveauStatut = !utilisateur.actif;

      // Bloquer (et non débloquer) le dernier directeur actif : l'école n'aurait plus personne pour la gérer
      if (!nouveauStatut && await estDernierDirecteurActif(db, req.params.userId, req.etablissement_id)) {
        throw erreurDernierDirecteur('Ce compte est le seul directeur actif de l\'établissement : il ne peut pas être bloqué.');
      }

      await db.transaction(async trx => {
        // Mettre à jour le statut
        await trx('utilisateurs').where({ id: req.params.userId }).update({ actif: nouveauStatut });

        // Si on bloque : révoquer toutes les sessions actives
        if (!nouveauStatut) {
          await trx('sessions')
            .where({ utilisateur_id: req.params.userId, revoquee: false })
            .update({
              revoquee:         true,
              motif_revocation: `Compte bloqué : ${req.body.motif}`,
              revoquee_at:      trx.raw('NOW()'),
            });
        }

        // Journaliser dans l'audit
        await trx('journal_audit').insert({
          etablissement_id: req.etablissement_id,
          utilisateur_id:   req.session.utilisateur_id,
          action:           nouveauStatut ? 'utilisateurs.debloquer' : 'utilisateurs.bloquer',
          resultat:         'succes',
          table_cible:      'utilisateurs',
          enregistrement_id: req.params.userId,
          details:          JSON.stringify({ motif: req.body.motif }),
        });
      });

      logger.info(`Utilisateur ${nouveauStatut ? 'débloqué' : 'bloqué'}`, {
        utilisateur_id: req.params.userId,
        par: req.session.utilisateur_id,
        motif: req.body.motif,
      });

      return ok(res, {
        message: `Compte ${utilisateur.prenom} ${utilisateur.nom} ${nouveauStatut ? 'débloqué' : 'bloqué'}`,
        actif: nouveauStatut,
      });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// POST /securite/directeurs — Créer un second directeur (succession, remplaçant)
// Réservé à un DIRECTEUR en exercice : c'est la porte de sortie du garde-fou
// « dernier directeur » (un directeur ne peut partir que s'il y en a un autre).
// Mot de passe provisoire aléatoire envoyé par SMS, changement obligatoire.
// ═════════════════════════════════════════════════════════════════
const limiterCreationDirecteur = rateLimit({
  windowMs: 60 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_DIRECTEUR_MAX) || 5,
  message:  { succes: false, erreur: 'Trop de comptes directeur créés — réessayez dans 1 heure', code: 'RATE_LIMIT' },
  standardHeaders: true,
  legacyHeaders:   false,
});

router.post('/securite/directeurs', auth, isoler, perm('admin.utilisateurs'), limiterCreationDirecteur,
  valider(z.object({
    nom:       z.string().min(2).max(100),
    prenom:    z.string().min(2).max(100),
    telephone: z.string().min(6, 'Numéro invalide').max(25, 'Numéro invalide'),
    email:     z.string().email().optional().or(z.literal('')),
    genre:     z.enum(['M', 'F']).optional(),
  })),
  async (req, res, next) => {
    try {
      const db = getDB();

      // Seul un directeur en exercice nomme un directeur (pas un simple porteur de la permission)
      const estDirecteur = await db('utilisateur_roles as ur')
        .join('roles as r', 'r.id', 'ur.role_id')
        .where({ 'ur.utilisateur_id': req.session.utilisateur_id, 'ur.etablissement_id': req.etablissement_id, 'ur.actif': true, 'r.code': 'directeur' })
        .first('ur.id');
      if (!estDirecteur) throw ApiError.interdit('Seul un directeur peut nommer un autre directeur');

      const etab      = await db('etablissements').where({ id: req.etablissement_id }).first('nom', 'pays');
      const pays      = paysIso(etab && etab.pays);
      const telephone = telephoneOuErreur(req.body.telephone, pays);

      const doublon = await db('utilisateurs')
        .where({ etablissement_id: req.etablissement_id })
        .whereIn('telephone', variantesTelephone(req.body.telephone, pays))
        .first('id');
      if (doublon) throw ApiError.validationEchouee('Un utilisateur avec ce numéro existe déjà dans votre établissement');

      const email = req.body.email || null;
      if (email) {
        const pris = await db('utilisateurs').where({ etablissement_id: req.etablissement_id, email }).first('id');
        if (pris) throw ApiError.validationEchouee('Un utilisateur avec cet email existe déjà dans votre établissement');
        if (await emailPrisParPersonnel(db, email)) {
          throw ApiError.validationEchouee('Cet email est déjà utilisé par un membre du personnel d\'un autre établissement');
        }
      }

      const mdpBrut = genererMotDePasseTemporaire();
      const politique = await db('politique_securite').where({ etablissement_id: req.etablissement_id }).first('mdp_longueur_min');
      exigerMotDePasseConforme(mdpBrut, politique, { ...req.body, telephone });
      const mdpHash = await bcrypt.hash(mdpBrut, 10);

      const utilisateurId = uuid();
      await db.transaction(async trx => {
        const roleRow = await trx('roles').where({ code: 'directeur' }).first('id');
        if (!roleRow) throw new Error('Rôle "directeur" introuvable — vérifiez les données de référence');

        await trx('utilisateurs').insert({
          id: utilisateurId, etablissement_id: req.etablissement_id,
          nom: req.body.nom, prenom: req.body.prenom, telephone, email, genre: req.body.genre,
          mot_de_passe_hash: mdpHash, mdp_a_changer: true, actif: true,
        });
        await trx('utilisateur_roles').insert({
          id: uuid(), utilisateur_id: utilisateurId, role_id: roleRow.id, etablissement_id: req.etablissement_id,
        });
        await trx('journal_audit').insert({
          etablissement_id: req.etablissement_id,
          utilisateur_id:   req.session.utilisateur_id,
          action:           'utilisateurs.creer_directeur',
          resultat:         'succes',
          table_cible:      'utilisateurs',
          enregistrement_id: utilisateurId,
          details:          JSON.stringify({ nom: req.body.nom, prenom: req.body.prenom }),
        });
      });

      logger.info('Directeur créé', { utilisateur_id: utilisateurId, cree_par: req.session.utilisateur_id, etablissement_id: req.etablissement_id });

      // SMS : le mot de passe n'est renvoyé que si le SMS n'a pas pu partir
      let smsEnvoye = false;
      if (process.env.AT_API_KEY) {
        try {
          await envoyerMotDePasseProvisoire(telephone, { etablissementNom: etab && etab.nom, motDePasse: mdpBrut });
          smsEnvoye = true;
        } catch (err) {
          logger.warn('SMS du mot de passe provisoire non envoyé', { error: String(err.message).slice(0, 120) });
        }
      }

      return cree(res, {
        utilisateur_id: utilisateurId,
        sms_envoye: smsEnvoye,
        message: smsEnvoye
          ? `Directeur créé. Un SMS contenant le mot de passe provisoire a été envoyé au ${telephone}.`
          : `Directeur créé, mais le SMS n'a pas pu être envoyé. Mot de passe provisoire : ${mdpBrut}`,
      });
    } catch (err) { next(err); }
  }
);

// ═════════════════════════════════════════════════════════════════
// GET/PUT /securite/politique — Politique de sécurité de l'établissement
// Bornes volontairement serrées : un directeur ne peut pas désarmer le
// blocage de connexion ni imposer des mots de passe triviaux.
// ═════════════════════════════════════════════════════════════════
const CHAMPS_POLITIQUE = ['mdp_longueur_min', 'blocage_nb_tentatives', 'blocage_duree_minutes', 'session_max_simultanees'];

const schemaPolitique = z.object({
  mdp_longueur_min:       z.number().int().min(8).max(32),
  blocage_nb_tentatives:  z.number().int().min(3).max(10),
  blocage_duree_minutes:  z.number().int().min(5).max(120),
  session_max_simultanees: z.number().int().min(1).max(5),
}).partial().refine(o => Object.keys(o).length > 0, { message: 'Aucun champ à modifier' });

router.get('/securite/politique', auth, isoler, perm('config.voir'), async (req, res, next) => {
  try {
    const politique = await getDB()('politique_securite')
      .where({ etablissement_id: req.etablissement_id })
      .first(...CHAMPS_POLITIQUE);
    return ok(res, politique || {});
  } catch (err) { next(err); }
});

router.put('/securite/politique', auth, isoler, perm('config.modifier'), valider(schemaPolitique),
  async (req, res, next) => {
    try {
      const db = getDB();
      const changements = {};
      for (const c of CHAMPS_POLITIQUE) if (req.body[c] !== undefined) changements[c] = req.body[c];

      let apres;
      await db.transaction(async (trx) => {
        const avant = await trx('politique_securite')
          .where({ etablissement_id: req.etablissement_id }).first(...CHAMPS_POLITIQUE);
        [apres] = await trx('politique_securite')
          .insert({ etablissement_id: req.etablissement_id, ...changements })
          .onConflict('etablissement_id').merge(changements)
          .returning(CHAMPS_POLITIQUE);
        await trx('journal_audit').insert({
          etablissement_id: req.etablissement_id,
          utilisateur_id:   req.session.utilisateur_id,
          action:           'securite.politique_modifier',
          resultat:         'succes',
          table_cible:      'politique_securite',
          details:          JSON.stringify({ avant: avant || null, apres: changements }),
        });
      });
      logger.info('Politique de sécurité modifiée', { etablissement_id: req.etablissement_id, par: req.session.utilisateur_id });
      return ok(res, apres);
    } catch (err) { next(err); }
  }
);

module.exports = router;
