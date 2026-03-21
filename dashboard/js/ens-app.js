'use strict';

document.addEventListener('DOMContentLoaded', function() {
  // Vérifier l'authentification
  if (!Auth.requireAuth()) return;

  // Vérifier que l'utilisateur est bien un enseignant
  var user = Auth.getUser();
  var role = (user && user.role) ? user.role.toLowerCase() : '';
  if (role !== 'enseignant') {
    window.location.href = 'index.html';
    return;
  }

  // Peupler la sidebar avec le nom/rôle de l'enseignant
  Auth.populateSidebar();

  // Date dans la topbar
  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var now = new Date();
    var opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var user = Auth.getUser();
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' · ' + dateStr;
  }

  // Bouton déconnexion
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      Auth.logout();
    });
  }

  // Routing hash initial
  var hash = location.hash.slice(1);
  if (hash && ENS_TITRES[hash]) {
    goto(hash);
  } else {
    goto('ens-dashboard');
  }
});
