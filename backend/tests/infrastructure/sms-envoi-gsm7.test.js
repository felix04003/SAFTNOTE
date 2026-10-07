'use strict';

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), http: jest.fn(), log: jest.fn(),
}));

const { envoyerSMS, envoyerOTP } = require('../../src/infrastructure/notifications/sms.service');
const { compterSegments } = require('../../src/utils/sms-texte');
const logger = require('../../src/utils/logger');

let corps;
beforeEach(() => {
  corps = null;
  jest.clearAllMocks();
  process.env.AT_USERNAME = 'sandbox';
  global.fetch = jest.fn(async (url, opts) => {
    corps = new URLSearchParams(opts.body);
    return { ok: true, json: async () => ({ SMSMessageData: { Recipients: [{ status: 'Success', messageId: 'm1' }] } }) };
  });
});

describe('envoyerSMS — conversion systématique en GSM-7', () => {
  test('un message à tiret long et « ê » part en GSM-7, 1 segment', async () => {
    await envoyerSMS('+221771110001', '[Lycée] ABSENCE — Moussa êtes absent. Contactez l\'établissement si justifié.');
    const envoye = corps.get('message');
    expect(envoye).not.toMatch(/[—ê]/);
    expect(compterSegments(envoye)).toMatchObject({ encodage: 'GSM-7', segments: 1 });
  });

  test('un message très long est borné à 3 segments (459 caractères)', async () => {
    await envoyerSMS('+221771110001', 'x'.repeat(2000));
    const envoye = corps.get('message');
    expect(envoye.length).toBe(459);
    expect(envoye.endsWith('...')).toBe(true);
  });

  test('le code de connexion reste intact et tient en 1 segment', async () => {
    await envoyerOTP('+221771110001', '123456', 'Lycée Lamine Gueye');
    const envoye = corps.get('message');
    expect(envoye).toContain('123456');
    expect(compterSegments(envoye).segments).toBe(1);
  });

  test('journalise le nombre de segments, jamais le contenu', async () => {
    await envoyerSMS('+221771110001', 'Code secret 987654');
    const sortie = JSON.stringify([...logger.debug.mock.calls, ...logger.info.mock.calls]);
    expect(sortie).toContain('"segments":1');
    expect(sortie).not.toContain('987654');
  });
});
