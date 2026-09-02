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

export const Api = {
  async request<T = any>(method: string, path: string, body?: any, params?: Record<string, any>): Promise<T> {
    const token = localStorage.getItem(CONFIG.TOKEN_KEY);
    const url = new URL(CONFIG.API_BASE + path);
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v != null) url.searchParams.set(k, String(v));
      });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const opts: RequestInit = { method, headers };
    if (body != null) opts.body = JSON.stringify(body);

    const res = await fetch(url.toString(), opts);

    if (res.status === 401) {
      const isLoginPage = location.pathname.includes('login') || location.pathname.includes('parent-login');
      if (!isLoginPage) location.href = 'login.html';
      throw new ApiError('Non autorisé', 'UNAUTHORIZED', 401);
    }

    const data = await res.json();
    if (!res.ok) {
      throw new ApiError(
        data.error || data.message || 'Erreur serveur',
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
