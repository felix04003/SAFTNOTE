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

afterEach(() => {
  // IMPORTANT : restaure tout spy créé avec jest.spyOn(...).mockImplementation()
  // (ex. le test d'ordre syncComplete()). Sans ça, clearAllMocks() efface
  // seulement l'historique des appels — pas l'implémentation de remplacement —
  // et les méthodes réelles de syncService restent "cassées" pour tous les
  // tests suivants du fichier.
  jest.restoreAllMocks();
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

// ── §6 — Extensions orchestration sync ──────────────────────────

describe('syncMontante() — échec non silencieux', () => {
  it('un batch qui échoue par exception réseau se reflète dans echecs (pas avalé à 0)', async () => {
    simuConnecte(true);
    const ops = [
      { id: 'op1', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01' },
      { id: 'op2', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockRejectedValueOnce(new Error('Network down'));

    const result = await syncService.syncMontante();

    // Régression : avant le fix, une exception réseau pouvait produire
    // { envoyees: 0, echecs: 0 } (silencieux). Ici le nombre d'échecs doit
    // refléter la taille réelle du batch qui a échoué.
    expect(result.echecs).toBe(ops.length);
    expect(result.envoyees).toBe(0);
  });

  it('les opérations dont le batch a échoué par exception ne sont jamais marquées synced (aucune perte de donnée)', async () => {
    simuConnecte(true);
    const ops = [{ id: 'op1', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01' }];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockRejectedValueOnce(new Error('Timeout'));

    await syncService.syncMontante();

    // marquerOperationSynced (mockRunAsync) ne doit jamais avoir été appelé
    // avec l'id de l'opération échouée — elle reste "en_attente" côté DB et
    // sera reprise au prochain cycle de sync (voir getOperationsPendantes()).
    const appelsAvecOp1 = mockRunAsync.mock.calls.filter(c => c[1]?.includes?.('op1'));
    expect(appelsAvecOp1).toHaveLength(0);
  });

  it("le serveur arbitre le résultat par opération (stratégie : server-wins — le statut 'ok'/'erreur' renvoyé par l'API fait foi, pas de merge local)", async () => {
    simuConnecte(true);
    const ops = [{ id: 'op1', type: 'SAISIR_NOTE', payload: '{"note":15}', created_at_local: '2026-01-01' }];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    mockSyncEnvoyer.mockResolvedValueOnce({
      resultats: [{ op_id: 'op1', statut: 'erreur', code: 'CONFLICT', detail: 'Note déjà saisie côté serveur' }],
    });

    const result = await syncService.syncMontante();

    expect(result.echecs).toBe(1);
    // L'opération est marquée en erreur (pas "synced") — la valeur locale ne
    // remplace pas silencieusement la valeur serveur.
    expect(mockRunAsync).toHaveBeenCalledWith(
      expect.stringContaining("statut='erreur'"),
      expect.arrayContaining(['Note déjà saisie côté serveur', 'op1'])
    );
  });
});

describe('syncComplete() — ordre des opérations', () => {
  it('appelle syncMontante() AVANT syncDescendante() (ordre réel du code : montante puis descendante)', async () => {
    // syncMontante()/syncDescendante() sont entièrement remplacées ci-dessous
    // (mockImplementation) : ce test vérifie uniquement l'ORDRE d'appel de
    // syncComplete(), pas la logique interne. Ne PAS pré-armer mockGetAllAsync /
    // mockGetFirstAsync / mockSyncTelecharger ici — ces mocks ne seraient jamais
    // consommés (les vraies méthodes ne s'exécutent pas) et la valeur "Once"
    // resterait en file, contaminant le test suivant du fichier.
    const ordre: string[] = [];
    const spyMontante = jest.spyOn(syncService, 'syncMontante').mockImplementation(async () => {
      ordre.push('montante');
      return { envoyees: 0, echecs: 0 };
    });
    const spyDescendante = jest.spyOn(syncService, 'syncDescendante').mockImplementation(async () => {
      ordre.push('descendante');
      return { succes: true };
    });

    try {
      await syncService.syncComplete();
      expect(ordre).toEqual(['montante', 'descendante']);
    } finally {
      // Restauration explicite — ne pas compter uniquement sur l'afterEach
      // global : un spy avec mockImplementation() sur le singleton syncService
      // doit être restauré avant que d'autres tests du fichier ne réutilisent
      // syncService.syncMontante()/syncDescendante() réels.
      spyMontante.mockRestore();
      spyDescendante.mockRestore();
    }
  });
});

describe('Réseau qui tombe en cours de syncMontante()', () => {
  it('les opérations non envoyées restent dans la file — rien n\'est perdu', async () => {
    simuConnecte(true);
    const ops = [
      { id: 'op1', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01T00:00:01Z' },
      { id: 'op2', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01T00:00:02Z' },
      { id: 'op3', type: 'SAISIR_NOTE', payload: '{}', created_at_local: '2026-01-01T00:00:03Z' },
    ];
    mockGetAllAsync.mockResolvedValueOnce(ops);
    // Le réseau tombe pendant l'envoi du batch unique (20 ops max par batch ici, donc 1 seul appel)
    mockSyncEnvoyer.mockRejectedValueOnce(new Error('Connexion perdue'));

    const result = await syncService.syncMontante();

    expect(result.echecs).toBe(3);
    // Aucune des 3 ops n'a été marquée synced
    for (const op of ops) {
      const appels = mockRunAsync.mock.calls.filter(c => c[1]?.includes?.(op.id));
      expect(appels).toHaveLength(0);
    }
  });
});

describe('401 pendant la sync — déconnexion sans boucle', () => {
  it('syncDescendante() ne retente pas en boucle si l\'API rejette avec une erreur 401 (SESSION_EXPIREE)', async () => {
    simuConnecte(true);
    mockGetFirstAsync.mockResolvedValueOnce(null);

    class ApiErrorSimulee extends Error {
      code = 'SESSION_EXPIREE';
      statusCode = 401;
    }
    mockSyncTelecharger.mockRejectedValueOnce(new ApiErrorSimulee('Session expirée'));

    const result = await syncService.syncDescendante();

    expect(result.succes).toBe(false);
    expect(result.message).toContain('Session expirée');
    // Un seul appel — pas de retry interne dans syncDescendante (la
    // déconnexion effective est déclenchée par authEventEmitter côté client API,
    // testée dans __tests__/services/client.test.ts).
    expect(mockSyncTelecharger).toHaveBeenCalledTimes(1);
    expect((syncService as any).enCours).toBe(false);
  });
});
