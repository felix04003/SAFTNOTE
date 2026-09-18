'use strict';

/**
 * Comme notification.worker.js, generation-bulletins.worker.js exécute du
 * câblage BullMQ + Puppeteer au chargement. On mocke toutes les I/O (DB,
 * Redis, BullMQ, Puppeteer, storage S3) pour tester traiterJob() et
 * getDonneesBulletin() isolément (exports ajoutés en fin de fichier, lot J/E5).
 */

jest.mock('../../src/infrastructure/database/pool', () => ({
  getDB: jest.fn(),
  connectDB: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  createBullMQConnection: jest.fn().mockReturnValue({}),
}));
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));
jest.mock('../../src/infrastructure/storage/storage.service', () => ({
  uploadFichier: jest.fn(),
}));
jest.mock('../../src/templates/bulletin-template', () => ({
  genererHTMLBulletin: jest.fn().mockReturnValue('<html></html>'),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const mockPage = {
  setContent: jest.fn().mockResolvedValue(undefined),
  pdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4')),
  close: jest.fn().mockResolvedValue(undefined),
};
const mockBrowser = {
  newPage: jest.fn().mockResolvedValue(mockPage),
  close: jest.fn().mockResolvedValue(undefined),
};
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue(mockBrowser),
}));

const { getDB } = require('../../src/infrastructure/database/pool');
const { uploadFichier } = require('../../src/infrastructure/storage/storage.service');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');

const { traiterJob, getDonneesBulletin, EchecUploadBulletin } = require('../../src/workers/generation-bulletins.worker');

describe('generation-bulletins.worker — getDonneesBulletin', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
  });

  test('retourne null si le bulletin est introuvable pour cet établissement', async () => {
    db.mockReturnValueOnce(mockQuery(undefined));
    const result = await getDonneesBulletin(db, 'bulletin-1', IDS.etablissement);
    expect(result).toBeNull();
  });

  test('assemble établissement, élève, matières et conduite quand le bulletin existe', async () => {
    db.mockReturnValueOnce(mockQuery({
      id: 'bulletin-1', nom: 'Traoré', prenom: 'Aminata', matricule: 'ELV-001',
      classe: 'Term S1', niveau: 'Terminale', trimestre: 1, periode: 'Trimestre 1',
      annee_scolaire: '2024-2025', inscription_id: IDS.inscription, periode_id: IDS.periode,
      moyenne_generale: 14.2, rang: 3, rang_sur: 35,
    }));
    db.mockReturnValueOnce(mockQuery([{ matiere: 'Maths', moyenne: 14 }]));
    db.mockReturnValueOnce(mockQuery({ valeur: 'Bien', appreciation: 'Bon comportement' }));
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Test', ville: 'Dakar' }));

    const donnees = await getDonneesBulletin(db, 'bulletin-1', IDS.etablissement);

    expect(donnees.eleve.nom).toBe('Traoré');
    expect(donnees.matieres).toHaveLength(1);
    expect(donnees.conduite).toEqual({ valeur: 'Bien', appreciation: 'Bon comportement' });
    expect(donnees.resultat.moyenne_generale).toBe(14.2);
  });
});

describe('generation-bulletins.worker — traiterJob', () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    getDB.mockReturnValue(db);
    jest.clearAllMocks();
    uploadFichier.mockReset();
    mockPage.close.mockClear();
    mockBrowser.close.mockClear();
  });

  const job = {
    id: 'job-1',
    data: { classe_id: IDS.classe, periode_id: IDS.periode, etablissement_id: IDS.etablissement },
    updateProgress: jest.fn().mockResolvedValue(undefined),
  };

  test('ne fait rien si aucun bulletin n\'est en attente de rendu', async () => {
    db.mockReturnValueOnce(mockQuery([])); // aPDF vide

    const result = await traiterJob(job);

    expect(result).toEqual({ generes: 0, echecs: 0 });
  });

  test('propage une EchecUploadBulletin quand uploadFichier échoue, pour déclencher le retry BullMQ', async () => {
    db.mockReturnValueOnce(mockQuery([{ id: 'bulletin-1' }])); // aPDF
    // getDonneesBulletin
    db.mockReturnValueOnce(mockQuery({
      id: 'bulletin-1', nom: 'Traoré', prenom: 'Aminata', matricule: 'ELV-001',
      classe: 'Term S1', niveau: 'Terminale', trimestre: 1, periode: 'Trimestre 1',
      annee_scolaire: '2024-2025', inscription_id: IDS.inscription, periode_id: IDS.periode,
    }));
    db.mockReturnValueOnce(mockQuery([])); // matieres
    db.mockReturnValueOnce(mockQuery(undefined)); // conduite
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Test' })); // etablissement

    uploadFichier.mockResolvedValue(null); // échec upload S3

    await expect(traiterJob(job)).rejects.toThrow(EchecUploadBulletin);
    expect(mockBrowser.close).toHaveBeenCalled(); // le navigateur est bien fermé même en cas d'échec
  });

  test('génère et uploade le PDF, met à jour bulletin_key en base', async () => {
    db.mockReturnValueOnce(mockQuery([{ id: 'bulletin-1' }])); // aPDF
    db.mockReturnValueOnce(mockQuery({
      id: 'bulletin-1', nom: 'Traoré', prenom: 'Aminata', matricule: 'ELV-001',
      classe: 'Term S1', niveau: 'Terminale', trimestre: 1, periode: 'Trimestre 1',
      annee_scolaire: '2024-2025', inscription_id: IDS.inscription, periode_id: IDS.periode,
    }));
    db.mockReturnValueOnce(mockQuery([])); // matieres
    db.mockReturnValueOnce(mockQuery(undefined)); // conduite
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Test' })); // etablissement
    const updateChain = mockQuery(1);
    db.mockReturnValueOnce(updateChain); // update bulletin_key

    uploadFichier.mockResolvedValue(`bulletins/${IDS.etablissement}/${IDS.periode}/bulletin-1.pdf`);

    const result = await traiterJob(job);

    expect(result).toEqual({ generes: 1, echecs: 0 });
    expect(updateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      bulletin_key: `bulletins/${IDS.etablissement}/${IDS.periode}/bulletin-1.pdf`,
    }));
  });

  test('compte en échec un bulletin dont les données sont introuvables, sans interrompre le lot', async () => {
    db.mockReturnValueOnce(mockQuery([{ id: 'bulletin-manquant' }, { id: 'bulletin-ok' }])); // aPDF (2)
    db.mockReturnValueOnce(mockQuery(undefined)); // getDonneesBulletin(bulletin-manquant) -> null

    db.mockReturnValueOnce(mockQuery({
      id: 'bulletin-ok', nom: 'Ba', prenom: 'Mariama', matricule: 'ELV-003',
      classe: 'Term S1', niveau: 'Terminale', trimestre: 1, periode: 'Trimestre 1',
      annee_scolaire: '2024-2025', inscription_id: IDS.inscription, periode_id: IDS.periode,
    }));
    db.mockReturnValueOnce(mockQuery([]));
    db.mockReturnValueOnce(mockQuery(undefined));
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Test' }));
    db.mockReturnValueOnce(mockQuery(1)); // update

    uploadFichier.mockResolvedValue('bulletins/ok.pdf');

    const result = await traiterJob(job);

    expect(result).toEqual({ generes: 1, echecs: 1 });
  });
});
