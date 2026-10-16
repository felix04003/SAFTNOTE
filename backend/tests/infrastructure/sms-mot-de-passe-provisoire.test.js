'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), http: jest.fn(), log: jest.fn(),
}));

const { envoyerMotDePasseProvisoire, versAscii } = require('../../src/infrastructure/notifications/sms.service');

describe('versAscii', () => {
  test('retire accents, tirets longs, guillemets typographiques', () => {
    expect(versAscii('Lycée « Dakar » — l’école')).toBe('Lycee " Dakar " - l\'ecole');
  });
  test('ne laisse que de l\'ASCII imprimable', () => {
    expect(versAscii('Ça va 😀 ?')).toMatch(/^[\x20-\x7E]*$/);
  });
});

describe('envoyerMotDePasseProvisoire', () => {
  let corps;
  beforeEach(() => {
    corps = null;
    process.env.AT_USERNAME = 'sandbox';
    global.fetch = jest.fn(async (url, opts) => {
      corps = new URLSearchParams(opts.body);
      return { ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'm1' }] } }) };
    });
  });

  test('un seul segment GSM-7 : ASCII pur, 160 caractères au plus, même avec un nom d\'école accentué et long', async () => {
    await envoyerMotDePasseProvisoire('+221771110001', {
      etablissementNom: 'Lycée Moderne Cheikh Anta Diop de Médina Gounass',
      motDePasse: 'KyKXPuFM3ttb',
    });

    const message = corps.get('message');
    expect(message).toMatch(/^[\x20-\x7E]+$/);
    expect(message.length).toBeLessThanOrEqual(160);
    expect(message).toContain('+221771110001');
    expect(message).toContain('KyKXPuFM3ttb');
    expect(message).toContain('A changer');
    expect(corps.get('to')).toBe('+221771110001');
  });

  test('ne journalise jamais le mot de passe', async () => {
    const logger = require('../../src/utils/logger');
    await envoyerMotDePasseProvisoire('+221771110001', { etablissementNom: 'Lycée', motDePasse: 'SecretMdp-12' });
    const sortie = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls, ...logger.debug.mock.calls]);
    expect(sortie).not.toContain('SecretMdp-12');
  });
});
