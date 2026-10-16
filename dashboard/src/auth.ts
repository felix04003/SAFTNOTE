import { CONFIG } from './config';
import { Api } from './api';

export const Auth = {
  login: async function(identifiant: string, motDePasse: string, codeEtab: string) {
    const res = await Api.post('/auth/connexion', {
      identifiant,
      mot_de_passe: motDePasse,
      etablissement_code: codeEtab,
    });
    const data = res.data || res;
    sessionStorage.setItem(CONFIG.TOKEN_KEY, data.token || data.access_token);
    // USER_KEY (localStorage) ne doit contenir QUE le profil : l'API renvoie
    // { token, refresh_token, utilisateur }, et stocker la réponse entière
    // remettait le JWT en localStorage, annulant la migration vers
    // sessionStorage (lot H).
    const { token: _t, access_token: _a, refresh_token: _r, ...profil } = data;
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(data.utilisateur || data.user || profil));
    if (data.refresh_token) sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, data.refresh_token);
    return data;
  },

  /** Page à ouvrir après connexion : changement de mot de passe obligatoire d'abord, sinon selon le rôle. */
  destination: function(user: any): string {
    if (user && user.doit_changer_mdp) return 'changer-mot-de-passe.html';
    const role = ((user && user.role) || '').toLowerCase();
    if (role === 'enseignant') return 'enseignant.html';
    if (role === 'parent') return 'parent.html';
    return 'index.html';
  },

  /** Met à jour le profil stocké (ex. après le changement de mot de passe obligatoire). */
  majUser: function(changes: Record<string, any>) {
    const user = Auth.getUser() || {};
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify({ ...user, ...changes }));
  },

  logout: function() {
    sessionStorage.removeItem(CONFIG.TOKEN_KEY);
    localStorage.removeItem(CONFIG.USER_KEY);
    sessionStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
    location.href = 'login.html';
  },

  getToken: function(): string | null {
    return sessionStorage.getItem(CONFIG.TOKEN_KEY);
  },

  getUser: function(): any {
    try { return JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null'); } catch { return null; }
  },

  isAuthenticated: function(): boolean {
    const token = sessionStorage.getItem(CONFIG.TOKEN_KEY);
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
    // Mêmes identifiants et même rendu que app.ts et par-app.ts
    const nameEl = document.getElementById('sb-user-nom');
    const roleEl = document.getElementById('sb-user-role');
    const avatEl = document.getElementById('sb-user-avatar');
    const etabEl = document.getElementById('sb-etab-nom');
    if (nameEl) nameEl.textContent = (user.prenom || '') + ' ' + (user.nom || user.nom_complet || '');
    if (roleEl) roleEl.textContent = user.role || '';
    if (avatEl) avatEl.textContent = ((user.prenom || user.nom_complet || '?')[0]).toUpperCase();
    if (etabEl) etabEl.textContent = user.etablissement_nom || '';
  },
};

(window as any).Auth = Auth;
