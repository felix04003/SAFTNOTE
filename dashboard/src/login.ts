import { Auth } from './auth';

// Redirect if already logged in
if (Auth.isAuthenticated()) {
  window.location.href = Auth.destination(Auth.getUser());
}

// Bouton afficher/masquer le mot de passe (audit sécurité 2026-09).
// Icône SVG fixe (oeil ouvert) dans le HTML — on ne change que le type de
// l'input et l'état aria-pressed, pas le SVG, pour rester simple et éviter
// tout innerHTML dynamique (CSP script-src 'self', pas d'inline).
function initTogglesMotDePasse() {
  document.querySelectorAll('.pwd-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wrap  = btn.closest('.pwd-wrap');
      const input = wrap?.querySelector('input') as HTMLInputElement | null;
      if (!input) return;
      const masque = input.type === 'password';
      input.type = masque ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(masque));
      btn.setAttribute('aria-label', masque ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    });
  });
}

async function handleLogin(e: Event) {
  e.preventDefault();
  const btn   = document.getElementById('login-btn') as HTMLButtonElement | null;
  const errEl = document.getElementById('login-err') as HTMLElement | null;
  const identifiant        = (document.getElementById('login-id')   as HTMLInputElement).value.trim();
  const mot_de_passe       = (document.getElementById('login-pwd')  as HTMLInputElement).value;
  const etablissement_code = (document.getElementById('login-etab') as HTMLInputElement).value.trim();

  if (btn) { btn.disabled = true; btn.textContent = 'Connexion en cours…'; }
  if (errEl) errEl.classList.remove('show');

  try {
    const data = await Auth.login(identifiant, mot_de_passe, etablissement_code);
    window.location.href = Auth.destination(data.utilisateur);
  } catch (err: any) {
    if (errEl) { errEl.textContent = err.message || 'Identifiants incorrects'; errEl.classList.add('show'); }
    if (btn) { btn.disabled = false; btn.textContent = 'Se connecter'; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initTogglesMotDePasse();
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
});
