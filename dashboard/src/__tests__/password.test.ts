import { describe, it, expect } from 'vitest';
import { verifierMotDePasse } from '../password';

describe('verifierMotDePasse', () => {
  it('accepte un mot de passe conforme', () => {
    expect(verifierMotDePasse('Abcdef12')).toBeNull();
  });

  it('refuse un mot de passe trop court ou vide', () => {
    expect(verifierMotDePasse('Abc12')).toMatch(/au moins 8 caractères/);
    expect(verifierMotDePasse('')).toMatch(/au moins 8 caractères/);
  });

  it.each(['abcdefgh1', 'ABCDEFGH1', 'Abcdefgh', '12345678'])('refuse %s (classes de caractères)', (mdp) => {
    expect(verifierMotDePasse(mdp)).toMatch(/majuscule, une minuscule et un chiffre/);
  });

  it('refuse plus de 72 octets', () => {
    expect(verifierMotDePasse('Aa1' + 'x'.repeat(70))).toMatch(/trop long/);
  });
});
