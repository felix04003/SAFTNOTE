'use strict';

/**
 * Le module notification.worker.js exécute du code de câblage BullMQ au
 * chargement (init().then(() => new Worker(...))). On mocke toutes les
 * dépendances I/O (DB, Redis, BullMQ, SMS, WhatsApp) pour pouvoir require()
 * le fichier sans connexion réelle, et on teste ses fonctions exportées
 * (voir module.exports ajouté en fin de fichier, lot J/E5) indépendamment
 * du wiring BullMQ.
 */

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
jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerSMS: jest.fn(),
}));
jest.mock('../../src/infrastructure/notifications/whatsapp.service', () => ({
  envoyerTemplate: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { getDB } = require('../../src/infrastructure/database/pool');
const { envoyerSMS } = require('../../src/infrastructure/notifications/sms.service');
const { envoyerTemplate } = require('../../src/infrastructure/notifications/whatsapp.service');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');

const {
  traiterNotification,
  TEMPLATES_SMS,
  doitEnvoyerNotification,
  dansPlageHoraire,
  getCategorie,
} = require('../../src/workers/notification.worker');

describe('notification.worker — TEMPLATES_SMS', () => {
  const data = {
    etablissement: 'Lycée Blaise Diagne', prenom: 'Aminata', nom: 'Traoré',
    date: '10/09/2026', matiere: 'Mathématiques', minutes: 15,
    note: 14, type: 'devoir', trimestre: 'Trimestre 1', moyenne: 14.5,
    rang: 3, rang_sur: 35, heure: '10h00', motif: 'discipline',
    type_sanction: 'avertissement',
  };

  test('absence produit un message avec établissement, élève, date et matière', () => {
    const msg = TEMPLATES_SMS.absence(data);
    expect(msg).toContain('Lycée Blaise Diagne');
    expect(msg).toContain('Aminata Traoré');
    expect(msg).toContain('ABSENCE');
    expect(msg).toContain('Mathématiques');
  });

  test('retard produit un message avec le nombre de minutes', () => {
    const msg = TEMPLATES_SMS.retard(data);
    expect(msg).toContain('RETARD');
    expect(msg).toContain('15 min');
  });

  test('nouvelle_note produit un message avec la note sur 20', () => {
    const msg = TEMPLATES_SMS.nouvelle_note(data);
    expect(msg).toContain('NOUVELLE NOTE');
    expect(msg).toContain('14/20');
    expect(msg).toContain('Mathématiques');
  });

  test('bulletin_disponible produit un message avec moyenne et rang', () => {
    const msg = TEMPLATES_SMS.bulletin_disponible(data);
    expect(msg).toContain('BULLETIN');
    expect(msg).toContain('14.5/20');
    expect(msg).toContain('3/35');
  });

  test('convocation produit un message avec date, heure et motif', () => {
    const msg = TEMPLATES_SMS.convocation(data);
    expect(msg).toContain('CONVOCATION');
    expect(msg).toContain('discipline');
  });

  test('sanction produit un message informatif avec le type de sanction', () => {
    const msg = TEMPLATES_SMS.sanction(data);
    expect(msg).toContain('INFORMATION');
    expect(msg).toContain('avertissement');
  });
});

describe('notification.worker — doitEnvoyerNotification', () => {
  test('les notifications urgentes (convocation, sanction) sont toujours envoyées', () => {
    expect(doitEnvoyerNotification('convocation', { notif_absences: false, notif_notes: false, notif_bulletins: false })).toBe(true);
    expect(doitEnvoyerNotification('sanction', {})).toBe(true);
  });

  test('respecte les préférences pour absence/retard/note/bulletin', () => {
    expect(doitEnvoyerNotification('absence', { notif_absences: false })).toBe(false);
    expect(doitEnvoyerNotification('nouvelle_note', { notif_notes: false })).toBe(false);
    expect(doitEnvoyerNotification('bulletin_disponible', { notif_bulletins: false })).toBe(false);
    expect(doitEnvoyerNotification('absence', { notif_absences: true })).toBe(true);
  });
});

describe('notification.worker — dansPlageHoraire', () => {
  test('retourne un booléen cohérent avec l\'heure actuelle et une plage large', () => {
    expect(dansPlageHoraire('00:00', '23:59')).toBe(true);
  });

  test('retourne false pour une plage qui ne peut jamais être atteinte', () => {
    // Plage inversée impossible à satisfaire (fin < début, jamais couverte)
    expect(dansPlageHoraire('23:59', '00:00')).toBe(false);
  });
});

describe('notification.worker — getCategorie', () => {
  test('classe correctement chaque type de notification connu', () => {
    expect(getCategorie('convocation')).toBe('urgence');
    expect(getCategorie('sanction')).toBe('urgence');
    expect(getCategorie('absence')).toBe('urgence');
    expect(getCategorie('nouvelle_note')).toBe('quotidien');
    expect(getCategorie('bulletin_disponible')).toBe('document');
    expect(getCategorie('type_inconnu')).toBe('programme');
  });
});

describe('notification.worker — traiterNotification', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    jest.setSystemTime && jest.useRealTimers();
  });

  const infoParent = {
    nom: 'Traoré', prenom: 'Aminata',
    parent_id: 'parent-1', telephone: '+221770000000',
    canal_prefere: 'sms', a_whatsapp: false,
    notif_absences: true, notif_notes: true, notif_bulletins: true,
    heure_debut_notif: '00:00', heure_fin_notif: '23:59',
    etablissement: 'Lycée Test',
  };

  test('renvoie un statut skip si le parent principal est introuvable', async () => {
    db.mockReturnValueOnce(mockQuery(undefined)); // requête jointure info introuvable

    const job = { id: 'job-1', data: { type_notif: 'absence', inscription_id: 'insc-1' } };
    const result = await traiterNotification(job);

    expect(result).toEqual({ statut: 'skip', raison: 'parent_introuvable' });
  });

  test('renvoie un statut skip si les préférences désactivent ce type de notification', async () => {
    db.mockReturnValueOnce(mockQuery({ ...infoParent, notif_absences: false }));

    const job = { id: 'job-2', data: { type_notif: 'absence', inscription_id: 'insc-1' } };
    const result = await traiterNotification(job);

    expect(result).toEqual({ statut: 'skip', raison: 'preferences_desactivees' });
  });

  test('envoie un SMS quand le canal préféré est sms et journalise l\'envoi', async () => {
    db.mockReturnValueOnce(mockQuery(infoParent)); // info parent
    db.mockReturnValueOnce(mockQuery({ matiere: 'Mathématiques', date_cours: '2026-09-10' })); // getContexteNotification (absence)
    const insertChain = mockQuery(undefined);
    db.mockReturnValueOnce(insertChain); // journal_notifications insert

    envoyerSMS.mockResolvedValue({ messageIds: ['sms-123'] });

    const job = { id: 'job-3', data: { type_notif: 'absence', inscription_id: 'insc-1' } };
    const result = await traiterNotification(job);

    expect(result.statut).toBe('envoye');
    expect(result.canal).toBe('sms');
    expect(envoyerSMS).toHaveBeenCalledWith(infoParent.telephone, expect.stringContaining('ABSENCE'));
  });

  test('utilise WhatsApp quand préféré et disponible, avec repli SMS si WhatsApp échoue', async () => {
    const infoWhatsapp = { ...infoParent, canal_prefere: 'whatsapp', a_whatsapp: true };
    db.mockReturnValueOnce(mockQuery(infoWhatsapp));
    db.mockReturnValueOnce(mockQuery({ matiere: 'Mathématiques', date_cours: '2026-09-10' }));
    db.mockReturnValueOnce(mockQuery(undefined));

    envoyerTemplate.mockRejectedValue(new Error('WhatsApp indisponible'));
    envoyerSMS.mockResolvedValue({ messageIds: ['sms-fallback'] });

    const job = { id: 'job-4', data: { type_notif: 'absence', inscription_id: 'insc-1' } };
    const result = await traiterNotification(job);

    expect(envoyerTemplate).toHaveBeenCalled();
    expect(envoyerSMS).toHaveBeenCalled(); // fallback déclenché
    expect(result.statut).toBe('envoye');
  });

  test('propage l\'erreur pour laisser BullMQ retenter le job en cas d\'échec', async () => {
    db.mockReturnValueOnce(mockQuery(infoParent));
    db.mockReturnValueOnce(mockQuery({ matiere: 'Mathématiques', date_cours: '2026-09-10' }));
    envoyerSMS.mockRejectedValue(new Error('Provider SMS indisponible'));
    db.mockReturnValueOnce(mockQuery(undefined)); // journal_notifications (echec) — .catch(() => {})

    const job = { id: 'job-5', data: { type_notif: 'absence', inscription_id: 'insc-1' } };

    await expect(traiterNotification(job)).rejects.toThrow('Provider SMS indisponible');
  });

  // Note : le comportement sur job en échec côté BullMQ lui-même (retries,
  // backoff, worker.on('failed', ...)) nécessite une vraie instance de Worker
  // connectée à Redis — non testable unitairement sans Redis réel. Le test
  // ci-dessus vérifie la partie testable : traiterNotification() propage bien
  // l'erreur (ne l'avale pas), ce qui est la condition nécessaire pour que
  // BullMQ déclenche un retry.
});
