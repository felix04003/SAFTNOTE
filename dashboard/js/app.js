'use strict';

// ── INIT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Populate sidebar from auth (if logged in)
  if (Auth.isAuthenticated()) {
    Auth.populateSidebar();
  }

  // Update date in topbar
  var dateEl = document.querySelector('.ph-sous');
  if (dateEl && document.getElementById('page-dashboard')) {
    var user = Auth.getUser();
    var now = new Date();
    var opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' \u00B7 ' + dateStr;
  }

  // Render all mock data
  renderAll();
  initCharts();
  initEDT();

  // Sparklines
  sparkline('sp-el', [920, 1050, 1100, 1180, 1200, 1248], 'var(--vert)');
  sparkline('sp-en', [56, 58, 60, 61, 61, 64], 'var(--bleu)');
  sparkline('sp-mo', [11.8, 12.1, 12.0, 12.2, 12.3, 12.4], 'var(--orange)');
  sparkline('sp-ab', [64, 58, 72, 80, 75, 87], 'var(--rouge)');

  // Handle initial hash route
  var hash = location.hash.slice(1);
  if (hash && TITRES[hash]) {
    goto(hash);
  }

  // Wire logout button
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function(e) {
      e.preventDefault();
      Auth.logout();
    });
  }
});
