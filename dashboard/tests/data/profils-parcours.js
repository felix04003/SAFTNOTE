// @ts-check
/**
 * Profils créés par le parcours « école complète » (specs/parcours-ecole.spec.js), partie web.
 *
 * Tout est généré à chaque exécution avec un suffixe unique : numéros de téléphone (uniques par école),
 * emails du personnel (uniques sur TOUTE la base : règle 9bis, un directeur ou un enseignant ne partage jamais
 * son email) et nom de l'école. Le parcours peut donc être rejoué sur une base conservée.
 *
 * Profils :
 *   1 école            Lycée Parcours <suffixe> (Thiès)
 *   1 directeur        Mamadou Diallo
 *   2 enseignants      Aïssatou Sow (Mathématiques, 2 classes), Ibrahima Ba (Français, 1 classe)
 *   3 parents          dont Papa Ndiaye, père de DEUX élèves dans deux classes (fratrie)
 *   4 élèves           Fatou et Moussa Ndiaye, Awa Traoré, Cheikh Fall
 *   2 classes          6ème A, 5ème B
 *   2 matières         Mathématiques, Français
 *   3 évaluations      avec les notes de chaque élève de la classe
 */

/**
 * @param {string} [suffixe] 7 chiffres ; par défaut dérivé de l'horloge
 */
function creerJeuDeProfils(suffixe = String(Date.now()).slice(-7)) {
  // Numéro sénégalais unique par profil : +221 77 XXXXXXX, le dernier chiffre distingue les profils
  const tel = (/** @type {number} */ i) => `+22177${String((Number(suffixe) * 10 + i) % 10000000).padStart(7, '0')}`;
  const mail = (/** @type {string} */ prenom, /** @type {string} */ nom) =>
    `${prenom}.${nom}.${suffixe}@parcours-e2e.test.sn`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  const parents = {
    ndiaye: { prenom: 'Papa', nom: 'Ndiaye', telephone: tel(5), lien: 'pere' },
    traore: { prenom: 'Mariama', nom: 'Traoré', telephone: tel(6), lien: 'mere' },
    fall:   { prenom: 'Ousmane', nom: 'Fall', telephone: tel(7), lien: 'pere' },
  };

  return {
    suffixe,

    ecole: { nom: `Lycée Parcours ${suffixe}`, ville: 'Thiès' },

    directeur: {
      prenom: 'Mamadou', nom: 'Diallo',
      email: mail('mamadou', 'diallo'), telephone: tel(1), mdp: 'Direction2026x',
    },

    matieres: [
      { nom: 'Mathématiques', court: 'Maths', code: 'MATH' },
      { nom: 'Français',      court: 'Fr',    code: 'FRA' },
    ],

    // Les niveaux (6ème, 5ème…) sont créés avec l'école ; une classe = un niveau + une lettre
    classes: [
      { niveau: '6ème', lettre: 'A', salle: 'Salle 1', effectif: 35 },
      { niveau: '5ème', lettre: 'B', salle: 'Salle 2', effectif: 35 },
    ],

    enseignants: [
      {
        prenom: 'Aïssatou', nom: 'Sow', email: mail('aissatou', 'sow'), telephone: tel(2),
        specialite: 'Mathématiques', contrat: 'titulaire', mdp: 'Enseign1Sow',
        affectations: [
          { classe: '6ème A', matiere: 'Mathématiques', titulaire: true },    // titulaire de ces deux classes
          { classe: '5ème B', matiere: 'Mathématiques', titulaire: true },
        ],
      },
      {
        prenom: 'Ibrahima', nom: 'Ba', email: mail('ibrahima', 'ba'), telephone: tel(3),
        specialite: 'Français', contrat: 'contractuel', mdp: 'Enseign2Ba9',
        affectations: [{ classe: '6ème A', matiere: 'Français', titulaire: false }],
      },
    ],

    parents,

    eleves: [
      { prenom: 'Fatou',  nom: 'Ndiaye', naissance: '2013-03-14', genre: 'F', classe: '6ème A', parent: parents.ndiaye },
      { prenom: 'Moussa', nom: 'Ndiaye', naissance: '2012-07-02', genre: 'M', classe: '5ème B', parent: parents.ndiaye },   // fratrie
      { prenom: 'Awa',    nom: 'Traoré', naissance: '2013-11-23', genre: 'F', classe: '6ème A', parent: parents.traore },
      { prenom: 'Cheikh', nom: 'Fall',   naissance: '2012-01-30', genre: 'M', classe: '5ème B', parent: parents.fall },
    ],

    // Notes par « Prénom Nom » ; chaque évaluation concerne tous les élèves de sa classe
    evaluations: [
      { matiere: 'Mathématiques', classe: '6ème A', type: 'devoir',      numero: 1, titre: 'Devoir 1 Maths 6A',   noteMax: 20, date: '2026-11-12',
        notes: { 'Fatou Ndiaye': 15, 'Awa Traoré': 12.5 } },
      { matiere: 'Mathématiques', classe: '5ème B', type: 'devoir',      numero: 1, titre: 'Devoir 1 Maths 5B',   noteMax: 20, date: '2026-11-13',
        notes: { 'Moussa Ndiaye': 9, 'Cheikh Fall': 17 } },
      { matiere: 'Français',      classe: '6ème A', type: 'composition', numero: 1, titre: 'Composition 1 Fr 6A', noteMax: 20, date: '2026-11-20',
        notes: { 'Fatou Ndiaye': 13, 'Awa Traoré': 16 } },
    ],
  };
}

module.exports = { creerJeuDeProfils };
