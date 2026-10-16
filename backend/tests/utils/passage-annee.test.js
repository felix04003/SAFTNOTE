'use strict';

const {
  iso, ajouterAnnees, libelleSuivant, genererPeriodes, niveauSuivant, proposer,
} = require('../../src/domains/01-identites/passage-annee.service');

describe('dates du passage d\'année', () => {
  test('iso : une DATE PostgreSQL (minuit local) donne le même jour, sans décalage', () => {
    expect(iso(new Date(2025, 9, 1))).toBe('2025-10-01');
    expect(iso('2025-07-15T00:00:00.000Z')).toBe('2025-07-15');
  });

  test('ajouterAnnees : +1 an, le 29 février devient le 28 février', () => {
    expect(ajouterAnnees('2025-10-01', 1)).toBe('2026-10-01');
    expect(ajouterAnnees('2028-02-29', 1)).toBe('2029-02-28');
    expect(ajouterAnnees('2027-02-28', 1)).toBe('2028-02-28');
  });

  test('libelleSuivant', () => {
    expect(libelleSuivant('2025-2026')).toBe('2026-2027');
    expect(libelleSuivant('n/a')).toBeNull();
  });
});

describe('genererPeriodes', () => {
  function verifier(debut, fin, nb) {
    const periodes = genererPeriodes(debut, fin, nb);
    expect(periodes).toHaveLength(nb);
    expect(periodes[0].date_debut).toBe(debut);
    expect(periodes[nb - 1].date_fin).toBe(fin);
    for (let i = 0; i < nb; i++) {
      expect(periodes[i].numero).toBe(i + 1);
      expect(periodes[i].date_fin > periodes[i].date_debut).toBe(true);
      if (i > 0) {
        // contiguës : le jour d'après la fin d'une période est le début de la suivante
        const veille = new Date(periodes[i].date_debut + 'T00:00:00Z'); veille.setUTCDate(veille.getUTCDate() - 1);
        expect(veille.toISOString().slice(0, 10)).toBe(periodes[i - 1].date_fin);
      }
    }
    return periodes;
  }

  test('3 trimestres : couvrent toute l\'année, sans trou ni chevauchement', () => {
    const p = verifier('2026-10-01', '2027-07-15', 3);
    expect(p.map((x) => x.libelle)).toEqual(['Trimestre 1', 'Trimestre 2', 'Trimestre 3']);
  });

  test('2 semestres', () => {
    const p = verifier('2026-10-01', '2027-07-15', 2);
    expect(p.map((x) => x.libelle)).toEqual(['Semestre 1', 'Semestre 2']);
  });

  test('année bissextile et durée qui ne se divise pas', () => {
    verifier('2027-09-15', '2028-06-30', 3);
  });
});

describe('niveauSuivant', () => {
  const niveaux = [{ id: 'a', ordre: 1 }, { id: 'b', ordre: 2 }, { id: 'c', ordre: 5 }];
  test('le niveau d\'ordre immédiatement supérieur (même avec un trou), null pour le dernier', () => {
    expect(niveauSuivant(niveaux, 'a').id).toBe('b');
    expect(niveauSuivant(niveaux, 'b').id).toBe('c');
    expect(niveauSuivant(niveaux, 'c')).toBeNull();
    expect(niveauSuivant(niveaux, 'inconnu')).toBeNull();
  });
});

describe('proposer', () => {
  const base = { seuil: 10, dernierNiveau: false };
  test('le conseil de classe prime sur la moyenne', () => {
    expect(proposer({ ...base, moyenne: 5, decisionConseil: 'admis' })).toBe('admis');
    expect(proposer({ ...base, moyenne: 15, decisionConseil: 'ajourne' })).toBe('redouble');
    expect(proposer({ ...base, moyenne: 15, decisionConseil: 'redoublant' })).toBe('redouble');
    expect(proposer({ ...base, moyenne: 15, decisionConseil: 'exclu' })).toBe('exclu');
  });
  test('sans décision du conseil : la moyenne contre le seuil (le seuil lui-même est admis)', () => {
    expect(proposer({ ...base, moyenne: 10, decisionConseil: null })).toBe('admis');
    expect(proposer({ ...base, moyenne: 9.99, decisionConseil: null })).toBe('redouble');
    expect(proposer({ ...base, moyenne: 9, decisionConseil: null, seuil: 8 })).toBe('admis');
  });
  test('sans moyenne : admis par défaut (l\'écran le signale)', () => {
    expect(proposer({ ...base, moyenne: null, decisionConseil: null })).toBe('admis');
  });
  test('dernier niveau : « admis » devient « diplôme », un redoublement reste un redoublement', () => {
    expect(proposer({ moyenne: 12, decisionConseil: null, seuil: 10, dernierNiveau: true })).toBe('diplome');
    expect(proposer({ moyenne: 8, decisionConseil: null, seuil: 10, dernierNiveau: true })).toBe('redouble');
  });
});
