import { CONFIG } from './config';
import type { ApiResponse } from './types';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

// Dédoublonne les rafraîchissements concurrents : plusieurs requêtes en 401
// simultanées (widgets du dashboard chargés en parallèle) ne doivent
// déclencher qu'un seul appel POST /auth/refresh — sinon chacune consomme
// une unité du rate limiter dédié à /auth/refresh pour rien, et une requête
// peut échouer à cause de la rotation déclenchée par une autre.
export const MESSAGE_SESSION_REVOQUEE = 'Vous avez été déconnecté : trop d\'appareils connectés avec ce compte.';

let rafraichissementEnCours: Promise<boolean> | null = null;

// Génération de session : change à chaque bascule d'établissement (parent). Une requête lancée avant la bascule
// et terminée après n'est jamais livrée à son appelant (voir request) : sa réponse concerne l'ancienne école et
// ne doit ni s'afficher dans la page remise à zéro, ni déclencher une purge de session sur un 401.
let generationSession = 0;
const jamais = <T>() => new Promise<T>(() => { /* ne se résout ni ne se rejette : l'appelant est abandonné */ });

export const Api = {
  /** À appeler quand la session change d'école : abandonne toutes les requêtes en vol. */
  nouvelleGeneration(): number { return ++generationSession; },
  generation(): number { return generationSession; },

  /**
   * Tente un rafraîchissement du token via POST /auth/refresh, en fetch
   * direct (pas Api.request) pour éviter toute récursion. Persiste le
   * nouveau couple token/refresh_token en cas de succès.
   */
  async tenterRafraichissement(): Promise<boolean> {
    const refreshToken = sessionStorage.getItem(CONFIG.REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    if (!rafraichissementEnCours) {
      rafraichissementEnCours = (async () => {
        try {
          const res = await fetch(CONFIG.API_BASE + '/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });
          if (!res.ok) {
            // Fermée parce que trop d'appareils se sont connectés : on garde
            // le message pour l'expliquer sur la page de connexion.
            try {
              const echec = await res.json();
              if (echec?.code === 'SESSION_REVOQUEE') {
                sessionStorage.setItem(CONFIG.FLASH_KEY, echec.erreur || MESSAGE_SESSION_REVOQUEE);
              }
            } catch { /* corps illisible : échec classique */ }
            return false;
          }

          const data = await res.json();
          const payload = data.data || data;
          if (!payload?.token || !payload?.refresh_token) return false;

          sessionStorage.setItem(CONFIG.TOKEN_KEY, payload.token);
          sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, payload.refresh_token);
          return true;
        } catch {
          return false;
        } finally {
          rafraichissementEnCours = null;
        }
      })();
    }

    return rafraichissementEnCours;
  },

  async request<T = any>(
    method: string,
    path: string,
    body?: any,
    params?: Record<string, any>,
    opts: { dejaRafraichi?: boolean } = {}
  ): Promise<T> {
    const generation = generationSession;
    const token = sessionStorage.getItem(CONFIG.TOKEN_KEY);
    const url = new URL(CONFIG.API_BASE + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v != null) url.searchParams.set(k, String(v));
      });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const fetchOpts: RequestInit = { method, headers };
    if (body != null) fetchOpts.body = JSON.stringify(body);

    const res = await fetch(url.toString(), fetchOpts);
    if (generation !== generationSession) return jamais<T>();   // avant tout : pas de rejeu ni de purge sur une réponse périmée

    if (res.status === 401) {
      // Tenter un refresh une seule fois puis rejouer la requête, sinon
      // conserver le comportement existant (redirection vers login).
      if (!opts.dejaRafraichi) {
        const rafraichi = await Api.tenterRafraichissement();
        if (rafraichi) {
          return Api.request<T>(method, path, body, params, { dejaRafraichi: true });
        }
      }
      // Session définitivement perdue : la purger AVANT de rediriger. Sinon
      // login.html voit un jeton encore présent (mais périmé), croit
      // l'utilisateur connecté et le renvoie ici : boucle de redirections
      // et rafale de requêtes 401 jusqu'au rate limit.
      let ancienRole = '';
      try { ancienRole = (JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null') || {}).role || ''; } catch { /* profil illisible */ }
      sessionStorage.removeItem(CONFIG.TOKEN_KEY);
      sessionStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
      localStorage.removeItem(CONFIG.USER_KEY);
      const isLoginPage = location.pathname.includes('login') || location.pathname.includes('parent-login');
      if (!isLoginPage) location.href = ancienRole.toLowerCase() === 'parent' ? 'parent-login.html' : 'login.html';
      throw new ApiError('Non autorisé', 'UNAUTHORIZED', 401);
    }

    const data = await res.json();
    if (generation !== generationSession) return jamais<T>();

    // Mot de passe provisoire : le serveur refuse tout sauf le changement.
    if (res.status === 403 && data.code === 'MDP_CHANGEMENT_REQUIS') {
      if (!location.pathname.includes('changer-mot-de-passe')) {
        location.href = 'changer-mot-de-passe.html';
      }
    }

    if (!res.ok) {
      throw new ApiError(
        // L'API renvoie le message dans `erreur` (français) ; `error`/`message`
        // gardés en repli. Sans `erreur`, tous les messages précis du serveur
        // (doublons, politique de mot de passe…) s'affichaient « Erreur serveur ».
        data.erreur || data.error || data.message || 'Erreur serveur',
        data.code || 'SERVER_ERROR',
        res.status
      );
    }
    return data;
  },

  get<T = any>(path: string, params?: Record<string, any>): Promise<ApiResponse<T>> {
    return Api.request<ApiResponse<T>>('GET', path, undefined, params);
  },
  post<T = any>(path: string, body: any): Promise<ApiResponse<T>> {
    return Api.request<ApiResponse<T>>('POST', path, body);
  },
  put<T = any>(path: string, body: any): Promise<ApiResponse<T>> {
    return Api.request<ApiResponse<T>>('PUT', path, body);
  },
  del<T = any>(path: string): Promise<ApiResponse<T>> {
    return Api.request<ApiResponse<T>>('DELETE', path);
  },
};

(window as any).ApiError = ApiError;
(window as any).Api = Api;
