export const CONFIG = {
  // Configurable via la variable d'environnement Vite VITE_API_BASE
  // (voir dashboard/.env.example) ; conserve l'URL de prod actuelle en
  // repli pour ne pas casser le comportement existant si la variable
  // n'est pas définie (build local, tests, déploiements existants).
  API_BASE: import.meta.env.VITE_API_BASE ?? 'https://ecolemanager-api.onrender.com/api/v1',
  // JWT et refresh token en sessionStorage (pas localStorage) pour limiter
  // leur persistance : ils disparaissent à la fermeture de l'onglet. Le
  // SESSION_TIMEOUT (8h) reste pertinent pour une session ouverte plus de
  // 8h dans le même onglet — sessionStorage seul ne couvre pas ce cas.
  TOKEN_KEY: 'em_token',
  REFRESH_TOKEN_KEY: 'em_refresh_token',
  USER_KEY: 'em_user',
  SESSION_TIMEOUT: 8 * 60 * 60 * 1000,
};

(window as any).CONFIG = CONFIG;
