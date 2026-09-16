import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Auth } from '../auth';
import { CONFIG } from '../config';

const mockFetch = (status: number, ok: boolean, body: unknown) => {
  vi.mocked(fetch).mockResolvedValueOnce({
    status,
    ok,
    json: async () => body,
  } as Response);
};

describe('Auth.getUser', () => {
  beforeEach(() => localStorage.clear());

  it('retourne null si absent', () => {
    expect(Auth.getUser()).toBeNull();
  });

  it('retourne le user parsé depuis localStorage', () => {
    const user = { id: '1', prenom: 'Moussa', nom: 'Diallo', role: 'directeur' };
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
    expect(Auth.getUser()).toEqual(user);
  });

  it('retourne null si JSON invalide', () => {
    localStorage.setItem(CONFIG.USER_KEY, 'pas-du-json{');
    expect(Auth.getUser()).toBeNull();
  });
});

describe('Auth.getToken', () => {
  beforeEach(() => localStorage.clear());

  it('retourne null si absent', () => {
    expect(Auth.getToken()).toBeNull();
  });

  it('retourne le token stocké', () => {
    localStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test-token');
    expect(Auth.getToken()).toBe('jwt-test-token');
  });
});

describe('Auth.isAuthenticated', () => {
  beforeEach(() => localStorage.clear());

  it('retourne false si pas de token', () => {
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('retourne false si token présent mais pas de user', () => {
    localStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('retourne true si token ET user présents', () => {
    localStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify({ id: '1', role: 'directeur' }));
    expect(Auth.isAuthenticated()).toBe(true);
  });
});

describe('Auth.login (B5 — persistance refresh_token)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.mocked(fetch).mockClear();
  });

  it('persiste refresh_token en sessionStorage (pas localStorage)', async () => {
    mockFetch(200, true, {
      data: {
        token: 'jwt-connexion',
        refresh_token: 'refresh-connexion',
        utilisateur: { id: '1', role: 'directeur' },
      },
    });

    await Auth.login('directeur@test.sn', 'motdepasse', 'ETAB');

    expect(sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBe('refresh-connexion');
    expect(localStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONFIG.TOKEN_KEY)).toBe('jwt-connexion');
  });
});

describe('Auth.logout (B5 — nettoyage refresh_token)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('supprime le refresh_token de sessionStorage', () => {
    localStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'refresh-test');

    Auth.logout();

    expect(sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(CONFIG.TOKEN_KEY)).toBeNull();
  });
});

describe('Auth.requireAuth', () => {
  beforeEach(() => localStorage.clear());

  it('retourne false et redirige vers login.html si non authentifié', () => {
    const result = Auth.requireAuth();
    expect(result).toBe(false);
    expect(window.location.href).toContain('login.html');
  });

  it('retourne true si authentifié', () => {
    localStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify({ id: '1', role: 'enseignant' }));
    expect(Auth.requireAuth()).toBe(true);
  });
});
