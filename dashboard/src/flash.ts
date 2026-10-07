import { CONFIG } from './config';

// Message laissé par une déconnexion forcée (session fermée : trop d'appareils)
export function afficherMessageFlash(errEl: HTMLElement | null): void {
  try {
    const msg = sessionStorage.getItem(CONFIG.FLASH_KEY);
    if (!msg) return;
    sessionStorage.removeItem(CONFIG.FLASH_KEY);
    if (errEl) { errEl.textContent = msg; errEl.classList.add('show'); }
  } catch { /* stockage indisponible */ }
}
