export const CONFIG = {
  API_BASE: 'https://ecolemanager-api.onrender.com/api/v1',
  TOKEN_KEY: 'em_token',
  USER_KEY: 'em_user',
  SESSION_TIMEOUT: 8 * 60 * 60 * 1000,
};

(window as any).CONFIG = CONFIG;
