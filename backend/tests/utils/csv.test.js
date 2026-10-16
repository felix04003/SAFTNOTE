'use strict';

const { versCsv, cellule } = require('../../src/utils/csv');

describe('cellule', () => {
  test('texte simple, vide, booléen, nombre à virgule', () => {
    expect(cellule('Diop')).toBe('Diop');
    expect(cellule(null)).toBe('');
    expect(cellule(undefined)).toBe('');
    expect(cellule(true)).toBe('Oui');
    expect(cellule(false)).toBe('Non');
    expect(cellule(12.5)).toBe('12,5');
    expect(cellule(7)).toBe('7');
    expect(cellule(NaN)).toBe('');
  });

  test('guillemets doublés ; séparateur, guillemet et saut de ligne entourent la cellule de guillemets', () => {
    expect(cellule('a;b')).toBe('"a;b"');
    expect(cellule('dit "oui"')).toBe('"dit ""oui"""');
    expect(cellule('ligne1\nligne2')).toBe('"ligne1\nligne2"');
  });

  test('injection de formule : = + - @ en tête sont neutralisés, un numéro de téléphone reste lisible', () => {
    for (const piege of ['=SOMME(A1:A9)', '+cmd|calc', '-2+3', '@SUM(1)', '\tx', '\rx']) {
      expect(cellule(piege).replace(/^"/, '')[0]).toBe("'");
    }
    expect(cellule('+221771234567')).toBe('+221771234567');
    expect(cellule('=1+1;2')).toBe('"\'=1+1;2"');             // neutralisée ET protégée par des guillemets
    expect(cellule(-3)).toBe('-3');                          // un nombre n'est pas du texte
  });

  test('une date PostgreSQL (minuit local) garde son jour, quel que soit le fuseau', () => {
    expect(cellule(new Date(2013, 2, 14))).toBe('2013-03-14');
  });
});

describe('versCsv', () => {
  test('BOM, séparateur « ; », CRLF, en-tête puis lignes dans l\'ordre des colonnes', () => {
    const texte = versCsv([{ cle: 'nom', titre: 'Nom' }, { cle: 'moy', titre: 'Moyenne' }], [{ moy: 14.25, nom: 'Awa' }, { nom: 'Fatou', moy: null }]);
    expect(texte).toBe('\uFEFFNom;Moyenne\r\nAwa;14,25\r\nFatou;\r\n');
  });
  test('sans ligne : l\'en-tête seul', () => {
    expect(versCsv([{ cle: 'a', titre: 'A' }], [])).toBe('\uFEFFA\r\n');
  });
});
