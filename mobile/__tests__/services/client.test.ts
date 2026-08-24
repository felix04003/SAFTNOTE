/**
 * Tests unitaires — src/services/api/client.ts
 *
 * Couvre : retry sur erreur réseau, 401 → déconnexion sans retry,
 * réponse !ok → ApiError avec code renvoyé, déballage data.data ?? data.
 */

const mockGetNetworkStateAsync = jest.fn();
jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => mockGetNetworkStateAsync(),
}));

// global.fetch mocké par test
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import { api, authEventEmitter, ApiError } from '../../src/services/api/client';

function reponseOk(data: any, status = 200) {
  return {
    ok: true,
    status,
    json: async () => data,
  };
}
function reponseErreur(status: number, data: any) {
  return {
    ok: false,
    status,
    json: async () => data,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.setToken(null);
});

describe('retry sur erreur réseau', () => {
  it('retente 1 fois puis lève ApiError HORS_LIGNE après 2 tentatives infructueuses', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(api.get('/test')).rejects.toMatchObject({
      code: 'HORS_LIGNE',
      statusCode: 0,
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it('réussit à la 2e tentative si le réseau revient', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockFetch.mockResolvedValueOnce(reponseOk({ data: { ok: true } }));

    const result = await api.get('/test');

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  }, 10000);

  it('ApiError.estHorsLigne est vrai quand statusCode=0', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));

    try {
      await api.get('/test');
      throw new Error('devrait avoir levé');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.estHorsLigne).toBe(true);
    }
  }, 10000);
});

describe('401 → SESSION_EXPIREE, sans retry', () => {
  it('lève ApiError SESSION_EXPIREE et émet l\'event deconnexion, en un seul appel fetch', async () => {
    mockFetch.mockResolvedValueOnce(reponseErreur(401, { erreur: 'Session expirée' }));

    const listener = jest.fn();
    const off = authEventEmitter.on('deconnexion', listener);

    await expect(api.get('/test')).rejects.toMatchObject({
      code: 'SESSION_EXPIREE',
      statusCode: 401,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1); // pas de retry sur 401
    expect(listener).toHaveBeenCalledTimes(1);

    off();
  });
});

describe('réponse serveur !ok → ApiError avec le code renvoyé, pas de retry', () => {
  it('propage le code d\'erreur métier renvoyé par l\'API sans retenter', async () => {
    mockFetch.mockResolvedValueOnce(reponseErreur(422, { erreur: 'Donnée invalide', code: 'VALIDATION_ERREUR' }));

    await expect(api.post('/test', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERREUR',
      statusCode: 422,
      message: 'Donnée invalide',
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('utilise le code générique ERREUR si l\'API ne renvoie pas de code', async () => {
    mockFetch.mockResolvedValueOnce(reponseErreur(500, {}));

    await expect(api.get('/test')).rejects.toMatchObject({ code: 'ERREUR', statusCode: 500 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('déballage data.data ?? data', () => {
  it('renvoie data.data quand le payload est enveloppé', async () => {
    mockFetch.mockResolvedValueOnce(reponseOk({ data: { id: '1', nom: 'Test' }, meta: {} }));

    const result = await api.get('/test');

    expect(result).toEqual({ id: '1', nom: 'Test' });
  });

  it('renvoie le payload brut quand il n\'y a pas de clé data (pas de double-déballage)', async () => {
    mockFetch.mockResolvedValueOnce(reponseOk({ id: '1', nom: 'Direct' }));

    const result = await api.get('/test');

    expect(result).toEqual({ id: '1', nom: 'Direct' });
  });
});
