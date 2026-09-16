export const CONFIG = {
  API_BASE: 'https://ecolemanager-api.onrender.com/api/v1',
  TOKEN_KEY: 'em_token',
  // Refresh token en sessionStorage (pas localStorage) pour limiter sa
  // persistance : il disparaît à la fermeture de l'onglet, contrairement
  // au JWT (qui reste en localStorage — migration vers sessionStorage
  // traitée séparément au lot H, pas anticipée ici).
  REFRESH_TOKEN_KEY: 'em_refresh_token',
  USER_KEY: 'em_user',
  SESSION_TIMEOUT: 8 * 60 * 60 * 1000,
};

(window as any).CONFIG = CONFIG;
