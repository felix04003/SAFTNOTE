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

describe('Auth.destination', () => {
  it('mot de passe provisoire : page de changement, quel que soit le rôle', () => {
    expect(Auth.destination({ role: 'enseignant', doit_changer_mdp: true })).toBe('changer-mot-de-passe.html');
    expect(Auth.destination({ role: 'directeur', doit_changer_mdp: true })).toBe('changer-mot-de-passe.html');
  });

  it('sinon selon le rôle', () => {
    expect(Auth.destination({ role: 'enseignant' })).toBe('enseignant.html');
    expect(Auth.destination({ role: 'Parent' })).toBe('parent.html');
    expect(Auth.destination({ role: 'directeur' })).toBe('index.html');
    expect(Auth.destination(null)).toBe('index.html');
  });
});

describe('Auth.login — ce qui est stocké', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

  const reponse = {
    succes: true,
    data: {
      token: 'jwt-secret', refresh_token: 'refresh-secret',
      utilisateur: { id: 'u1', prenom: 'Mame', nom: 'Cisse', role: 'enseignant', doit_changer_mdp: true },
    },
  };

  it('USER_KEY (localStorage) ne contient que le profil, jamais le jeton', async () => {
    mockFetch(200, true, reponse);
    await Auth.login('+221779990001', 'x', 'ECOLE');
    const stocke = localStorage.getItem(CONFIG.USER_KEY) || '';
    expect(JSON.parse(stocke)).toEqual(reponse.data.utilisateur);
    expect(stocke).not.toContain('jwt-secret');
    expect(stocke).not.toContain('refresh-secret');
    expect(sessionStorage.getItem(CONFIG.TOKEN_KEY)).toBe('jwt-secret');
  });

  it('Auth.majUser fusionne dans le profil stocké', async () => {
    mockFetch(200, true, reponse);
    await Auth.login('+221779990001', 'x', 'ECOLE');
    Auth.majUser({ doit_changer_mdp: false });
    expect(Auth.getUser()).toMatchObject({ id: 'u1', role: 'enseignant', doit_changer_mdp: false });
  });
});
