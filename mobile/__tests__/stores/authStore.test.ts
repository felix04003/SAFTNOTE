/**
 * Tests unitaires — authStore.ts (Zustand)
 *
 * Strategie : mocker SecureStore, expo-sqlite et l'API client.
 * Couvre : chargerSession, connexionMDP, connexionOTP, deconnexion.
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockSetItemAsync    = jest.fn().mockResolvedValue(undefined);
const mockGetItemAsync    = jest.fn().mockResolvedValue(null);
const mockDeleteItemAsync = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-secure-store', () => ({
  setItemAsync:    (...args: any[]) => mockSetItemAsync(...args),
  getItemAsync:    (...args: any[]) => mockGetItemAsync(...args),
  deleteItemAsync: (...args: any[]) => mockDeleteItemAsync(...args),
}));

const mockExecAsync = jest.fn().mockResolvedValue(undefined);
const mockDbInstance = { execAsync: mockExecAsync };

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn().mockResolvedValue(mockDbInstance),
}));

const mockApiSetToken        = jest.fn();
const mockApiSetRefreshToken = jest.fn();
const mockConnexion          = jest.fn();
const mockValiderOTP         = jest.fn();
const mockDeconnexion        = jest.fn().mockResolvedValue(undefined);

// Emetteur minimal réutilisé pour simuler 'token_rafraichi' émis par
// ApiClient après un refresh réussi (voir client.ts).
class MockEventEmitter {
  private listeners: Record<string, Function[]> = {};
  on(event: string, fn: Function) {
    this.listeners[event] = [...(this.listeners[event] || []), fn];
    return () => { this.listeners[event] = (this.listeners[event] || []).filter(f => f !== fn); };
  }
  emit(event: string, ...args: any[]) {
    (this.listeners[event] || []).forEach(fn => fn(...args));
  }
}
const mockAuthEventEmitter = new MockEventEmitter();

jest.mock('../../src/services/api/client', () => ({
  api: {
    setToken:        (...args: any[]) => mockApiSetToken(...args),
    setRefreshToken: (...args: any[]) => mockApiSetRefreshToken(...args),
  },
  authApi: {
    connexion:   (...args: any[]) => mockConnexion(...args),
    validerOTP:  (...args: any[]) => mockValiderOTP(...args),
    deconnexion: () => mockDeconnexion(),
  },
  authEventEmitter: mockAuthEventEmitter,
}));

jest.mock('../../src/services/storage/database', () => ({
  getDB: () => mockDbInstance,
}));

// ── Import sous test ─────────────────────────────────────────────
// require() (pas `import`) : authStore.ts enregistre un listener
// 'token_rafraichi' dès son chargement, donc mockAuthEventEmitter doit déjà
// être initialisé. Les `import` ES sont hoissés par Babel au-dessus des
// `const` de ce fichier ; un require() explicite ici garantit l'ordre
// d'exécution réel (après la définition de mockAuthEventEmitter ci-dessus).

const { useAuthStore } = require('../../src/stores/authStore');

// ── Helpers ──────────────────────────────────────────────────────

const SESSION_FIXTURE = {
  utilisateur_id:    'user-001',
  etablissement_id:  'etab-001',
  nom_complet:       'Moussa Diallo',
  role:              'enseignant' as const,
  etablissement_nom: 'Lycee Lamine Gueye',
};

const TOKEN_FIXTURE = 'jwt.token.fixture';

const REFRESH_TOKEN_FIXTURE = 'refresh.token.fixture';

const API_RESPONSE = {
  token: TOKEN_FIXTURE,
  refresh_token: REFRESH_TOKEN_FIXTURE,
  utilisateur: {
    id:               'user-001',
    etablissement_id: 'etab-001',
    prenom:           'Moussa',
    nom:              'Diallo',
    role:             'enseignant',
    etablissement_nom: 'Lycee Lamine Gueye',
  },
};

// ── Tests ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset store state before each test
  useAuthStore.setState({
    session:     null,
    token:       null,
    chargement:  true,
    estConnecte: false,
  });
});

describe('chargerSession()', () => {
  it('charge la session depuis SecureStore si token et session present', async () => {
    mockGetItemAsync
      .mockResolvedValueOnce(TOKEN_FIXTURE)
      .mockResolvedValueOnce(REFRESH_TOKEN_FIXTURE)
      .mockResolvedValueOnce(JSON.stringify(SESSION_FIXTURE));

    await useAuthStore.getState().chargerSession();

    const state = useAuthStore.getState();
    expect(state.estConnecte).toBe(true);
    expect(state.token).toBe(TOKEN_FIXTURE);
    expect(state.session?.utilisateur_id).toBe('user-001');
    expect(mockApiSetToken).toHaveBeenCalledWith(TOKEN_FIXTURE);
    expect(mockApiSetRefreshToken).toHaveBeenCalledWith(REFRESH_TOKEN_FIXTURE);
  });

  it('reste deconnecte si aucune session en store', async () => {
    mockGetItemAsync.mockResolvedValue(null);

    await useAuthStore.getState().chargerSession();

    const state = useAuthStore.getState();
    expect(state.estConnecte).toBe(false);
    expect(state.chargement).toBe(false);
  });

  it('met chargement=false dans tous les cas', async () => {
    mockGetItemAsync.mockRejectedValue(new Error('SecureStore indisponible'));

    await useAuthStore.getState().chargerSession();

    expect(useAuthStore.getState().chargement).toBe(false);
  });
});

describe('connexionMDP()', () => {
  it('connecte et persiste la session apres connexion reussie', async () => {
    mockConnexion.mockResolvedValue(API_RESPONSE);

    await useAuthStore.getState().connexionMDP({
      identifiant:       'moussa@lycee.sn',
      mot_de_passe:      'password123',
      etablissement_code: 'LLG-001',
    });

    const state = useAuthStore.getState();
    expect(state.estConnecte).toBe(true);
    expect(state.token).toBe(TOKEN_FIXTURE);
    expect(state.session?.nom_complet).toBe('Moussa Diallo');
    expect(mockSetItemAsync).toHaveBeenCalledWith('jwt_token', TOKEN_FIXTURE);
    expect(mockSetItemAsync).toHaveBeenCalledWith('refresh_token', REFRESH_TOKEN_FIXTURE);
    expect(mockSetItemAsync).toHaveBeenCalledWith('session', expect.any(String));
    expect(mockApiSetRefreshToken).toHaveBeenCalledWith(REFRESH_TOKEN_FIXTURE);
  });

  it('propage l erreur si l API echoue', async () => {
    mockConnexion.mockRejectedValue(new Error('Identifiants incorrects'));

    await expect(
      useAuthStore.getState().connexionMDP({
        identifiant: 'bad@user.sn',
        mot_de_passe: 'wrong',
        etablissement_code: 'X',
      })
    ).rejects.toThrow('Identifiants incorrects');
  });
});

describe('connexionOTP()', () => {
  it('connecte un parent via OTP', async () => {
    mockValiderOTP.mockResolvedValue({
      ...API_RESPONSE,
      utilisateur: { ...API_RESPONSE.utilisateur, role: 'parent' },
    });

    await useAuthStore.getState().connexionOTP({
      telephone:          '+221701234567',
      code:               '123456',
      etablissement_code: 'LLG-001',
    });

    const state = useAuthStore.getState();
    expect(state.estConnecte).toBe(true);
    expect(state.session?.role).toBe('parent');
  });
});

describe('deconnexion()', () => {
  it('vide la session et le token', async () => {
    // Simuler un etat connecte
    useAuthStore.setState({
      session:     SESSION_FIXTURE,
      token:       TOKEN_FIXTURE,
      estConnecte: true,
    });

    await useAuthStore.getState().deconnexion();

    const state = useAuthStore.getState();
    expect(state.estConnecte).toBe(false);
    expect(state.session).toBeNull();
    expect(state.token).toBeNull();
  });

  it('supprime les cles SecureStore', async () => {
    useAuthStore.setState({ session: SESSION_FIXTURE, token: TOKEN_FIXTURE, estConnecte: true });

    await useAuthStore.getState().deconnexion();

    expect(mockDeleteItemAsync).toHaveBeenCalledWith('jwt_token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('refresh_token');
    expect(mockDeleteItemAsync).toHaveBeenCalledWith('session');
  });

  it('appelle api.setToken(null) et api.setRefreshToken(null)', async () => {
    useAuthStore.setState({ session: SESSION_FIXTURE, token: TOKEN_FIXTURE, estConnecte: true });

    await useAuthStore.getState().deconnexion();

    expect(mockApiSetToken).toHaveBeenCalledWith(null);
    expect(mockApiSetRefreshToken).toHaveBeenCalledWith(null);
  });

  it('vide la BD locale via execAsync', async () => {
    useAuthStore.setState({ session: SESSION_FIXTURE, token: TOKEN_FIXTURE, estConnecte: true });

    await useAuthStore.getState().deconnexion();

    expect(mockExecAsync).toHaveBeenCalled();
    const sql = mockExecAsync.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM session');
  });
});

describe('événement token_rafraichi (B5 — refresh émis par ApiClient)', () => {
  it('persiste le nouveau token/refresh_token dans SecureStore et met à jour le store', async () => {
    mockAuthEventEmitter.emit('token_rafraichi', {
      token: 'nouveau.jwt.token',
      refresh_token: 'nouveau.refresh.token',
    });
    // L'écouteur est async — laisser la microtask queue se vider
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSetItemAsync).toHaveBeenCalledWith('jwt_token', 'nouveau.jwt.token');
    expect(mockSetItemAsync).toHaveBeenCalledWith('refresh_token', 'nouveau.refresh.token');
    expect(useAuthStore.getState().token).toBe('nouveau.jwt.token');
  });
});

describe('helpers de role', () => {
  it('estEnseignant() retourne true pour le role enseignant', () => {
    useAuthStore.setState({ session: { ...SESSION_FIXTURE, role: 'enseignant' } });
    expect(useAuthStore.getState().estEnseignant()).toBe(true);
  });

  it('estEnseignant() retourne true pour le role directeur', () => {
    useAuthStore.setState({ session: { ...SESSION_FIXTURE, role: 'directeur' } });
    expect(useAuthStore.getState().estEnseignant()).toBe(true);
  });

  it('estParent() retourne true pour le role parent', () => {
    useAuthStore.setState({ session: { ...SESSION_FIXTURE, role: 'parent' } });
    expect(useAuthStore.getState().estParent()).toBe(true);
  });

  it('estParent() retourne false si pas de session', () => {
    useAuthStore.setState({ session: null });
    expect(useAuthStore.getState().estParent()).toBe(false);
  });
});
