'use strict';

// Garde de coût : chaque gabarit de notification SMS doit tenir en UN segment
// GSM-7 avec des données réalistes, sans avoir besoin de conversion.

jest.mock('../../src/infrastructure/database/pool', () => ({
  getDB: jest.fn(),
  connectDB: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  createBullMQConnection: jest.fn().mockReturnValue({}),
  getRedis: jest.fn(),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));
jest.mock('../../src/infrastructure/notifications/plafond-sms', () => ({ consommationMois: jest.fn(), decision: jest.fn(), alerterSiSeuilFranchi: jest.fn() }));
jest.mock('../../src/infrastructure/notifications/sms.service', () => ({ envoyerSMS: jest.fn() }));
jest.mock('../../src/infrastructure/notifications/whatsapp.service', () => ({ envoyerTemplate: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { TEMPLATES_SMS } = require('../../src/workers/notification.worker');
const { compterSegments, versGsm7 } = require('../../src/utils/sms-texte');

// Données volontairement réalistes (noms longs, accents, valeurs maximales)
const DATA = {
  etablissement: 'Lycée Lamine Gueye', prenom: 'Moussa', nom: 'Diallo', date: '07/10/2026',
  matiere: 'Mathématiques', minutes: 15, note: '14.5', type: 'Devoir', trimestre: '1er trimestre',
  moyenne: '13.25', rang: 4, rang_sur: 38, heure: '10h00', motif: 'comportement en classe',
  type_sanction: 'avertissement écrit',
};

describe('gabarits SMS — un seul segment GSM-7', () => {
  test.each(Object.keys(TEMPLATES_SMS))('%s', (type) => {
    const message = TEMPLATES_SMS[type](DATA);
    expect(versGsm7(message)).toBe(message);                 // aucun caractère à convertir
    expect(compterSegments(message)).toMatchObject({ encodage: 'GSM-7', segments: 1 });
  });

  test('il y a bien les 6 gabarits attendus (la garde ne doit pas devenir vide)', () => {
    expect(Object.keys(TEMPLATES_SMS).sort()).toEqual(
      ['absence', 'bulletin_disponible', 'convocation', 'nouvelle_note', 'retard', 'sanction']);
  });

  test('un nom d\'établissement et un motif longs restent à 2 segments au plus', () => {
    const long = { ...DATA, etablissement: 'Complexe scolaire Cheikh Anta Diop de Médina Gounass', motif: 'absences répétées et retards non justifiés' };
    for (const type of Object.keys(TEMPLATES_SMS)) {
      expect(compterSegments(versGsm7(TEMPLATES_SMS[type](long))).segments).toBeLessThanOrEqual(2);
    }
  });
});
