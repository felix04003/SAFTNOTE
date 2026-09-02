import { Auth } from './auth';
import { Notifs } from './notifs';
import { ENS_TITRES, goto } from './ens-router';

document.addEventListener('DOMContentLoaded', function() {
  if (!Auth.requireAuth()) return;
  var user = Auth.getUser();
  var role = (user && user.role) ? user.role.toLowerCase() : '';
  if (role !== 'enseignant') {
    window.location.href = 'index.html';
    return;
  }
  Auth.populateSidebar();
  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var now = new Date();
    var opts: any = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    user = Auth.getUser();
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' · ' + dateStr;
  }
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      Auth.logout();
    });
  }
  Notifs.init();
  var hash = location.hash.slice(1);
  if (hash && ENS_TITRES[hash]) {
    goto(hash);
  } else {
    goto('ens-dashboard');
  }
});
