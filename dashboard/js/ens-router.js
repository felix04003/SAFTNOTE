'use strict';

var ENS_TITRES = {
  'ens-dashboard':  'Mon tableau de bord',
  'ens-classes':    'Mes classes',
  'ens-notes':      'Mes notes & évaluations',
  'ens-appel':      'Faire l\'appel',
  'ens-edt':        'Mon emploi du temps',
  'ens-discipline': 'Discipline',
};

var PAGE_HOOKS = {};

function goto(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + id);
  if (pageEl) pageEl.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.toggle('actif', n.dataset.page === id);
  });
  var titreEl = document.getElementById('tb-titre');
  if (titreEl) titreEl.textContent = ENS_TITRES[id] || id;
  history.replaceState(null, '', '#' + id);
  if (PAGE_HOOKS[id]) PAGE_HOOKS[id]();
}

window.addEventListener('hashchange', function() {
  var id = location.hash.slice(1);
  if (id && ENS_TITRES[id]) goto(id);
});
