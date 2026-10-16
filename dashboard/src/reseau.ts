// Bandeau « Pas de connexion » (C8) : le web ne fonctionne qu'en ligne, seul
// le mobile garde l'appel et les notes hors connexion puis les synchronise.
// Les boutons marqués data-requiert-reseau sont neutralisés (classe CSS +
// aria-disabled) tant que le navigateur se déclare hors ligne ; on ne touche
// pas à `disabled`, que les pages réécrivent elles-mêmes.

export const MESSAGE_HORS_LIGNE =
  "Pas de connexion : l'appel et les notes ne peuvent pas être enregistrés depuis le web. " +
  "Utilisez l'application mobile (mode hors ligne).";

export function appliquerEtatReseau(enLigne: boolean = navigator.onLine): void {
  document.body.classList.toggle('hors-ligne', !enLigne);

  let bandeau = document.getElementById('bandeau-hors-ligne');
  if (!enLigne && !bandeau) {
    bandeau = document.createElement('div');
    bandeau.id = 'bandeau-hors-ligne';
    bandeau.setAttribute('role', 'alert');
    bandeau.textContent = MESSAGE_HORS_LIGNE;
    document.body.insertBefore(bandeau, document.body.firstChild);
  } else if (enLigne && bandeau) {
    bandeau.remove();
  }

  document.querySelectorAll('[data-requiert-reseau]').forEach((el) => {
    if (enLigne) el.removeAttribute('aria-disabled');
    else el.setAttribute('aria-disabled', 'true');
  });
}

export function initReseau(): void {
  appliquerEtatReseau();
  window.addEventListener('online', () => appliquerEtatReseau(true));
  window.addEventListener('offline', () => appliquerEtatReseau(false));
}

document.addEventListener('DOMContentLoaded', initReseau);
