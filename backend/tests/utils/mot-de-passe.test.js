'use strict';

const {
  validerMotDePasse, exigerMotDePasseConforme, schemaMotDePasse, genererMotDePasseTemporaire,
} = require('../../src/utils/mot-de-passe');

describe('utils/mot-de-passe', () => {
  describe('validerMotDePasse — socle commun', () => {
    test('accepte un mot de passe conforme', () => {
      expect(validerMotDePasse('Abcdef12')).toBeNull();
    });

    test.each([
      ['Abc12',            /au moins 8 caractères/],
      ['abcdefgh1',        /majuscule/],
      ['ABCDEFGH1',        /minuscule/],
      ['Abcdefgh',         /chiffre/],
      ['123456',           /au moins 8 caractères/],
    ])('refuse %s', (mdp, motif) => {
      expect(validerMotDePasse(mdp)).toMatch(motif);
    });

    test('refuse plus de 72 octets (bcrypt tronque silencieusement au-delà)', () => {
      expect(validerMotDePasse('Aa1' + 'x'.repeat(70))).toMatch(/trop long/);
    });

    test('la politique de l\'établissement peut durcir la longueur…', () => {
      expect(validerMotDePasse('Abcdef12', { mdp_longueur_min: 12 })).toMatch(/au moins 12 caractères/);
      expect(validerMotDePasse('Abcdef123456', { mdp_longueur_min: 12 })).toBeNull();
    });

    test('…mais jamais l\'assouplir (socle de 8 caractères, majuscule, chiffre)', () => {
      expect(validerMotDePasse('abcdef', { mdp_longueur_min: 4, mdp_necessite_majuscule: false })).not.toBeNull();
    });
  });

  describe('identité du compte', () => {
    const identite = { telephone: '+221771234567', email: 'awa.diop@ecole.sn', nom: 'Diop', prenom: 'Awa' };

    test('refuse un mot de passe qui reprend le numéro de téléphone', () => {
      expect(validerMotDePasse('Aa771234567', null, identite)).toMatch(/ne doit pas reprendre/);
      expect(validerMotDePasse('Aa221771234567', null, identite)).toMatch(/ne doit pas reprendre/);
    });

    test('refuse le nom, le prénom ou l\'email tel quel', () => {
      expect(validerMotDePasse('Diop1234', null, { nom: 'Diop1234' })).toMatch(/ne doit pas reprendre/);
      expect(validerMotDePasse('Marie2024', null, { email: 'marie2024@ecole.sn' })).toMatch(/ne doit pas reprendre/);
      expect(validerMotDePasse('Marie2024', null, { email: 'autre@ecole.sn', prenom: 'Marie2024' })).toMatch(/ne doit pas reprendre/);
    });

    test('accepte un mot de passe sans rapport avec l\'identité', () => {
      expect(validerMotDePasse('Tr0ubadour!x', null, identite)).toBeNull();
    });
  });

  describe('exigerMotDePasseConforme', () => {
    test('lève une 422 explicite', () => {
      expect.assertions(3);
      try { exigerMotDePasseConforme('faible'); } catch (e) {
        expect(e.isApiError).toBe(true);
        expect(e.statusCode || e.status).toBe(422);
        expect(e.message).toMatch(/au moins 8 caractères/);
      }
    });
    test('ne lève rien si conforme', () => {
      expect(() => exigerMotDePasseConforme('Abcdef12')).not.toThrow();
    });
  });

  describe('schemaMotDePasse (zod)', () => {
    test('même règle que validerMotDePasse', () => {
      expect(schemaMotDePasse.safeParse('Abcdef12').success).toBe(true);
      for (const mauvais of ['abc', 'abcdefgh', 'ABCDEFGH1', 'abcdefgh1', 'Abcdefgh', 'Aa1' + 'x'.repeat(70)]) {
        expect(schemaMotDePasse.safeParse(mauvais).success).toBe(false);
      }
    });
    test('.optional() fonctionne (champ facultatif de POST /enseignants)', () => {
      expect(schemaMotDePasse.optional().safeParse(undefined).success).toBe(true);
    });
  });

  describe('genererMotDePasseTemporaire', () => {
    test('toujours conforme au socle, 12 caractères, sans caractères ambigus', () => {
      for (let i = 0; i < 300; i++) {
        const mdp = genererMotDePasseTemporaire();
        expect(mdp).toHaveLength(12);
        expect(validerMotDePasse(mdp)).toBeNull();
        expect(mdp).not.toMatch(/[01OIl]/);
      }
    });
    test('deux appels donnent des valeurs différentes', () => {
      expect(genererMotDePasseTemporaire()).not.toBe(genererMotDePasseTemporaire());
    });
  });
});
