import { verifierMotDePasse } from '../../src/utils/motDePasse';

describe('verifierMotDePasse', () => {
  it('accepte un mot de passe conforme', () => {
    expect(verifierMotDePasse('Abcdef12')).toBeNull();
  });

  it.each(['', 'Abc12', 'abcdefgh1', 'ABCDEFGH1', 'Abcdefgh', '12345678'])('refuse %p', (mdp) => {
    expect(verifierMotDePasse(mdp)).not.toBeNull();
  });

  it('refuse plus de 72 octets (bcrypt tronque au-delà), accents compris', () => {
    expect(verifierMotDePasse('Aa1' + 'x'.repeat(70))).toMatch(/trop long/);
    expect(verifierMotDePasse('Aa1' + 'é'.repeat(36))).toMatch(/trop long/); // 2 octets chacun
  });
});
