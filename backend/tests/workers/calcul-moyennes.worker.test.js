'use strict';

/**
 * calcul-moyennes.worker.js ne démarre son Worker BullMQ que lancé comme programme
 * (require.main). On mocke DB/Redis/BullMQ et on teste traiterCalcul() (export
 * ajouté lot J/E5), qui contient toute la logique métier isolable.
 */

jest.mock('../../src/infrastructure/database/pool', () => ({
  getDB: jest.fn(),
  connectDB: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn().mockReturnValue({ quit: jest.fn().mockResolvedValue(undefined) }),
  createBullMQConnection: jest.fn().mockReturnValue({}),
  invalidatePattern: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/domains/03-pedagogie/moyennes/calcul-moyennes.service', () => ({
  recalculerMoyennesClasse: jest.fn(),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { getDB } = require('../../src/infrastructure/database/pool');
const { recalculerMoyennesClasse } = require('../../src/domains/03-pedagogie/moyennes/calcul-moyennes.service');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');

const { traiterCalcul } = require('../../src/workers/calcul-moyennes.worker');

describe('calcul-moyennes.worker — traiterCalcul', () => {
  let db;
  const updateProgress = jest.fn().mockResolvedValue(undefined);
  const job = (data) => ({ id: 'job', data, updateProgress });

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    updateProgress.mockClear();
    recalculerMoyennesClasse.mockReset();
  });

  test('déduit periode_id depuis evaluation_id quand periode_id est absent, puis délègue au calcul partagé', async () => {
    db.mockReturnValueOnce(mockQuery({ periode_id: IDS.periode }));     // evaluations join periodes
    db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));              // classe de l'établissement
    recalculerMoyennesClasse.mockResolvedValue({ nbCalculees: 1, inscriptions: [{ id: IDS.inscription }], matieres: [{ matiere_id: IDS.matiere }] });

    const result = await traiterCalcul(job({ classe_id: IDS.classe, evaluation_id: IDS.evaluation, etablissement_id: IDS.etablissement }));

    expect(recalculerMoyennesClasse).toHaveBeenCalledWith(db, { classe_id: IDS.classe, periode_id: IDS.periode, matiere_id: undefined });
    expect(result).toMatchObject({ periode_id: IDS.periode, nb_inscriptions: 1, nb_matieres: 1, nb_moyennes: 1 });
    expect(updateProgress).toHaveBeenCalledWith(100);
  });

  test('renvoie skipped si l\'évaluation référencée est introuvable', async () => {
    db.mockReturnValueOnce(mockQuery(undefined));
    const result = await traiterCalcul(job({ classe_id: IDS.classe, evaluation_id: 'eval-inconnue' }));
    expect(result).toEqual({ skipped: true, reason: 'evaluation_introuvable' });
    expect(recalculerMoyennesClasse).not.toHaveBeenCalled();
  });

  test('renvoie skipped si periode_id est manquant et non déductible', async () => {
    const result = await traiterCalcul(job({ classe_id: IDS.classe }));
    expect(result).toEqual({ skipped: true, reason: 'periode_id_manquant' });
  });

  test('renvoie skipped, sans rien calculer, si la classe n\'appartient pas à l\'établissement du job', async () => {
    db.mockReturnValueOnce(mockQuery(undefined));                       // classe introuvable
    const result = await traiterCalcul(job({ classe_id: IDS.classe, periode_id: IDS.periode, etablissement_id: IDS.etablissement }));
    expect(result).toEqual({ skipped: true, reason: 'classe_introuvable', classe_id: IDS.classe });
    expect(recalculerMoyennesClasse).not.toHaveBeenCalled();
  });

  test('renvoie skipped si la classe n\'a aucune inscription active', async () => {
    db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
    recalculerMoyennesClasse.mockResolvedValue({ nbCalculees: 0, inscriptions: [], matieres: [] });
    const result = await traiterCalcul(job({ classe_id: IDS.classe, periode_id: IDS.periode, etablissement_id: IDS.etablissement }));
    expect(result).toEqual({ skipped: true, reason: 'aucune_inscription', classe_id: IDS.classe });
  });

  test('une erreur du calcul remonte (BullMQ réessaie le job) au lieu d\'être avalée', async () => {
    db.mockReturnValueOnce(mockQuery({ id: IDS.classe }));
    recalculerMoyennesClasse.mockRejectedValue(new Error('base indisponible'));
    await expect(traiterCalcul(job({ classe_id: IDS.classe, periode_id: IDS.periode, etablissement_id: IDS.etablissement })))
      .rejects.toThrow('base indisponible');
  });
});
