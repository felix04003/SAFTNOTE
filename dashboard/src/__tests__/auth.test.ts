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
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('retourne null si absent', () => {
    expect(Auth.getToken()).toBeNull();
  });

  it('retourne le token stocké (sessionStorage — lot H, finding E6)', () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test-token');
    expect(Auth.getToken()).toBe('jwt-test-token');
  });
});

describe('Auth.isAuthenticated', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('retourne false si pas de token', () => {
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('retourne false si token présent mais pas de user', () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    expect(Auth.isAuthenticated()).toBe(false);
  });

  it('retourne true si token ET user présents', () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
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
    // Lot H (finding E6) : le JWT lui-même est aussi en sessionStorage, pas localStorage.
    expect(sessionStorage.getItem(CONFIG.TOKEN_KEY)).toBe('jwt-connexion');
    expect(localStorage.getItem(CONFIG.TOKEN_KEY)).toBeNull();
  });
});

describe('Auth.logout (B5 — nettoyage refresh_token)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('supprime le token et le refresh_token de sessionStorage', () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, 'refresh-test');

    Auth.logout();

    expect(sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(CONFIG.TOKEN_KEY)).toBeNull();
  });
});

describe('Auth.requireAuth', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  it('retourne false et redirige vers login.html si non authentifié', () => {
    const result = Auth.requireAuth();
    expect(result).toBe(false);
    expect(window.location.href).toContain('login.html');
  });

  it('retourne true si authentifié', () => {
    sessionStorage.setItem(CONFIG.TOKEN_KEY, 'jwt-test');
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify({ id: '1', role: 'enseignant' }));
    expect(Auth.requireAuth()).toBe(true);
  });
});

describe('Auth.login — payload envoyé au backend', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('envoie etablissement_code (pas code_etablissement) — le schéma Zod backend exige ce nom exact', async () => {
    mockFetch(200, true, {
      data: { token: 'jwt-abc', refresh_token: 'refresh-abc', user: { id: '1', role: 'directeur' } },
    });

    await Auth.login('directeur@test.sn', 'Test1234!', 'TEST_LBD');

    const [, options] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(options!.body as string);
    expect(body).toHaveProperty('etablissement_code', 'TEST_LBD');
    expect(body).not.toHaveProperty('code_etablissement');
  });
});
