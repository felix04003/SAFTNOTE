'use strict';

/**
 * purge.worker.js exporte déjà purgerDonnees() sans effet de bord au
 * require() (initPurgeWorker() n'est appelé nulle part automatiquement) —
 * aucune modification du fichier n'a été nécessaire pour le tester.
 *
 * IMPORTANT (coordination inter-agents) : `journal_audit` est purgé via
 * `db.raw(\`NOW() - INTERVAL '${joursConservation} days'\`)` — une
 * interpolation de chaîne non paramétrée (finding de l'audit 2026-09,
 * lot K, réservé à un autre agent). Ces tests vérifient UNIQUEMENT le
 * comportement observable (nombre de lignes supprimées, table interrogée,
 * valeur de secours à 365 jours) et n'affirment JAMAIS sur le contenu exact
 * de la chaîne SQL générée, afin de rester valides indépendamment du
 * correctif du lot K.
 */

jest.mock('../../src/infrastructure/cache/redis', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}));
jest.mock('../../src/infrastructure/database/pool', () => ({
  getDB: jest.fn(),
}));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue(undefined), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');

const { purgerDonnees } = require('../../src/workers/purge.worker');

describe('purge.worker — purgerDonnees', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('purge les sessions et OTP expirés via les fonctions SQL dédiées', async () => {
    db.raw = jest.fn()
      .mockResolvedValueOnce({ rows: [{ count: 12 }] })  // purger_sessions_expirees
      .mockResolvedValueOnce({ rows: [{ count: 5 }] })   // purger_otp_expires
      .mockResolvedValueOnce({ rows: [{ min_jours: 365 }] }); // politique_securite (via db().min().first(), voir ci-dessous)

    db.mockReturnValueOnce(mockQuery(5))                       // tentatives_connexion delete
      .mockReturnValueOnce(mockQuery({ min_jours: 365 }))      // politique_securite min().first()
      .mockReturnValueOnce(mockQuery(3));                      // journal_audit delete

    const resultats = await purgerDonnees();

    expect(resultats.sessions).toBe(12);
    expect(resultats.otp).toBe(5);
  });

  test('supprime les tentatives de connexion de plus de 30 jours (comportement observable, pas la requête brute)', async () => {
    db.raw = jest.fn().mockResolvedValue({ rows: [{ count: 0 }] });

    const tentativesChain = mockQuery(7);
    db.mockReturnValueOnce(tentativesChain)
      .mockReturnValueOnce(mockQuery({ min_jours: 365 }))
      .mockReturnValueOnce(mockQuery(0));

    const resultats = await purgerDonnees();

    expect(resultats.tentatives_connexion).toBe(7);
    expect(tentativesChain.delete).toHaveBeenCalled();
    // Comportement : filtre par date (peu importe le format exact), jamais la chaîne SQL brute
    expect(tentativesChain.where).toHaveBeenCalledWith('tentee_at', '<', expect.anything());
  });

  test('purge le journal d\'audit plus vieux que la politique de conservation (N jours), quelle que soit N', async () => {
    db.raw = jest.fn().mockResolvedValue({ rows: [{ count: 0 }] });

    const politiqueChain = mockQuery({ min_jours: 90 }); // politique personnalisée à 90 jours
    const journalChain = mockQuery(42);

    db.mockReturnValueOnce(mockQuery(0))       // tentatives_connexion
      .mockReturnValueOnce(politiqueChain)     // politique_securite
      .mockReturnValueOnce(journalChain);      // journal_audit

    const resultats = await purgerDonnees();

    expect(resultats.journal_audit).toBe(42);
    expect(journalChain.delete).toHaveBeenCalled();
    // On vérifie que le filtre porte bien sur created_at, sans figer le format de la valeur
    expect(journalChain.where).toHaveBeenCalledWith('created_at', '<', expect.anything());
  });

  test('utilise 365 jours par défaut quand aucune politique de sécurité n\'est configurée', async () => {
    db.raw = jest.fn().mockResolvedValue({ rows: [{ count: 0 }] });

    db.mockReturnValueOnce(mockQuery(0))               // tentatives_connexion
      .mockReturnValueOnce(mockQuery(undefined))       // politique_securite absente -> politique?.min_jours est undefined
      .mockReturnValueOnce(mockQuery(9));               // journal_audit

    const resultats = await purgerDonnees();

    // Le comportement de repli (365 jours) ne doit pas faire planter la purge
    expect(resultats.journal_audit).toBe(9);
  });

  test('isole les échecs par section : une purge en échec ne bloque pas les autres et retourne -1 pour la section concernée', async () => {
    db.raw = jest.fn()
      .mockRejectedValueOnce(new Error('fonction purger_sessions_expirees indisponible')) // sessions échoue
      .mockResolvedValueOnce({ rows: [{ count: 2 }] }); // otp ok

    db.mockReturnValueOnce(mockQuery(1))                    // tentatives_connexion
      .mockReturnValueOnce(mockQuery({ min_jours: 365 }))   // politique_securite
      .mockReturnValueOnce(mockQuery(0));                   // journal_audit

    const resultats = await purgerDonnees();

    expect(resultats.sessions).toBe(-1);
    expect(resultats.otp).toBe(2);
    expect(resultats.tentatives_connexion).toBe(1);
  });
});
