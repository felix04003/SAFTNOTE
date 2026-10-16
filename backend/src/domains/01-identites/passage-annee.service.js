'use strict';

/**
 * Fin d'année et réinscription.
 *
 * Le passage est UNE transaction : clôture de l'année courante, ouverture de la suivante (périodes comprises),
 * reconduction des classes, nouvelle inscription de chaque élève admis ou redoublant, décision de fin d'année
 * enregistrée sur l'ancienne inscription. Rien n'est supprimé : l'année clôturée garde ses notes et bulletins.
 */

const { v4: uuid } = require('uuid');
const ApiError = require('../../utils/ApiError');

const DECISIONS = ['admis', 'redouble', 'diplome', 'transfere', 'abandonne', 'exclu'];
const SORTIES = ['diplome', 'transfere', 'abandonne', 'exclu'];
const SEUIL_DEFAUT = 10;

// ── Dates (AAAA-MM-JJ, calculées en UTC : aucun décalage de fuseau) ──────────

/** DATE de PostgreSQL (objet Date à minuit local) ou texte → 'AAAA-MM-JJ' */
function iso(valeur) {
  if (valeur instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${valeur.getFullYear()}-${p(valeur.getMonth() + 1)}-${p(valeur.getDate())}`;
  }
  return String(valeur).slice(0, 10);
}

function jours(dateIso) {
  const [a, m, j] = dateIso.split('-').map(Number);
  return Date.UTC(a, m - 1, j) / 86400000;
}

function depuisJours(n) {
  const d = new Date(n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Même jour, `n` années plus tard (29 février → 28 février les années non bissextiles) */
function ajouterAnnees(dateIso, n) {
  const [a, m, j] = dateIso.split('-').map(Number);
  const cible = a + n;
  const dernierJour = new Date(Date.UTC(cible, m, 0)).getUTCDate();
  const p = (x) => String(x).padStart(2, '0');
  return `${cible}-${p(m)}-${p(Math.min(j, dernierJour))}`;
}

/** '2025-2026' → '2026-2027' (null si le libellé n'a pas ce format) */
function libelleSuivant(libelle) {
  const m = /^(\d{4})-(\d{4})$/.exec(String(libelle));
  return m ? `${Number(m[1]) + 1}-${Number(m[2]) + 1}` : null;
}

/** Découpe [debut, fin] en `nb` périodes contiguës de durée voisine. */
function genererPeriodes(dateDebut, dateFin, nb) {
  const debut = jours(dateDebut);
  const total = jours(dateFin) - debut + 1;
  const nom = nb === 2 ? 'Semestre' : 'Trimestre';
  const bornes = [];
  for (let i = 0; i <= nb; i++) bornes.push(debut + Math.round((i * total) / nb));
  return Array.from({ length: nb }, (_, i) => ({
    numero:     i + 1,
    libelle:    `${nom} ${i + 1}`,
    date_debut: depuisJours(bornes[i]),
    date_fin:   depuisJours(i === nb - 1 ? jours(dateFin) : bornes[i + 1] - 1),
  }));
}

// ── Lecture ──────────────────────────────────────────────────────────────────

async function anneeCourante(db, etablissementId) {
  return db('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .first('id', 'libelle', 'date_debut', 'date_fin', 'nb_periodes', 'type_periode', 'cloturee_at');
}

async function niveauxActifs(db, etablissementId) {
  return db('niveaux').where({ etablissement_id: etablissementId, actif: true }).orderBy('ordre').select('id', 'nom', 'ordre');
}

function niveauSuivant(niveaux, niveauId) {
  const courant = niveaux.find((n) => n.id === niveauId);
  if (!courant) return null;
  return niveaux.find((n) => n.ordre > courant.ordre) || null;     // `niveaux` est trié par ordre croissant
}

const absent = (v) => v === null || v === undefined;
const cle = (niveauId, nom) => `${niveauId}|${String(nom).toUpperCase()}`;

/** Proposition de décision : le conseil de classe prime, sinon la moyenne annuelle contre le seuil. */
function proposer({ moyenne, decisionConseil, seuil, dernierNiveau }) {
  let decision;
  if (decisionConseil === 'admis') decision = 'admis';
  else if (decisionConseil === 'ajourne' || decisionConseil === 'redoublant') decision = 'redouble';
  else if (decisionConseil === 'exclu') decision = 'exclu';
  else if (absent(moyenne)) decision = 'admis';
  else decision = moyenne >= seuil ? 'admis' : 'redouble';
  return decision === 'admis' && dernierNiveau ? 'diplome' : decision;
}

/**
 * Aperçu du passage : les classes de l'année courante, leurs élèves inscrits, une décision proposée pour chacun
 * et la classe d'accueil par défaut. Ne modifie rien.
 */
async function apercu(db, etablissementId, { seuil = SEUIL_DEFAUT } = {}) {
  const annee = await anneeCourante(db, etablissementId);
  if (!annee) throw ApiError.nonTrouve('Aucune année scolaire courante');

  const niveaux = await niveauxActifs(db, etablissementId);

  const classes = await db('classes as c')
    .join('niveaux as n', 'n.id', 'c.niveau_id')
    .where({ 'c.annee_scolaire_id': annee.id, 'c.actif': true })
    .orderBy(['n.ordre', 'c.nom'])
    .select('c.id', 'c.nom', 'c.niveau_id', 'n.nom as niveau');

  const lignes = await db('inscriptions as i')
    .join('eleves as e', 'e.id', 'i.eleve_id')
    .join('utilisateurs as u', 'u.id', 'e.utilisateur_id')
    .where({ 'i.annee_scolaire_id': annee.id, 'i.statut': 'actif' })
    .orderBy(['u.nom', 'u.prenom'])
    .select('i.id as inscription_id', 'i.classe_id', 'u.id as utilisateur_id', 'u.nom', 'u.prenom', 'e.matricule');

  // Moyenne annuelle = moyenne des moyennes générales des périodes calculées ; décision du conseil = celle de la
  // dernière période qui en porte une (en_attente ne compte pas)
  const moyennes = await db('moyennes_generales as mg')
    .join('periodes as p', 'p.id', 'mg.periode_id')
    .join('inscriptions as i', 'i.id', 'mg.inscription_id')
    .where({ 'i.annee_scolaire_id': annee.id })
    .orderBy('p.numero')
    .select('mg.inscription_id', 'mg.moyenne_generale', 'mg.decision_passage', 'p.numero');
  const parInscription = new Map();
  for (const m of moyennes) {
    const entree = parInscription.get(m.inscription_id) || { valeurs: [], decision: null };
    if (!absent(m.moyenne_generale)) entree.valeurs.push(Number(m.moyenne_generale));
    if (m.decision_passage && m.decision_passage !== 'en_attente') entree.decision = m.decision_passage;
    parInscription.set(m.inscription_id, entree);
  }

  const sortie = classes.map((c) => {
    const suivant = niveauSuivant(niveaux, c.niveau_id);
    const dernierNiveau = !suivant;
    const cibles = suivant
      ? [{ niveau_id: suivant.id, niveau: suivant.nom, nom: c.nom }]
      : [];
    if (suivant) {
      for (const autre of classes) {
        if (autre.niveau_id === suivant.id && !cibles.some((x) => cle(x.niveau_id, x.nom) === cle(autre.niveau_id, autre.nom))) {
          cibles.push({ niveau_id: autre.niveau_id, niveau: autre.niveau, nom: autre.nom });
        }
      }
    }
    return {
      classe_id: c.id, niveau_id: c.niveau_id, niveau: c.niveau, nom: c.nom,
      libelle: `${c.niveau} ${c.nom}`,
      dernier_niveau: dernierNiveau,
      cible_admis: cibles[0] ? { ...cibles[0], libelle: `${cibles[0].niveau} ${cibles[0].nom}` } : null,
      cibles_possibles: cibles.map((x) => ({ ...x, libelle: `${x.niveau} ${x.nom}` })),
      eleves: lignes.filter((l) => l.classe_id === c.id).map((l) => {
        const m = parInscription.get(l.inscription_id) || { valeurs: [], decision: null };
        const moyenne = m.valeurs.length ? Math.round((m.valeurs.reduce((a, b) => a + b, 0) / m.valeurs.length) * 100) / 100 : null;
        return {
          inscription_id: l.inscription_id, utilisateur_id: l.utilisateur_id,
          nom: l.nom, prenom: l.prenom, matricule: l.matricule,
          moyenne_annuelle: moyenne, decision_conseil: m.decision, sans_moyenne: absent(moyenne),
          proposition: proposer({ moyenne, decisionConseil: m.decision, seuil, dernierNiveau }),
        };
      }),
    };
  });

  const debut = iso(annee.date_debut);
  const fin = iso(annee.date_fin);
  return {
    annee: { id: annee.id, libelle: annee.libelle, date_debut: debut, date_fin: fin, nb_periodes: annee.nb_periodes },
    proposition_annee: {
      libelle:     libelleSuivant(annee.libelle),
      date_debut:  ajouterAnnees(debut, 1),
      date_fin:    ajouterAnnees(fin, 1),
      nb_periodes: annee.nb_periodes,
    },
    seuil,
    classes: sortie,
    total_eleves: lignes.length,
  };
}

// ── Passage ──────────────────────────────────────────────────────────────────

/**
 * Exécute le passage dans la transaction `trx`. `params` : { libelle, date_debut, date_fin, nb_periodes?, periodes?,
 * copier_affectations?, decisions: [{ inscription_id, decision, classe_cible?: { niveau_id, nom } }] }.
 * Retourne un compte rendu ; toute erreur annule l'ensemble.
 */
async function effectuerPassage(trx, { etablissementId, utilisateurId, params }) {
  // 1. Verrou sur l'année courante : deux passages simultanés ne peuvent pas réussir tous les deux
  const ancienne = await trx('annees_scolaires')
    .where({ etablissement_id: etablissementId, est_courante: true })
    .forUpdate()
    .first('id', 'libelle', 'date_debut', 'date_fin', 'nb_periodes');
  if (!ancienne) throw ApiError.conflit('Aucune année scolaire courante à clôturer');

  const debutAncienne = iso(ancienne.date_debut);
  if (params.date_fin <= params.date_debut) throw ApiError.validationEchouee('La fin de l\'année doit suivre son début');
  if (params.date_debut <= debutAncienne) throw ApiError.validationEchouee('La nouvelle année doit commencer après l\'année en cours');

  const existe = await trx('annees_scolaires').where({ etablissement_id: etablissementId, libelle: params.libelle }).first('id');
  if (existe) throw ApiError.conflit(`L'année ${params.libelle} existe déjà`);

  const nb = params.nb_periodes || ancienne.nb_periodes;
  let periodes = params.periodes;
  if (periodes && periodes.length) {
    const numeros = periodes.map((p) => p.numero).sort();
    if (periodes.length !== nb || numeros.some((n, i) => n !== i + 1)) {
      throw ApiError.validationEchouee(`${nb} périodes numérotées de 1 à ${nb} sont attendues`);
    }
    for (const p of periodes) {
      if (p.date_fin <= p.date_debut || p.date_debut < params.date_debut || p.date_fin > params.date_fin) {
        throw ApiError.validationEchouee(`La période ${p.numero} doit rester dans l'année et finir après son début`);
      }
    }
  } else {
    periodes = genererPeriodes(params.date_debut, params.date_fin, nb);
  }

  // 2. Décisions : une pour CHAQUE inscription active de l'année, ni plus ni moins
  const actives = await trx('inscriptions as i')
    .join('classes as c', 'c.id', 'i.classe_id')
    .where({ 'i.annee_scolaire_id': ancienne.id, 'i.statut': 'actif' })
    .select('i.id', 'i.eleve_id', 'i.classe_id', 'c.niveau_id', 'c.nom as classe_nom');
  const parId = new Map(actives.map((a) => [a.id, a]));
  const vues = new Set();
  for (const d of params.decisions) {
    if (!parId.has(d.inscription_id)) throw ApiError.validationEchouee('Une décision concerne un élève qui n\'est pas inscrit dans l\'année en cours');
    if (vues.has(d.inscription_id)) throw ApiError.validationEchouee('Un élève a reçu deux décisions');
    vues.add(d.inscription_id);
  }
  if (vues.size !== actives.length) {
    throw ApiError.validationEchouee(`${actives.length - vues.size} élève(s) inscrit(s) n'ont pas de décision : chaque élève doit être admis, redoubler ou sortir`);
  }

  // 3. Classes d'accueil
  const niveaux = await niveauxActifs(trx, etablissementId);
  const niveauxParId = new Map(niveaux.map((n) => [n.id, n]));
  const anciennesClasses = await trx('classes').where({ annee_scolaire_id: ancienne.id, actif: true })
    .select('id', 'niveau_id', 'nom', 'salle_principale', 'effectif_max');

  const aCreer = new Map();      // cle -> { niveau_id, nom }
  for (const c of anciennesClasses) aCreer.set(cle(c.niveau_id, c.nom), { niveau_id: c.niveau_id, nom: c.nom, ancienne: c });
  const cibleDe = new Map();     // inscription_id -> cle
  for (const d of params.decisions) {
    const a = parId.get(d.inscription_id);
    if (SORTIES.includes(d.decision)) {
      if (d.decision === 'diplome' && niveauSuivant(niveaux, a.niveau_id)) {
        throw ApiError.validationEchouee('Seuls les élèves du dernier niveau peuvent être diplômés');
      }
      continue;
    }
    let niveauId; let nom;
    if (d.decision === 'redouble') {
      niveauId = a.niveau_id; nom = a.classe_nom;
    } else if (d.classe_cible) {
      niveauId = d.classe_cible.niveau_id; nom = String(d.classe_cible.nom).toUpperCase();
    } else {
      const suivant = niveauSuivant(niveaux, a.niveau_id);
      if (!suivant) throw ApiError.validationEchouee('Un élève du dernier niveau ne peut pas passer au niveau suivant : choisissez « diplômé »');
      niveauId = suivant.id; nom = a.classe_nom;
    }
    if (!niveauxParId.has(niveauId)) throw ApiError.validationEchouee('Niveau d\'accueil inconnu');
    if (d.decision === 'admis' && d.classe_cible) {
      const origine = niveauxParId.get(a.niveau_id);
      if (niveauxParId.get(niveauId).ordre <= origine.ordre) throw ApiError.validationEchouee('Un élève admis ne peut pas être placé dans un niveau inférieur ou égal');
    }
    const k = cle(niveauId, nom);
    if (!aCreer.has(k)) aCreer.set(k, { niveau_id: niveauId, nom, ancienne: null });
    cibleDe.set(d.inscription_id, k);
  }

  // 4. Clôture + nouvelle année
  await trx('annees_scolaires').where({ id: ancienne.id }).update({ est_courante: false, cloturee_at: trx.raw('NOW()') });
  const [nouvelle] = await trx('annees_scolaires').insert({
    id: uuid(), etablissement_id: etablissementId, libelle: params.libelle,
    date_debut: params.date_debut, date_fin: params.date_fin,
    nb_periodes: nb, type_periode: nb === 2 ? 'semestre' : 'trimestre', est_courante: true,
  }).returning(['id', 'libelle']);
  await trx('periodes').insert(periodes.map((p) => ({ id: uuid(), annee_scolaire_id: nouvelle.id, numero: p.numero, libelle: p.libelle, date_debut: p.date_debut, date_fin: p.date_fin })));

  // 5. Classes de la nouvelle année (reconduction des anciennes + classes d'accueil manquantes)
  const classeParCle = new Map();
  const correspondance = new Map();        // ancienne classe -> nouvelle classe (pour les affectations)
  for (const [k, c] of aCreer) {
    const id = uuid();
    await trx('classes').insert({
      id, annee_scolaire_id: nouvelle.id, niveau_id: c.niveau_id, nom: c.nom,
      salle_principale: c.ancienne ? c.ancienne.salle_principale : null,
      effectif_max: c.ancienne ? c.ancienne.effectif_max : null,
    });
    classeParCle.set(k, id);
    if (c.ancienne) correspondance.set(c.ancienne.id, id);
  }

  // 6. Réinscriptions + décision de fin d'année sur les anciennes inscriptions
  const bilan = { admis: 0, redoublants: 0, diplomes: 0, transferts: 0, abandons: 0, exclus: 0 };
  const nouvelles = [];
  const redoublants = []; const admis = [];
  for (const d of params.decisions) {
    const a = parId.get(d.inscription_id);
    const sortie = SORTIES.includes(d.decision);
    await trx('inscriptions').where({ id: a.id }).update(
      sortie
        ? { decision_fin_annee: d.decision, statut: d.decision, date_fin: trx.raw('CURRENT_DATE') }
        : { decision_fin_annee: d.decision }
    );
    if (sortie) {
      bilan[{ diplome: 'diplomes', transfere: 'transferts', abandonne: 'abandons', exclu: 'exclus' }[d.decision]]++;
      continue;
    }
    nouvelles.push({ id: uuid(), eleve_id: a.eleve_id, classe_id: classeParCle.get(cibleDe.get(a.id)), annee_scolaire_id: nouvelle.id, statut: 'actif' });
    if (d.decision === 'redouble') { bilan.redoublants++; redoublants.push(a.eleve_id); } else { bilan.admis++; admis.push(a.eleve_id); }
  }
  if (nouvelles.length) await trx.batchInsert('inscriptions', nouvelles, 200);
  if (redoublants.length) await trx('eleves').whereIn('id', redoublants).update({ redoublant: true });
  if (admis.length) await trx('eleves').whereIn('id', admis).update({ redoublant: false });

  // 7. Affectations des enseignants (facultatif) : mêmes enseignant, matière et classe dans la nouvelle année
  let affectationsCopiees = 0;
  if (params.copier_affectations) {
    const anciennes = await trx('affectations_enseignants as ae')
      .join('matieres as m', 'm.id', 'ae.matiere_id')
      .join('enseignants as en', 'en.id', 'ae.enseignant_id')
      .join('utilisateurs as u', 'u.id', 'en.utilisateur_id')
      .where({ 'ae.annee_scolaire_id': ancienne.id, 'm.actif': true, 'u.actif': true })
      .whereNull('ae.date_fin')
      .select('ae.enseignant_id', 'ae.matiere_id', 'ae.classe_id', 'ae.est_titulaire');
    const lignes = anciennes.filter((x) => correspondance.has(x.classe_id)).map((x) => ({
      id: uuid(), enseignant_id: x.enseignant_id, matiere_id: x.matiere_id,
      classe_id: correspondance.get(x.classe_id), annee_scolaire_id: nouvelle.id, est_titulaire: x.est_titulaire,
    }));
    if (lignes.length) await trx.batchInsert('affectations_enseignants', lignes, 200);
    affectationsCopiees = lignes.length;
  }

  await trx('journal_audit').insert({
    etablissement_id: etablissementId, utilisateur_id: utilisateurId,
    action: 'annee.passage', resultat: 'succes', table_cible: 'annees_scolaires', enregistrement_id: nouvelle.id,
    details: JSON.stringify({ de: ancienne.libelle, vers: nouvelle.libelle, ...bilan, affectations_copiees: affectationsCopiees }),
  });

  return {
    annee_id: nouvelle.id, libelle: nouvelle.libelle, ancienne_annee: ancienne.libelle,
    classes_creees: aCreer.size, reinscrits: nouvelles.length, ...bilan, affectations_copiees: affectationsCopiees,
  };
}

module.exports = {
  DECISIONS, SEUIL_DEFAUT,
  iso, ajouterAnnees, libelleSuivant, genererPeriodes, niveauSuivant, proposer,
  apercu, effectuerPassage,
};
