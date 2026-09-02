import { CONFIG } from './config';
import { Api } from './api';

export const Auth = {
  login: async function(identifiant: string, motDePasse: string, codeEtab: string) {
    const res = await Api.post('/auth/connexion', {
      identifiant,
      mot_de_passe: motDePasse,
      code_etablissement: codeEtab,
    });
    const data = res.data || res;
    localStorage.setItem(CONFIG.TOKEN_KEY, data.token || data.access_token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(data.user || data));
    return data;
  },

  logout: function() {
    localStorage.removeItem(CONFIG.TOKEN_KEY);
    localStorage.removeItem(CONFIG.USER_KEY);
    location.href = 'login.html';
  },

  getToken: function(): string | null {
    return localStorage.getItem(CONFIG.TOKEN_KEY);
  },

  getUser: function(): any {
    try { return JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null'); } catch { return null; }
  },

  isAuthenticated: function(): boolean {
    const token = localStorage.getItem(CONFIG.TOKEN_KEY);
    if (!token) return false;
    return !!Auth.getUser();
  },

  requireAuth: function(): boolean {
    if (!Auth.isAuthenticated()) { location.href = 'login.html'; return false; }
    return true;
  },

  populateSidebar: function() {
    const user = Auth.getUser();
    if (!user) return;
    const nameEl = document.getElementById('sb-nom');
    const roleEl = document.getElementById('sb-role');
    const etabEl = document.getElementById('sb-etab');
    if (nameEl) nameEl.textContent = (user.prenom || '') + ' ' + (user.nom || '');
    if (roleEl) roleEl.textContent = user.role || '';
    if (etabEl) etabEl.textContent = user.etablissement_nom || '';
  },
};

(window as any).Auth = Auth;
