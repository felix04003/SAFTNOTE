'use strict';

function ApiError(message, code, status) {
  this.message = message;
  this.code = code;
  this.status = status;
}

var Api = {
  async request(method, path, body, params) {
    var token = localStorage.getItem(CONFIG.TOKEN_KEY);
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    var url = CONFIG.API_BASE + path;
    if (params) {
      var qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    }

    var opts = { method: method, headers: headers };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);

    var response;
    try {
      response = await fetch(url, opts);
    } catch (e) {
      throw new ApiError('Connexion au serveur impossible', 'NETWORK_ERROR', 0);
    }

    // 401 — token expired or invalid
    if (response.status === 401) {
      // Si on est déjà sur la page login, laisser l'erreur remonter normalement
      if (!window.location.pathname.includes('login')) {
        localStorage.removeItem(CONFIG.TOKEN_KEY);
        localStorage.removeItem(CONFIG.USER_KEY);
        window.location.href = 'login.html';
        return;
      }
      // On login.html: parse the error and throw (don't redirect/reload)
      var errJson401;
      try { errJson401 = await response.json(); } catch(e) { /* ignore */ }
      throw new ApiError(
        (errJson401 && errJson401.erreur) || 'Identifiants incorrects',
        (errJson401 && errJson401.code)   || 'AUTH_FAILED',
        401
      );
    }

    // 204 No Content
    if (response.status === 204) return { succes: true, data: null };

    var json;
    try {
      json = await response.json();
    } catch (e) {
      throw new ApiError('Reponse serveur invalide', 'PARSE_ERROR', response.status);
    }

    if (!json.succes) {
      throw new ApiError(json.erreur || 'Erreur inconnue', json.code || 'UNKNOWN', response.status);
    }

    return json;
  },

  get: function(path, params) { return this.request('GET', path, null, params); },
  post: function(path, body) { return this.request('POST', path, body); },
  put: function(path, body) { return this.request('PUT', path, body); },
  del: function(path) { return this.request('DELETE', path); },
};
