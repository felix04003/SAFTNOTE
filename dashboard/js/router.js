'use strict';

var TITRES = {
  dashboard: 'Tableau de bord',
  eleves: '\u00C9l\u00E8ves',
  enseignants: 'Enseignants',
  classes: 'Classes',
  notes: 'Notes & \u00C9valuations',
  bulletins: 'Bulletins',
  absences: 'Absences & Pr\u00E9sences',
  edt: 'Emploi du temps',
  alertes: 'Alertes',
  parametres: 'Param\u00E8tres'
};

// Page enter callbacks — pages register themselves here
var PAGE_HOOKS = {};

function goto(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + id);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('actif', n.dataset.page === id);
  });
  document.getElementById('tb-titre').textContent = TITRES[id] || id;

  // Update hash without triggering hashchange
  history.replaceState(null, '', '#' + id);

  // Call page hook if registered
  if (PAGE_HOOKS[id]) PAGE_HOOKS[id]();
}

// Handle browser back/forward with hash
window.addEventListener('hashchange', function() {
  var id = location.hash.slice(1);
  if (id && TITRES[id]) goto(id);
});
