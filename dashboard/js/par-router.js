'use strict';

var PAR_TITRES = {
  'par-dashboard': 'Tableau de bord',
  'par-notes':     'Notes & résultats',
  'par-absences':  'Absences & retards',
  'par-bulletins': 'Bulletins scolaires',
};

var PAR_HOOKS = {};

function goto(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + id);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('actif', n.dataset.page === id);
  });
  var titreEl = document.getElementById('tb-titre');
  if (titreEl) titreEl.textContent = PAR_TITRES[id] || id;
  history.replaceState(null, '', '#' + id);
  if (PAR_HOOKS[id]) PAR_HOOKS[id]();
}

window.addEventListener('hashchange', function() {
  var id = location.hash.slice(1);
  if (id && PAR_TITRES[id]) goto(id);
});
