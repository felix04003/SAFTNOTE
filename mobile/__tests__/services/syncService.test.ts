/**
 * Tests unitaires — syncService.ts
 *
 * Strategie : mocker expo-network, l'API sync, et la BD SQLite.
 * Couvre : syncDescendante (connecte / hors-ligne / deja en cours),
 *          syncMontante (batch, echecs, vide), syncComplete.
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockGetNetworkStateAsync = jest.fn();

jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => mockGetNetworkStateAsync(),
}));

const mockSyncTelecharger = jest.fn();
const mockSyncEnvoyer     = jest.fn();

jest.mock('../../src/services/api/client', () => ({
  syncApi: {
    telecharger: (...args: any[]) => mockSyncTelecharger(...args),
    envoyer:     (...args: any[]) => mockSyncEnvoyer(...args),
  },
}));

const mockGetFirstAsync = jest.fn().mockResolvedValue(null);
const mockRunAsync      = jest.fn().mockResolvedValue(undefined);
const mockGetAllAsync   = jest.fn().mockResolvedValue([]);

const mockDb = {
  getFirstAsync: (...args: any[]) => mockGetFirstAsync(...args),
  runAsync:      (...args: any[]) => mockRunAsync(...args),
  getAllAsync:    (...args: any[]) => mockGetAllAsync(...args),
};

jest.mock('../../src/services/storage/database', () => ({
  getDB:                   () => mockDb,
  upsertEleves:            jest.fn().mockResolvedValue(undefined),
  upsertEvaluations:       jest.fn().mockResolvedValue(undefined),
  getOperationsPendantes:  (...args: any[]) => mockGetAllAsync(...args),
  marquerOperationSynced:  (...args: any[]) => mockRunAsync(...args),
}));

// Mock Zustand authStore
const mockSession = {
  utilisateur_id:    'user-001',
  etablissement_id:  'etab-001',
  role:              'enseignant',
  nom_complet:       'Moussa Diallo',
  etablissement_nom: 'Lycee Lamine Gueye',
};

jest.mock('../../src/stores/authStore', () => ({
  useAuthStore: {
    getState: jest.fn(() => ({ session: mockSession })),
  },
}));

// ── Import sous test ─────────────────────────────────────────────

import { syncService } from '../../src/services/sync/syncService';
import { upsertEleves, upsertEvaluations } from '../../src/services/storage/database';

// ── Helpers ──────────────────────────────────────────────────────

function simuConnecte(connecte = true) {
  mockGetNetworkStateAsync.mockResolvedValue({
    isConnected:         connecte,
    isInternetReachable: connecte,
  });
}

const SYNC_RESPONSE = {
  payload: {
    eleves:      [{ id: 'e1', nom: 'Diallo', prenom: 'M', inscription_id: 'i1', classe: '5A', photo_url: null, matricule: 'M001', updated_at: '2026-01-01' }],
    evaluations: [],
    notes:       [],
    edt:         [],
  },
  sync_at: '2026-08-05T01:00:00Z',
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset l'etat interne du service (enCours = false via hack)
  (syncService as any).enCours = false;
});

describe('syncDescendante()', () => {
  it('retourne succes=false si hors ligne', async () => {
    simuConnecte(false);

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(false);
    expect(result.message).toContain('Hors ligne');
    expect(mockSyncTelecharger).not.toHaveBeenCalled();
  });

  it('retourne succes=false si pas de session', async () => {
    const { useAuthStore } = require('../../src/stores/authStore');
    useAuthStore.getState.mockReturnValueOnce({ session: null });
    simuConnecte(true);

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(false);
    expect(result.message).toContain('Non connecté');
  });

  it('retourne succes=false si sync deja en cours', async () => {
    (syncService as any).enCours = true;
    simuConnecte(true);

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(false);
    expect(result.message).toContain('en cours');
  });

  it('telecharge et persiste les donnees si connecte', async () => {
    simuConnecte(true);
    mockGetFirstAsync.mockResolvedValueOnce({ derniere_sync: null });
    mockSyncTelecharger.mockResolvedValueOnce(SYNC_RESPONSE);

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(true);
    expect(mockSyncTelecharger).toHaveBeenCalledTimes(1);
    expect(upsertEleves).toHaveBeenCalledWith(SYNC_RESPONSE.payload.eleves);
  });

  it('met a jour derniere_sync dans la session', async () => {
    simuConnecte(true);
    mockGetFirstAsync.mockResolvedValueOnce({ derniere_sync: '2026-08-04T00:00:00Z' });
    mockSyncTelecharger.mockResolvedValueOnce(SYNC_RESPONSE);

    await syncService.syncDescendante();

    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE session SET derniere_sync'),
      expect.arrayContaining(['2026-08-05T01:00:00Z', 'user-001'])
    );
  });

  it('passe depuis= a l API si une sync precedente existe', async () => {
    simuConnecte(true);
    const derniere = '2026-08-04T00:00:00Z';
    mockGetFirstAsync.mockResolvedValueOnce({ derniere_sync: derniere });
    mockSyncTelecharger.mockResolvedValueOnce(SYNC_RESPONSE);

    await syncService.syncDescendante();

    expect(mockSyncTelecharger).toHaveBeenCalledWith(derniere);
  });

  it('retourne succes=false si l API leve une erreur', async () => {
    simuConnecte(true);
    mockGetFirstAsync.mockResolvedValueOnce(null);
    mockSyncTelecharger.mockRejectedValueOnce(new Error('Timeout API'));

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(false);
    expect(result.message).toBe('Timeout API');
  });

  it('remet enCours=false meme apres une erreur', async () => {
    simuConnecte(true);
    mockGetFirstAsync.mockResolvedValueOnce(null);
    mockSyncTelecharger.mockRejectedValueOnce(new Error('Crash'));

    await syncService.syncDescendante();

    expect((syncService as any).enCours).toBe(false);
  });
});

describe('syncMontante()', () => {
  it('retourne { envoyees:0, echecs:0 } si hors ligne', async () => {
    simuConnecte(false);

    const result = await syncService.syncMontante();

    expect(result.envoyees).toBe(0);
    expect(result.echecs).toBe(0);
    expect(mockSyncEnvoyer).not.toHaveBeenCalled();
  });

  it('retourne { envoyees:0, echecs:0 } si aucune operation pendante', async () => {
    simuConnecte(true);
    mockGetAllAsync.mockResolvedValueOnce([]);

    const result = await syncService.syncMontante();

    expect(result.envoyees).toBe(0);
    expect(result.echecs).toBe(0);
    expect(mockSyncEnvoyer).not.toHaveBeenCalled();
  });

  it('envoie les operations et incremente envoyees', async () => {
    simuConnecte(true);
    const ops = [
      { id: 'op1', type: 'SAISIR_NOTE', payload: '{"note":15}', created_at_local: '2026-01-01' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockResolvedValueOnce({
      resultats: [{ op_id: 'op1', statut: 'ok' }],
    });

    const result = await syncService.syncMontante();

    expect(result.envoyees).toBe(1);
    expect(result.echecs).toBe(0);
    expect(mockRunAsync).toHaveBeenCalled();
  });

  it('incremente echecs si l API retourne statut erreur', async () => {
    simuConnecte(true);
    const ops = [
      { id: 'op2', type: 'SAISIR_NOTE', payload: '{"note":18}', created_at_local: '2026-01-01' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockResolvedValueOnce({
      resultats: [{ op_id: 'op2', statut: 'erreur', code: 'CONFLICT', detail: 'Note deja saisie' }],
    });

    const result = await syncService.syncMontante();

    expect(result.echecs).toBe(1);
    expect(result.envoyees).toBe(0);
  });

  it('compte les echecs si l API lance une exception', async () => {
    simuConnecte(true);
    const ops = [
      { id: 'op3', type: 'SAISIR_PRESENCE', payload: '{}', created_at_local: '2026-01-01' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockRejectedValueOnce(new Error('Network error'));

    const result = await syncService.syncMontante();

    expect(result.echecs).toBe(1);
  });
});

describe('syncComplete()', () => {
  it('appelle syncMontante puis syncDescendante', async () => {
    simuConnecte(true);
    mockGetAllAsync.mockResolvedValueOnce([]);
    mockGetFirstAsync.mockResolvedValueOnce(null);
    mockSyncTelecharger.mockResolvedValueOnce(SYNC_RESPONSE);

    const spyMontante    = jest.spyOn(syncService, 'syncMontante');
    const spyDescendante = jest.spyOn(syncService, 'syncDescendante');

    await syncService.syncComplete();

    expect(spyMontante).toHaveBeenCalledTimes(1);
    expect(spyDescendante).toHaveBeenCalledTimes(1);
  });
});

describe('demarrer() / arreter()', () => {
  it('arreter() annule le timer', () => {
    (syncService as any).timer = setInterval(() => {}, 99999);
    syncService.arreter();
    expect((syncService as any).timer).toBeNull();
  });
});
