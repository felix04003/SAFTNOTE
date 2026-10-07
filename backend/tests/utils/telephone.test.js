'use strict';

const {
  paysIso, normaliserTelephone, telephoneOuErreur, variantesTelephone, ressembleATelephone,
} = require('../../src/utils/telephone');

describe('utils/telephone', () => {
  describe('paysIso', () => {
    test.each([
      ['SN', 'SN'], ['ci', 'CI'], ['Sénégal', 'SN'], ["Côte d'Ivoire", 'CI'],
      ['Burkina Faso', 'BF'], [undefined, 'SN'], ['Atlantide', 'SN'],
    ])('%s → %s', (entree, attendu) => expect(paysIso(entree)).toBe(attendu));
  });

  describe('normaliserTelephone', () => {
    test.each([
      '+221771234567', '+221 77 123 45 67', '77 123 45 67', '771234567',
      '00221771234567', '77.123.45.67', ' +221-77-123-45-67 ',
    ])('"%s" → +221771234567', (saisie) => {
      expect(normaliserTelephone(saisie, 'SN')).toBe('+221771234567');
    });

    test('un numéro sans indicatif suit le pays de l\'établissement', () => {
      expect(normaliserTelephone('07 07 07 07 07', 'CI')).toMatch(/^\+225/);
    });

    test('un indicatif explicite l\'emporte sur le pays par défaut', () => {
      expect(normaliserTelephone('+22370123456', 'SN')).toBe('+22370123456');
    });

    test.each(['abc', '', '   ', '12', null, undefined, 42])('refuse %p', (saisie) => {
      expect(normaliserTelephone(saisie, 'SN')).toBeNull();
    });
  });

  describe('telephoneOuErreur', () => {
    test('retourne le numéro normalisé', () => {
      expect(telephoneOuErreur('77 123 45 67', 'SN')).toBe('+221771234567');
    });
    test('lève une 422 avec le libellé fourni', () => {
      expect(() => telephoneOuErreur('abc', 'SN', 'Téléphone du parent'))
        .toThrow(/Téléphone du parent invalide/);
    });
  });

  describe('variantesTelephone', () => {
    test('inclut les formes historiques sans doublon', () => {
      const v = variantesTelephone('77 123 45 67', 'SN');
      expect(v).toEqual(expect.arrayContaining(['77 123 45 67', '+221771234567', '221771234567', '771234567']));
      expect(new Set(v).size).toBe(v.length);
    });
    test('saisie inexploitable : seule la saisie brute est conservée', () => {
      expect(variantesTelephone('abc', 'SN')).toEqual(['abc']);
      expect(variantesTelephone('', 'SN')).toEqual([]);
    });
  });

  describe('ressembleATelephone', () => {
    test.each([['+221771234567', true], ['77 123 45 67', true], ['a@x.sn', false], ['directeur', false]])(
      '%s → %s', (v, attendu) => expect(ressembleATelephone(v)).toBe(attendu));
  });
});
