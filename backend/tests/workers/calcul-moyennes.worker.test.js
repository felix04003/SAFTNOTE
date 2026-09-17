'use strict';

/**
 * calcul-moyennes.worker.js démarre son Worker BullMQ directement dans
 * init() (appelé au chargement du fichier). On mocke DB/Redis/BullMQ pour
 * require() sans I/O réelle et tester uniquement traiterCalcul() (export
 * ajouté lot J/E5), qui contient toute la logique métier isolable.
 */

jest.mock('../../src/infrastructure/database/pool', () => ({
  getDB: jest.fn(),
  connectDB: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn().mockReturnValue({ quit: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) })),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');

const { traiterCalcul } = require('../../src/workers/calcul-moyennes.worker');

describe('calcul-moyennes.worker — traiterCalcul', () => {
  let db;
  const updateProgress = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    updateProgress.mockClear();
  });

  test('déduit periode_id depuis evaluation_id quand periode_id est absent', async () => {
    db.mockReturnValueOnce(mockQuery({ periode_id: IDS.periode })); // evaluations join periodes
    db.mockReturnValueOnce(mockQuery([{ id: IDS.inscription, eleve_id: IDS.eleve }])); // inscriptions
    db.mockReturnValueOnce(mockQuery([{ matiere_id: IDS.matiere }])); // affectations distinct

    const job = {
      id: 'job-1',
      data: { classe_id: IDS.classe, evaluation_id: IDS.evaluation, etablissement_id: IDS.etablissement },
      updateProgress,
    };

    const result = await traiterCalcul(job);

    expect(result.periode_id).toBe(IDS.periode);
    expect(result.nb_inscriptions).toBe(1);
    expect(result.nb_matieres).toBe(1);
  });

  test('renvoie skipped si l\'évaluation référencée est introuvable', async () => {
    db.mockReturnValueOnce(mockQuery(undefined)); // evaluation introuvable

    const job = { id: 'job-2', data: { classe_id: IDS.classe, evaluation_id: 'eval-inconnue' }, updateProgress };
    const result = await traiterCalcul(job);

    expect(result).toEqual({ skipped: true, reason: 'evaluation_introuvable' });
  });

  test('renvoie skipped si periode_id est manquant et non déductible', async () => {
    const job = { id: 'job-3', data: { classe_id: IDS.classe }, updateProgress };
    const result = await traiterCalcul(job);

    expect(result).toEqual({ skipped: true, reason: 'periode_id_manquant' });
  });

  test('renvoie skipped si la classe n\'a aucune inscription active', async () => {
    db.mockReturnValueOnce(mockQuery([])); // inscriptions vide

    const job = { id: 'job-4', data: { classe_id: IDS.classe, periode_id: IDS.periode }, updateProgress };
    const result = await traiterCalcul(job);

    expect(result).toEqual({ skipped: true, reason: 'aucune_inscription', classe_id: IDS.classe });
  });

  test('calcule les moyennes matière + générale pour chaque inscription/matière (matiere_id unique)', async () => {
    db.mockReturnValueOnce(mockQuery([{ id: IDS.inscription, eleve_id: IDS.eleve }])); // inscriptions

    const rawSpy = jest.spyOn(db, 'raw');

    const job = {
      id: 'job-5',
      data: { classe_id: IDS.classe, periode_id: IDS.periode, matiere_id: IDS.matiere, etablissement_id: IDS.etablissement },
      updateProgress,
    };

    const result = await traiterCalcul(job);

    expect(result).toEqual({ classe_id: IDS.classe, periode_id: IDS.periode, nb_inscriptions: 1, nb_matieres: 1 });
    // calculer_moyenne_matiere puis calculer_moyenne_generale sont bien appelés via db.raw
    expect(rawSpy.mock.calls.some(c => c[0].includes('calculer_moyenne_matiere'))).toBe(true);
    expect(rawSpy.mock.calls.some(c => c[0].includes('calculer_moyenne_generale'))).toBe(true);
    expect(updateProgress).toHaveBeenCalledWith(100);
  });

  test('continue le traitement des autres élèves même si le calcul échoue pour l\'un d\'eux', async () => {
    db.mockReturnValueOnce(mockQuery([
      { id: 'insc-1', eleve_id: 'eleve-1' },
      { id: 'insc-2', eleve_id: 'eleve-2' },
    ]));

    let call = 0;
    db.raw = jest.fn().mockImplementation((sql) => {
      call++;
      if (sql.includes('calculer_moyenne_matiere') && call === 1) {
        return Promise.reject(new Error('fonction SQL en échec pour insc-1'));
      }
      return Promise.resolve({ rows: [] });
    });

    const job = {
      id: 'job-6',
      data: { classe_id: IDS.classe, periode_id: IDS.periode, matiere_id: IDS.matiere, etablissement_id: IDS.etablissement },
      updateProgress,
    };

    // Ne doit pas lever malgré l'échec d'un calcul individuel — les erreurs
    // par inscription sont seulement journalisées (logger.warn), le job
    // continue pour les inscriptions/matières restantes.
    const result = await traiterCalcul(job);
    expect(result.nb_inscriptions).toBe(2);
  });
});
