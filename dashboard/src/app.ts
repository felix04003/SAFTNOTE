import { Auth } from './auth';
import { goto } from './router';

document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.requireAuth()) return;

  // Sidebar
  const user = Auth.getUser();
  if (user) {
    const nameEl = document.getElementById('sb-user-nom');
    const roleEl = document.getElementById('sb-user-role');
    const avatEl = document.getElementById('sb-user-avatar');
    const etabEl = document.getElementById('sb-etab-nom');
    if (nameEl) nameEl.textContent = (user.prenom || '') + ' ' + (user.nom || user.nom_complet || '');
    if (roleEl) roleEl.textContent = user.role || '';
    if (avatEl) avatEl.textContent = ((user.prenom || user.nom_complet || '?')[0]).toUpperCase();
    if (etabEl) etabEl.textContent = user.etablissement_nom || '';
  }

  // Logout
  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', (e) => { e.preventDefault(); Auth.logout(); });

  // Hamburger sidebar (mobile)
  const btnMenu   = document.getElementById('btn-menu');
  const sbOverlay = document.getElementById('sb-overlay');
  const sidebar   = document.querySelector('.sidebar');
  btnMenu?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    sbOverlay?.classList.toggle('show');
  });
  sbOverlay?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    sbOverlay?.classList.remove('show');
  });

  // Hash routing au chargement
  const hash = location.hash.replace('#', '');
  goto(hash || 'dashboard');

  // Sync nav-item actif au changement de hash
  window.addEventListener('hashchange', () => {
    const page = location.hash.replace('#', '') || 'dashboard';
    document.querySelectorAll<HTMLElement>('.nav-item').forEach(el => {
      el.classList.toggle('actif', el.dataset.page === page);
    });
  });
});
