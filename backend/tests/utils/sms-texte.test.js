'use strict';

const { versGsm7, compterSegments, limiterSegments, preparerTexteSms } = require('../../src/utils/sms-texte');

describe('versGsm7', () => {
  test('laisse intact un texte déjà conforme (accents de l\'alphabet de base compris)', () => {
    const t = "Élève absent à l'école : père, mère, où ? 14,5/20 (été).";
    expect(versGsm7(t)).toBe(t);
  });

  test.each([
    ['—', '-'], ['–', '-'], ['’', "'"], ['“x”', '"x"'], ['«x»', '"x"'], ['…', '...'], ['œuvre', 'oeuvre'],
    ['êtes', 'etes'], ['île', 'ile'], ['côté', 'coté'], ['où', 'où'], ['ç', 'c'], ['Ça', 'Ça'], ['Être', 'Etre'],
    ['a b', 'a b'], ['10°', '10o'],
  ])('%s → %s', (entree, attendu) => expect(versGsm7(entree)).toBe(attendu));

  test('supprime ce qui n\'a pas d\'équivalent (emoji, caractères non latins)', () => {
    expect(versGsm7('Bravo 😀 !')).toBe('Bravo  !');
    expect(versGsm7('مرحبا')).toBe('');
  });

  test('le résultat est toujours en GSM-7', () => {
    const sale = "Lycée « Modèle » — île d’Ô, œuvre à 5° ☺ ç Ê";
    expect(compterSegments(versGsm7(sale)).encodage).toBe('GSM-7');
  });
});

describe('compterSegments', () => {
  test('GSM-7 : 160 caractères = 1 segment, 161 = 2 (153 par segment ensuite)', () => {
    expect(compterSegments('a'.repeat(160))).toMatchObject({ encodage: 'GSM-7', segments: 1 });
    expect(compterSegments('a'.repeat(161))).toMatchObject({ segments: 2 });
    expect(compterSegments('a'.repeat(306))).toMatchObject({ segments: 2 });
    expect(compterSegments('a'.repeat(307))).toMatchObject({ segments: 3 });
  });

  test('les caractères de la table d\'extension comptent double', () => {
    expect(compterSegments('['.repeat(80)).segments).toBe(1);
    expect(compterSegments('['.repeat(81)).segments).toBe(2);
  });

  test('un seul caractère hors alphabet fait passer en UCS-2 (70 puis 67 par segment)', () => {
    expect(compterSegments('a'.repeat(69) + '—')).toMatchObject({ encodage: 'UCS-2', segments: 1 });
    expect(compterSegments('a'.repeat(70) + '—')).toMatchObject({ encodage: 'UCS-2', segments: 2 });
    expect(compterSegments('a'.repeat(150) + 'ê').segments).toBe(3);
  });
});

describe('limiterSegments / preparerTexteSms', () => {
  test('un texte court est inchangé', () => {
    expect(limiterSegments('Bonjour')).toBe('Bonjour');
  });

  test('un texte trop long est tronqué à 3 segments avec « ... »', () => {
    const t = limiterSegments('a'.repeat(1000), 3);
    expect(compterSegments(t).segments).toBe(3);
    expect(t.endsWith('...')).toBe(true);
    expect(t.length).toBe(459);
  });

  test('convertit puis compte : un message en UCS-2 devient 1 segment', () => {
    const r = preparerTexteSms('[Lycée] ABSENCE — Moussa était absent ce 07/10/2026. Contactez l\'établissement si justifié.');
    expect(r).toMatchObject({ encodage: 'GSM-7', segments: 1 });
    expect(r.texte).toContain('ABSENCE - Moussa');
  });
});
