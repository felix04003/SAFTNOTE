'use strict';

// ── INIT ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Populate sidebar from auth (if logged in)
  if (Auth.isAuthenticated()) {
    Auth.populateSidebar();
  }

  // Update date in topbar
  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var user = Auth.getUser();
    var now = new Date();
    var opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' \u00B7 ' + dateStr;
  }

  // Pré-charger les classes pour alimenter les dropdowns globaux
  if (Auth.isAuthenticated()) {
    Api.get('/classes').then(function(res) {
      if (res && res.data) PageClasses.peuplerDropdowns(res.data);
    }).catch(function() { /* silencieux */ });
  }

  // Charger les vraies stats dashboard (authentifié) ou demo (non connecté)
  if (Auth.isAuthenticated() && document.getElementById('page-dashboard')) {
    Api.get('/dashboard').then(function(res) {
      var s = res.data || {};
      _patchStatHome(s);
      // N'afficher les charts que si l'école a des données
      if (s.nb_eleves_actifs > 0 || s.nb_classes > 0) {
        initCharts();
        initEDT();
      }
    }).catch(function() {
      // API indisponible — afficher dashboard vide (ne pas injecter données fictives)
      _patchStatHome({});
    });
  } else {
    // Mode démo non connecté — données fictives acceptables
    renderAll();
    initCharts();
    initEDT();
    sparkline('sp-el', [920, 1050, 1100, 1180, 1200, 1248], 'var(--vert)');
    sparkline('sp-en', [56, 58, 60, 61, 61, 64], 'var(--bleu)');
    sparkline('sp-mo', [11.8, 12.1, 12.0, 12.2, 12.3, 12.4], 'var(--orange)');
    sparkline('sp-ab', [64, 58, 72, 80, 75, 87], 'var(--rouge)');
  }

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

// ── Patch stats réelles sur la home dashboard ────────────────────
function _patchStatHome(s) {
  function set(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val != null ? val : '0';
  }

  set('kpi-eleves',      s.nb_eleves_actifs    || 0);
  set('kpi-enseignants', s.nb_enseignants       || 0);
  set('kpi-classes',     s.nb_classes           || 0);
  set('kpi-absences',    s.absences_aujourd_hui || 0);
  var moy = s.moyenne_generale;
  set('kpi-moy', moy != null ? parseFloat(moy).toFixed(1) : '—');

  // Mettre à jour l'année dans la topbar
  var anneeEl = document.getElementById('tb-annee');
  var annee = s.annee_courante || '';
  if (anneeEl) anneeEl.textContent = '📅 ' + (annee || '—');
  set('ph-sous-eleves',      (s.nb_eleves_actifs || 0) + ' élève' + (s.nb_eleves_actifs !== 1 ? 's' : '') + (annee ? ' · ' + annee : ''));
  set('ph-sous-classes',     (s.nb_classes || 0) + ' classe' + (s.nb_classes !== 1 ? 's' : '') + (s.nb_eleves_actifs ? ' · ' + s.nb_eleves_actifs + ' élèves' : ''));
  set('ph-sous-enseignants', (s.nb_enseignants || 0) + ' enseignant' + (s.nb_enseignants !== 1 ? 's' : ''));
  set('ph-sous-bulletins',   annee ? annee : '');

  // Vider l'activité récente (sera peuplée par d'autres hooks si nécessaire)
  var actEl = document.getElementById('activite-recente');
  if (actEl && actEl.children.length === 0) {
    actEl.innerHTML = '<div style="text-align:center;padding:28px 0;color:var(--g400);font-size:12px">Aucune activité récente</div>';
  }

  var vide = !s.nb_eleves_actifs && !s.nb_classes;
  if (vide) {
    var msgVide = '<div style="text-align:center;padding:28px 16px;color:var(--g400)">' +
      '<div style="font-size:28px;margin-bottom:8px">🏫</div>' +
      '<div style="font-size:13px;font-weight:600;color:var(--g500)">Ecole configuree — aucune donnee encore</div>' +
      '<div style="font-size:12px;margin-top:5px">Creez une annee scolaire, des classes et des eleves pour commencer.</div>' +
      '</div>';
    var msgChart = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:140px;color:var(--g300);font-size:13px;font-weight:600">Aucune donnee disponible</div>';
    var msgLigne = '<tr><td colspan="10" style="text-align:center;color:var(--g400);padding:28px">Aucune donnee — ajoutez des eleves, classes, notes pour voir les donnees ici.</td></tr>';

    ['top-classes','taux-presence','cls-abs'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.innerHTML = msgVide;
    });
    ['c-moy','c-donut','c-distrib','c-mat'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) { var p = el.parentNode; p.innerHTML = msgChart; }
    });
    ['tb-eleves','tb-eval','tb-abs','tb-notif','tb-bull','tb-ens','cls-grid'].forEach(function(id) {
      var el = document.getElementById(id); if (el) el.innerHTML = msgLigne;
    });

    // Donut legend à zéro
    ['donut-tresbien','donut-bien','donut-assezbien','donut-passable','donut-insuff'].forEach(function(id) {
      set(id, '0%');
    });

    // Sparklines à zéro
    sparkline('sp-el', [0,0,0,0,0,0], 'var(--vert)');
    sparkline('sp-en', [0,0,0,0,0,0], 'var(--bleu)');
    sparkline('sp-mo', [0,0,0,0,0,0], 'var(--orange)');
    sparkline('sp-ab', [0,0,0,0,0,0], 'var(--rouge)');
  }
}
