/**
 * Tests unitaires — database.ts
 *
 * Strategie : mocker expo-sqlite avec une implementation in-memory minimaliste.
 * Les tests couvrent : ouvrirBD(), creerTables(), helpers upsert, operations pendantes.
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockExecAsync  = jest.fn().mockResolvedValue(undefined);
const mockRunAsync   = jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 });
const mockGetFirstAsync = jest.fn().mockResolvedValue(null);
const mockGetAllAsync   = jest.fn().mockResolvedValue([]);

const mockDb = {
  execAsync:    mockExecAsync,
  runAsync:     mockRunAsync,
  getFirstAsync: mockGetFirstAsync,
  getAllAsync:   mockGetAllAsync,
};

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue(mockDb),
}));

// ── Import sous test (apres les mocks) ───────────────────────────

import * as SQLite from 'expo-sqlite';
import {
  ouvrirBD,
  getDB,
  upsertEleves,
  upsertEvaluations,
  sauvegarderNoteLocale,
  sauvegarderPresenceLocale,
  ajouterOperationPendante,
  getOperationsPendantes,
  marquerOperationSynced,
} from '../../src/services/storage/database';

// ── Setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────

describe('ouvrirBD()', () => {
  it('appelle openDatabaseAsync avec le bon nom de fichier', async () => {
    await ouvrirBD();
    expect(SQLite.openDatabaseAsync).toHaveBeenCalledWith(
      'ecolemanager.db',
      expect.objectContaining({ enableChangeListener: true })
    );
  });

  it('active WAL et foreign keys', async () => {
    await ouvrirBD();
    expect(mockExecAsync).toHaveBeenCalledWith('PRAGMA journal_mode = WAL;');
    expect(mockExecAsync).toHaveBeenCalledWith('PRAGMA foreign_keys = ON;');
  });

  it('cree les tables (execAsync appele au moins une fois pour le schema)', async () => {
    await ouvrirBD();
    // Le schema est cree dans creerTables() via execAsync — au minimum 1 appel de schema
    const execCalls = mockExecAsync.mock.calls.map((c: any[]) => c[0] as string);
    const hasSchemaCall = execCalls.some((sql: string) => sql.includes('CREATE TABLE IF NOT EXISTS session'));
    expect(hasSchemaCall).toBe(true);
  });
});

describe('getDB()', () => {
  it('retourne la db apres ouvrirBD()', async () => {
    await ouvrirBD();
    const db = getDB();
    expect(db).toBe(mockDb);
  });
});

describe('upsertEleves()', () => {
  beforeEach(async () => { await ouvrirBD(); jest.clearAllMocks(); });

  it('insere chaque eleve avec runAsync', async () => {
    const eleves = [
      { id: 'e1', nom: 'Diallo', prenom: 'Mamadou', inscription_id: 'i1', classe: '5eme A', photo_url: null, matricule: 'M001', updated_at: '2026-01-01' },
      { id: 'e2', nom: 'Sow', prenom: 'Aminata', inscription_id: 'i2', classe: '5eme A', photo_url: null, matricule: 'M002', updated_at: '2026-01-01' },
    ];
    await upsertEleves(eleves);
    expect(mockRunAsync).toHaveBeenCalledTimes(2);
  });

  it('ne plante pas sur un tableau vide', async () => {
    await expect(upsertEleves([])).resolves.toBeUndefined();
    expect(mockRunAsync).not.toHaveBeenCalled();
  });

  it('passe les bons parametres pour un eleve', async () => {
    const eleve = { id: 'e3', nom: 'Ba', prenom: 'Ibrahima', inscription_id: 'i3', classe: '3eme B', photo_url: 'url', matricule: 'M003', updated_at: '2026-01-02' };
    await upsertEleves([eleve]);
    const params = mockRunAsync.mock.calls[0][1];
    expect(params).toEqual(['e3', 'Ba', 'Ibrahima', 'i3', '3eme B', 'url', 'M003', '2026-01-02']);
  });
});

describe('upsertEvaluations()', () => {
  beforeEach(async () => { await ouvrirBD(); jest.clearAllMocks(); });

  it('insere chaque evaluation avec runAsync', async () => {
    const evals = [
      { id: 'ev1', affectation_id: 'a1', type: 'devoir', numero: 1, titre: 'Devoir 1', date_evaluation: '2026-02-01', note_max: 20, notes_publiees: false, matiere: 'Maths', classe: '5eme A', updated_at: '2026-02-01' },
    ];
    await upsertEvaluations(evals);
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
  });

  it('convertit notes_publiees bool → int', async () => {
    const ev = { id: 'ev2', affectation_id: 'a1', type: 'devoir', numero: 2, titre: 'D2', date_evaluation: '2026-02-05', note_max: 20, notes_publiees: true, matiere: 'Francais', classe: '5eme A', updated_at: '2026-02-05' };
    await upsertEvaluations([ev]);
    const params = mockRunAsync.mock.calls[0][1];
    // notes_publiees converties en 1
    expect(params[7]).toBe(1);
  });
});

describe('sauvegarderNoteLocale()', () => {
  beforeEach(async () => { await ouvrirBD(); jest.clearAllMocks(); });

  it('appelle runAsync avec synced=0', async () => {
    await sauvegarderNoteLocale({
      id: 'n1', evaluation_id: 'ev1', eleve_id: 'e1', inscription_id: 'i1',
      valeur: 15.5, est_absent: false, absence_justifiee: false, appreciation: 'Bien',
    });
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const sql = mockRunAsync.mock.calls[0][0] as string;
    expect(sql).toContain('synced=0');
  });

  it('convertit est_absent bool → int', async () => {
    await sauvegarderNoteLocale({
      id: 'n2', evaluation_id: 'ev1', eleve_id: 'e2', inscription_id: 'i2',
      valeur: null, est_absent: true, absence_justifiee: true,
    });
    const params = mockRunAsync.mock.calls[0][1];
    expect(params[5]).toBe(1); // est_absent
    expect(params[6]).toBe(1); // absence_justifiee
  });
});

describe('sauvegarderPresenceLocale()', () => {
  beforeEach(async () => { await ouvrirBD(); jest.clearAllMocks(); });

  it('appelle runAsync avec synced=0', async () => {
    await sauvegarderPresenceLocale({
      id: 'p1', appel_id: 'a1', inscription_id: 'i1', eleve_id: 'e1',
      eleve_nom: 'Diallo', eleve_prenom: 'Mamadou', statut: 'absent',
    });
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const sql = mockRunAsync.mock.calls[0][0] as string;
    expect(sql).toContain('synced=0');
  });
});

describe('operations pendantes', () => {
  beforeEach(async () => { await ouvrirBD(); jest.clearAllMocks(); });

  it('ajouterOperationPendante insere dans la BD', async () => {
    await ajouterOperationPendante('SAISIR_NOTE', { evaluation_id: 'ev1', notes: [] });
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const sql = mockRunAsync.mock.calls[0][0] as string;
    expect(sql).toContain('operations_pending');
  });

  it('getOperationsPendantes retourne les ops en attente', async () => {
    const ops = [{ id: '1', type: 'SAISIR_NOTE', payload: '{}', statut: 'en_attente', tentatives: 0 }];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    const result = await getOperationsPendantes();
    expect(result).toEqual(ops);
    const sql = mockGetAllAsync.mock.calls[0][0] as string;
    expect(sql).toContain("statut='en_attente'");
  });

  it('marquerOperationSynced met a jour le statut', async () => {
    await marquerOperationSynced('op-123');
    expect(mockRunAsync).toHaveBeenCalledTimes(1);
    const sql = mockRunAsync.mock.calls[0][0] as string;
    expect(sql).toContain("statut='envoyé'");
    expect(mockRunAsync.mock.calls[0][1]).toContain('op-123');
  });
});
