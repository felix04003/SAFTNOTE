'use strict';

// Exports CSV pour la direction (Excel) : élèves, moyennes d'une période, absences, sanctions.
// Permission « rapports.exporter » EN PLUS du droit de lecture de la donnée exportée. Chaque export est inscrit au
// journal d'audit (nombre de lignes et filtres, jamais le contenu). Les données médicales n'en font jamais partie.

const express = require('express');

const { getDB }      = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { versCsv }    = require('../../utils/csv');
const ApiError       = require('../../utils/ApiError');

const router = express.Router();
const auth   = authentifier;
const perm   = exigerPermission;
const isoler = isolerEtablissement;

const LIMITE_LIGNES = 50000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const STATUTS_INSCRIPTION = { actif: 'Inscrit', transfere: 'Transféré', abandonne: 'Abandon', exclu: 'Exclu', diplome: 'Diplômé' };
const STATUTS_PRESENCE = { absent: 'Absent', retard: 'Retard', sorti_avant: 'Sorti avant la fin' };
const TYPES_SANCTION = {
  avertissement_oral: 'Avertissement oral', avertissement_ecrit: 'Avertissement écrit', retenue: 'Retenue',
  renvoi_temporaire: 'Renvoi temporaire', conseil_discipline: 'Conseil de discipline', exclusion_definitive: 'Exclusion définitive',
};

/** Paramètre facultatif de requête : identifiant (UUID) ou date, sinon 422 */
function lire(req, nom, motif, message) {
  const v = req.query[nom];
  if (v === undefined || v === '') return null;
  if (typeof v !== 'string' || !motif.test(v)) throw ApiError.validationEchouee(message || `${nom} invalide`);
  return v;
}

async function anneeCourante(db, etablissementId) {
  const annee = await db('annees_scolaires').where({ etablissement_id: etablissementId, est_courante: true }).first('id', 'libelle', 'date_debut', 'date_fin');
  if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');
  return annee;
}

/** Nom de fichier ASCII sûr : les libellés viennent de la base (accents, espaces, et rien ne doit pouvoir sortir de l'en-tête) */
function nomFichier(base, annee) {
  const sur = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^0-9A-Za-z]+/g, '-').replace(/^-|-$/g, '');
  return `${sur(base)}-${sur(annee)}.csv`;
}

async function envoyer(req, res, { action, base, annee, colonnes, lignes, filtres }) {
  const db = getDB();
  await db('journal_audit').insert({
    etablissement_id: req.etablissement_id, utilisateur_id: req.session.utilisateur_id,
    action, resultat: 'succes', table_cible: 'exports',
    details: JSON.stringify({ lignes: lignes.length, filtres }),
  });
  res.set({
    'Content-Type':        'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${nomFichier(base, annee)}"`,
    'Cache-Control':       'no-store',
  });
  return res.status(200).send(versCsv(colonnes, lignes));
}

// ── GET /exports/eleves.csv ─────────────────────────────────────
router.get('/exports/eleves.csv', auth, isoler, perm('rapports.exporter'), perm('eleves.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const classeId = lire(req, 'classe_id', UUID);
    const statut = req.query.statut || 'actif';
    if (!['actif', 'retires', 'tous'].includes(statut)) throw ApiError.validationEchouee('statut : actif, retires ou tous');
    const annee = await anneeCourante(db, req.etablissement_id);

    let q = db('inscriptions as i')
      .join('eleves as e', 'e.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
      .join('classes as c', 'c.id', 'i.classe_id')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .leftJoin('parents_eleves as pe', function () { this.on('pe.eleve_id', 'e.id').andOn('pe.est_contact_principal', db.raw('TRUE')); })
      .leftJoin('utilisateurs as up', 'up.id', 'pe.parent_id')
      .where({ 'i.annee_scolaire_id': annee.id, 'u.etablissement_id': req.etablissement_id });
    if (statut === 'actif') q = q.where('i.statut', 'actif');
    else if (statut === 'retires') q = q.whereNotIn('i.statut', ['actif', 'diplome']);
    if (classeId) q = q.where('i.classe_id', classeId);

    const lignes = (await q.orderBy(['n.ordre', 'c.nom', 'u.nom', 'u.prenom']).limit(LIMITE_LIGNES).select(
      'e.matricule', 'u.nom', 'u.prenom', 'u.genre', 'u.date_naissance', 'n.nom as niveau', 'c.nom as classe_nom',
      'i.statut', 'e.redoublant', 'up.nom as contact_nom', 'up.prenom as contact_prenom', 'up.telephone as contact_telephone',
    )).map((l) => ({
      ...l, classe: `${l.niveau} ${l.classe_nom}`, statut: STATUTS_INSCRIPTION[l.statut] || l.statut,
      contact: [l.contact_prenom, l.contact_nom].filter(Boolean).join(' '),
    }));

    return await envoyer(req, res, {
      action: 'export.eleves', base: 'eleves', annee: annee.libelle, lignes, filtres: { statut, classe: Boolean(classeId) },
      colonnes: [
        { cle: 'matricule', titre: 'Matricule' }, { cle: 'nom', titre: 'Nom' }, { cle: 'prenom', titre: 'Prénom' },
        { cle: 'genre', titre: 'Genre' }, { cle: 'date_naissance', titre: 'Date de naissance' }, { cle: 'classe', titre: 'Classe' },
        { cle: 'statut', titre: 'Statut' }, { cle: 'redoublant', titre: 'Redoublant' },
        { cle: 'contact', titre: 'Contact principal' }, { cle: 'contact_telephone', titre: 'Téléphone du contact' },
      ],
    });
  } catch (err) { next(err); }
});

// ── GET /exports/moyennes.csv?periode_id=… ──────────────────────
router.get('/exports/moyennes.csv', auth, isoler, perm('rapports.exporter'), perm('notes.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const periodeId = lire(req, 'periode_id', UUID);
    if (!periodeId) throw ApiError.validationEchouee('periode_id est obligatoire');
    const classeId = lire(req, 'classe_id', UUID);

    const periode = await db('periodes as p').join('annees_scolaires as a', 'a.id', 'p.annee_scolaire_id')
      .where({ 'p.id': periodeId, 'a.etablissement_id': req.etablissement_id }).first('p.id', 'p.libelle', 'a.libelle as annee');
    if (!periode) throw ApiError.nonTrouve('Période introuvable');

    let q = db('moyennes_generales as mg')
      .join('inscriptions as i', 'i.id', 'mg.inscription_id')
      .join('eleves as e', 'e.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
      .join('classes as c', 'c.id', 'i.classe_id')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .where({ 'mg.periode_id': periode.id, 'u.etablissement_id': req.etablissement_id });
    if (classeId) q = q.where('i.classe_id', classeId);

    const lignes = (await q.orderBy(['n.ordre', 'c.nom']).orderByRaw('mg.rang ASC NULLS LAST').orderBy('u.nom').limit(LIMITE_LIGNES).select(
      'n.nom as niveau', 'c.nom as classe_nom', 'mg.rang', 'mg.rang_sur', 'e.matricule', 'u.nom', 'u.prenom',
      'mg.moyenne_generale', 'mg.mention', 'mg.decision_conseil', 'mg.nb_absences_justifiees', 'mg.nb_absences_injustifiees', 'mg.nb_retards',
    )).map((l) => ({ ...l, classe: `${l.niveau} ${l.classe_nom}`, moyenne_generale: l.moyenne_generale === null ? null : Number(l.moyenne_generale) }));

    return await envoyer(req, res, {
      action: 'export.moyennes', base: `moyennes-${periode.libelle}`, annee: periode.annee, lignes, filtres: { periode: periode.id, classe: Boolean(classeId) },
      colonnes: [
        { cle: 'classe', titre: 'Classe' }, { cle: 'rang', titre: 'Rang' }, { cle: 'rang_sur', titre: 'Classés' },
        { cle: 'matricule', titre: 'Matricule' }, { cle: 'nom', titre: 'Nom' }, { cle: 'prenom', titre: 'Prénom' },
        { cle: 'moyenne_generale', titre: 'Moyenne générale' }, { cle: 'mention', titre: 'Mention' }, { cle: 'decision_conseil', titre: 'Décision du conseil' },
        { cle: 'nb_absences_justifiees', titre: 'Absences justifiées' }, { cle: 'nb_absences_injustifiees', titre: 'Absences injustifiées' }, { cle: 'nb_retards', titre: 'Retards' },
      ],
    });
  } catch (err) { next(err); }
});

// ── GET /exports/absences.csv?du=&au=&classe_id= ────────────────
router.get('/exports/absences.csv', auth, isoler, perm('rapports.exporter'), perm('absences.voir_classe'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await anneeCourante(db, req.etablissement_id);
    const du = lire(req, 'du', DATE, 'du : AAAA-MM-JJ');
    const au = lire(req, 'au', DATE, 'au : AAAA-MM-JJ');
    if (du && au && au < du) throw ApiError.validationEchouee('La date de fin précède la date de début');
    const classeId = lire(req, 'classe_id', UUID);

    let q = db('presences as pr')
      .join('appels as ap', 'ap.id', 'pr.appel_id')
      .join('emplois_du_temps as edt', 'edt.id', 'ap.emploi_du_temps_id')
      .join('affectations_enseignants as ae', 'ae.id', 'edt.affectation_id')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .join('inscriptions as i', 'i.id', 'pr.inscription_id')
      .join('eleves as e', 'e.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
      .join('classes as c', 'c.id', 'i.classe_id')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .where({ 'i.annee_scolaire_id': annee.id, 'u.etablissement_id': req.etablissement_id })
      .whereIn('pr.statut', Object.keys(STATUTS_PRESENCE));
    if (du) q = q.where('ap.date_cours', '>=', du);
    if (au) q = q.where('ap.date_cours', '<=', au);
    if (classeId) q = q.where('i.classe_id', classeId);

    const lignes = (await q.orderBy([{ column: 'ap.date_cours' }, { column: 'n.ordre' }, { column: 'c.nom' }, { column: 'u.nom' }]).limit(LIMITE_LIGNES).select(
      'ap.date_cours', 'n.nom as niveau', 'c.nom as classe_nom', 'e.matricule', 'u.nom', 'u.prenom', 'm.nom as matiere',
      'pr.statut', 'pr.minutes_retard', 'pr.est_justifie', 'pr.motif_justification',
    )).map((l) => ({ ...l, classe: `${l.niveau} ${l.classe_nom}`, statut: STATUTS_PRESENCE[l.statut] }));

    return await envoyer(req, res, {
      action: 'export.absences', base: 'absences', annee: annee.libelle, lignes, filtres: { du, au, classe: Boolean(classeId) },
      colonnes: [
        { cle: 'date_cours', titre: 'Date' }, { cle: 'classe', titre: 'Classe' }, { cle: 'matricule', titre: 'Matricule' },
        { cle: 'nom', titre: 'Nom' }, { cle: 'prenom', titre: 'Prénom' }, { cle: 'matiere', titre: 'Matière' },
        { cle: 'statut', titre: 'Statut' }, { cle: 'minutes_retard', titre: 'Minutes de retard' },
        { cle: 'est_justifie', titre: 'Justifiée' }, { cle: 'motif_justification', titre: 'Motif' },
      ],
    });
  } catch (err) { next(err); }
});

// ── GET /exports/sanctions.csv ──────────────────────────────────
router.get('/exports/sanctions.csv', auth, isoler, perm('rapports.exporter'), perm('discipline.voir'), async (req, res, next) => {
  try {
    const db = getDB();
    const annee = await anneeCourante(db, req.etablissement_id);
    const classeId = lire(req, 'classe_id', UUID);
    const type = req.query.type;
    if (type !== undefined && type !== '' && !TYPES_SANCTION[type]) throw ApiError.validationEchouee('type de sanction inconnu');

    let q = db('sanctions as s')
      .join('inscriptions as i', 'i.id', 's.inscription_id')
      .join('eleves as e', 'e.id', 'i.eleve_id')
      .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
      .join('classes as c', 'c.id', 'i.classe_id')
      .join('niveaux as n', 'n.id', 'c.niveau_id')
      .join('utilisateurs as up', 'up.id', 's.prononcee_par')
      .where({ 'i.annee_scolaire_id': annee.id, 'u.etablissement_id': req.etablissement_id });
    if (classeId) q = q.where('i.classe_id', classeId);
    if (type) q = q.where('s.type', type);

    const lignes = (await q.orderBy('s.date_prononcee', 'desc').limit(LIMITE_LIGNES).select(
      's.date_prononcee', 'n.nom as niveau', 'c.nom as classe_nom', 'e.matricule', 'u.nom', 'u.prenom',
      's.type', 's.motif', 's.nb_jours', 'up.nom as par_nom', 'up.prenom as par_prenom',
    )).map((l) => ({
      ...l, classe: `${l.niveau} ${l.classe_nom}`, type: TYPES_SANCTION[l.type] || l.type,
      prononcee_par: `${l.par_prenom} ${l.par_nom}`,
    }));

    return await envoyer(req, res, {
      action: 'export.sanctions', base: 'sanctions', annee: annee.libelle, lignes, filtres: { type: type || null, classe: Boolean(classeId) },
      colonnes: [
        { cle: 'date_prononcee', titre: 'Date' }, { cle: 'classe', titre: 'Classe' }, { cle: 'matricule', titre: 'Matricule' },
        { cle: 'nom', titre: 'Nom' }, { cle: 'prenom', titre: 'Prénom' }, { cle: 'type', titre: 'Sanction' },
        { cle: 'motif', titre: 'Motif' }, { cle: 'nb_jours', titre: 'Jours' }, { cle: 'prononcee_par', titre: 'Prononcée par' },
      ],
    });
  } catch (err) { next(err); }
});

module.exports = router;
