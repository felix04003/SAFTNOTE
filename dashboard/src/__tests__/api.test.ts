import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Api, ApiError } from '../api';
import { CONFIG } from '../config';

const mockFetch = (status: number, ok: boolean, body: unknown) => {
  vi.mocked(fetch).mockResolvedValueOnce({
    status,
    ok,
    json: async () => body,
  } as Response);
};

describe('ApiError', () => {
  it('hérite de Error avec code et status', () => {
    const err = new ApiError('message test', 'MON_CODE', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('message test');
    expect(err.code).toBe('MON_CODE');
    expect(err.status).toBe(400);
  });
});

describe('Api.get', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('appelle fetch avec la méthode GET', async () => {
    mockFetch(200, true, { success: true, data: [] });
    await Api.get('/test');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('inclut le token Authorization si présent (sessionStorage — lot H, finding E6)', async () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'mon-token-jwt');
    mockFetch(200, true, { success: true, data: {} });
    await Api.get('/protected');
    const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer mon-token-jwt');
  });

  it('omet Authorization si pas de token', async () => {
    mockFetch(200, true, { success: true, data: {} });
    await Api.get('/public');
    const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('lève ApiError sur 401', async () => {
    mockFetch(401, false, { error: 'Non autorisé' });
    await expect(Api.get('/secret')).rejects.toBeInstanceOf(ApiError);
  });

  it('lève ApiError sur 500 avec le bon status', async () => {
    mockFetch(500, false, { error: 'Erreur serveur' });
    const err = await Api.get('/broken').catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe('Api.post', () => {
  beforeEach(() => { vi.mocked(fetch).mockClear(); });

  it('envoie le body en JSON', async () => {
    mockFetch(200, true, { success: true, data: {} });
    await Api.post('/ressource', { nom: 'Test', valeur: 42 });
    const opts = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(opts.body as string)).toEqual({ nom: 'Test', valeur: 42 });
  });

  it('utilise la méthode POST', async () => {
    mockFetch(200, true, { success: true, data: {} });
    await Api.post('/ressource', {});
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('Api.put', () => {
  beforeEach(() => { vi.mocked(fetch).mockClear(); });

  it('utilise la méthode PUT', async () => {
    mockFetch(200, true, { success: true, data: {} });
    await Api.put('/ressource/1', { actif: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});

describe('Api.request — 401 avec refresh token (B5)', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockClear();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('401 puis refresh réussi → requête rejouée avec succès', async () => {
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'ancien-refresh-token');

    mockFetch(401, false, { error: 'Token expiré' });                                   // 1er appel /secret
    mockFetch(200, true, { data: { token: 'nouveau-token', refresh_token: 'nouveau-refresh' } }); // POST /auth/refresh
    mockFetch(200, true, { success: true, data: { ok: true } });                        // /secret rejoué

    const result = await Api.get('/secret');

    expect(result).toEqual({ success: true, data: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain('/auth/refresh');
    expect(sessionStorage.getItem(CONFIG.TOKEN_KEY)).toBe('nouveau-token');
    expect(sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBe('nouveau-refresh');
  });

  it('401 puis refresh échoué → redirige vers login.html comme avant, pas de boucle', async () => {
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'ancien-refresh-token');

    mockFetch(401, false, { error: 'Token expiré' });      // 1er appel /secret
    mockFetch(401, false, { error: 'Refresh invalide' });  // POST /auth/refresh échoue

    await expect(Api.get('/secret')).rejects.toBeInstanceOf(ApiError);

    expect(fetch).toHaveBeenCalledTimes(2); // pas de 3e appel (pas de rejouer)
    expect(window.location.href).toContain('login.html');
  });

  it('401 sans refresh token en sessionStorage → redirige immédiatement (comportement inchangé)', async () => {
    mockFetch(401, false, { error: 'Non autorisé' });

    await expect(Api.get('/secret')).rejects.toBeInstanceOf(ApiError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(window.location.href).toContain('login.html');
  });
});

describe('Api.del', () => {
  beforeEach(() => { vi.mocked(fetch).mockClear(); });

  it('utilise la méthode DELETE', async () => {
    mockFetch(200, true, { success: true, data: null });
    await Api.del('/ressource/1');
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
