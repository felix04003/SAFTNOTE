'use strict';

var Auth = {
  async login(identifiant, mot_de_passe, etablissement_code) {
    var res = await Api.post('/auth/connexion', {
      identifiant: identifiant,
      mot_de_passe: mot_de_passe,
      etablissement_code: etablissement_code
    });
    localStorage.setItem(CONFIG.TOKEN_KEY, res.data.token);
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(res.data.utilisateur));
    var role = (res.data.utilisateur && res.data.utilisateur.role) ? res.data.utilisateur.role.toLowerCase() : '';
    window.location.href = (role === 'enseignant') ? 'enseignant.html' : 'index.html';
  },

  async logout() {
    try { await Api.post('/auth/deconnexion'); } catch (e) { /* ignore */ }
    localStorage.removeItem(CONFIG.TOKEN_KEY);
    localStorage.removeItem(CONFIG.USER_KEY);
    window.location.href = 'login.html';
  },

  getUser: function() {
    var u = localStorage.getItem(CONFIG.USER_KEY);
    return u ? JSON.parse(u) : null;
  },

  getToken: function() {
    return localStorage.getItem(CONFIG.TOKEN_KEY);
  },

  isAuthenticated: function() {
    return !!this.getToken();
  },

  requireAuth: function() {
    if (!this.isAuthenticated()) {
      window.location.href = 'login.html';
      return false;
    }
    return true;
  },

  populateSidebar: function() {
    var user = this.getUser();
    if (!user) return;
    var nameEl = document.querySelector('.u-name');
    var roleEl = document.querySelector('.u-role');
    var avatarEl = document.querySelector('.u-avatar');
    var etabEl = document.querySelector('.sb-etab');
    var greetEl = document.getElementById('greeting-name');

    if (nameEl) nameEl.textContent = (user.prenom || '') + ' ' + (user.nom || '');
    if (roleEl) roleEl.textContent = user.role || 'Utilisateur';
    if (avatarEl) avatarEl.textContent = init2((user.prenom || 'U') + ' ' + (user.nom || ''));
    if (etabEl) etabEl.textContent = user.etablissement_nom || 'EcoleManager';
    if (greetEl) greetEl.textContent = 'Bonjour, ' + (user.prenom || 'Utilisateur') + ' \uD83D\uDC4B';
  }
};
