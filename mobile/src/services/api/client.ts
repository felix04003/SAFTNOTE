// src/services/api/client.ts
// Client HTTP avec gestion du JWT, retry et détection hors ligne

import * as Network from 'expo-network';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.ecolemanager.io/api/v1';

// Event emitter minimaliste pour la déconnexion forcée
class EventEmitter {
  private listeners: Record<string, Function[]> = {};
  on(event: string, fn: Function) {
    this.listeners[event] = [...(this.listeners[event] || []), fn];
    return () => { this.listeners[event] = (this.listeners[event] || []).filter(f => f !== fn); };
  }
  emit(event: string, ...args: any[]) {
    (this.listeners[event] || []).forEach(fn => fn(...args));
  }
}
export const authEventEmitter = new EventEmitter();

// ── Classe ApiClient ─────────────────────────────────────────────
class ApiClient {
  private token: string | null = null;
  private refreshToken: string | null = null;
  // Dédoublonne les rafraîchissements concurrents (plusieurs requêtes en
  // 401 en même temps ne doivent déclencher qu'un seul appel /auth/refresh).
  private rafraichissementEnCours: Promise<boolean> | null = null;

  setToken(t: string | null) { this.token = t; }
  setRefreshToken(t: string | null) { this.refreshToken = t; }

  async estConnecte(): Promise<boolean> {
    const state = await Network.getNetworkStateAsync();
    return !!state.isConnected && !!state.isInternetReachable;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  /**
   * Tente un rafraîchissement du token via POST /auth/refresh.
   * Utilise fetch() directement (pas this.request) pour éviter toute
   * récursion. En cas de succès, met à jour le token/refresh_token en
   * mémoire et émet 'token_rafraichi' pour que authStore les persiste.
   */
  private async tenterRafraichissement(): Promise<boolean> {
    if (!this.refreshToken) return false;

    if (!this.rafraichissementEnCours) {
      this.rafraichissementEnCours = (async () => {
        try {
          const response = await fetch(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: this.refreshToken }),
          });

          if (!response.ok) return false;

          const data = await response.json();
          const payload = data.data ?? data;
          if (!payload?.token || !payload?.refresh_token) return false;

          this.setToken(payload.token);
          this.setRefreshToken(payload.refresh_token);
          authEventEmitter.emit('token_rafraichi', { token: payload.token, refresh_token: payload.refresh_token });
          return true;
        } catch {
          return false;
        } finally {
          this.rafraichissementEnCours = null;
        }
      })();
    }

    return this.rafraichissementEnCours;
  }

  async request<T = any>(
    method: string,
    path: string,
    body?: object,
    opts: { tentatives?: number; _dejaRafraichi?: boolean } = {}
  ): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const tentativesMax = opts.tentatives ?? 2;

    for (let tentative = 1; tentative <= tentativesMax; tentative++) {
      try {
        const response = await fetch(url, {
          method,
          headers: this.headers(),
          ...(body ? { body: JSON.stringify(body) } : {}),
        });

        // Token expiré ou révoqué : tenter un refresh une seule fois puis
        // rejouer la requête d'origine, sinon forcer la déconnexion.
        if (response.status === 401) {
          if (!opts._dejaRafraichi) {
            const rafraichi = await this.tenterRafraichissement();
            if (rafraichi) {
              return this.request<T>(method, path, body, { ...opts, _dejaRafraichi: true });
            }
          }
          authEventEmitter.emit('deconnexion');
          throw new ApiError(401, 'Session expirée — reconnectez-vous', 'SESSION_EXPIREE');
        }

        const data = await response.json();

        if (!response.ok) {
          throw new ApiError(response.status, data.erreur || 'Erreur serveur', data.code || 'ERREUR');
        }

        return data.data ?? data;

      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Erreur réseau : retry
        if (tentative === tentativesMax) {
          throw new ApiError(0, 'Pas de connexion internet', 'HORS_LIGNE');
        }
        await sleep(500 * tentative);
      }
    }
    throw new ApiError(0, 'Erreur inconnue', 'ERREUR');
  }

  get<T>(path: string)           { return this.request<T>('GET', path); }
  post<T>(path: string, body: object) { return this.request<T>('POST', path, body); }
  put<T>(path: string, body: object)  { return this.request<T>('PUT', path, body); }
  delete<T>(path: string)        { return this.request<T>('DELETE', path); }
}

export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public code: string) {
    super(message);
    this.name = 'ApiError';
  }
  get estHorsLigne() { return this.statusCode === 0; }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export const api = new ApiClient();

// ── Endpoints Auth ───────────────────────────────────────────────
export const authApi = {
  connexion: (data: { identifiant: string; mot_de_passe: string; etablissement_code: string }) =>
    api.post('/auth/connexion', data),

  demanderOTP: (data: { telephone: string; etablissement_code: string }) =>
    api.post('/auth/otp/demander', data),

  validerOTP: (data: { telephone: string; code: string; etablissement_code: string }) =>
    api.post('/auth/otp/valider', data),

  deconnexion: () =>
    api.post('/auth/deconnexion', {}),
};

// ── Endpoints Enseignant ─────────────────────────────────────────
export const enseignantApi = {
  // Élèves d'une classe
  getElevesClasse: (classeId: string) =>
    api.get(`/classes/${classeId}/eleves`),

  // Évaluations
  getEvaluations: (classeId: string, periodeId?: string) =>
    api.get(`/evaluations?classe_id=${classeId}${periodeId ? `&periode_id=${periodeId}` : ''}`),

  getNotesEvaluation: (evaluationId: string) =>
    api.get(`/evaluations/${evaluationId}/notes`),

  saisirNotes: (evaluationId: string, notes: any[]) =>
    api.put(`/evaluations/${evaluationId}/notes`, { notes }),

  // Appels
  ouvrirAppel: (data: { emploi_du_temps_id: string; date_cours: string }) =>
    api.post('/appels', data),

  getCoursAppel: (emploiDuTempsId: string, dateCours: string) =>
    api.get(`/appels/cours?emploi_du_temps_id=${emploiDuTempsId}&date_cours=${dateCours}`),

  saisirPresences: (appelId: string, presences: any[], cloturer = true) =>
    api.put(`/appels/${appelId}/presences`, { presences, cloturer }),
};

// ── Endpoints Sync ───────────────────────────────────────────────
export const syncApi = {
  telecharger: (depuis?: string) =>
    api.get(`/sync${depuis ? `?depuis=${encodeURIComponent(depuis)}` : ''}`),

  envoyer: (operations: any[]) =>
    api.post('/sync/operations', { operations }),
};

// ── Endpoints Directeur ──────────────────────────────────────────
export const directeurApi = {
  getDashboard: () =>
    api.get('/dashboard'),
};

// ── Endpoints Parent ─────────────────────────────────────────────
export const parentApi = {
  getTableauDeBord: (eleveId: string) =>
    api.get(`/eleves/${eleveId}/tableau-de-bord`),

  getAbsences: (eleveId: string, depuis?: string) =>
    api.get(`/eleves/${eleveId}/absences${depuis ? `?depuis=${depuis}` : ''}`),

  getNotes: (eleveId: string, periodeId?: string) =>
    api.get(`/eleves/${eleveId}/notes${periodeId ? `?periode_id=${periodeId}` : ''}`),
};
