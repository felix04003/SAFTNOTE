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
    }).catch(function() {
      // API indisponible — afficher dashboard vide
      _patchStatHome({});
    });
  }

  // Init notifications
  Notifs.init();

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
  } else {
    _initCharts(s);
  }
}

// ── Charts dynamiques ─────────────────────────────────────────────
var _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { try { _charts[id].destroy(); } catch(e) {} delete _charts[id]; }
}

function _initCharts(s) {
  Promise.all([
    Api.get('/annees-scolaires/courante'),
    Api.get('/classes')
  ]).then(function(results) {
    var periodes = (results[0].data && results[0].data.periodes) ? results[0].data.periodes : [];
    var classes  = results[1].data || [];
    if (!classes.length || !periodes.length) return;

    var classeId = classes[0].id;

    Promise.all(periodes.map(function(p) {
      return Api.get('/moyennes/classement/' + classeId + '?periode_id=' + p.id)
        .then(function(r) { return { periode: p, data: r.data }; })
        .catch(function() { return { periode: p, data: null }; });
    })).then(function(classements) {
      var labels = periodes.map(function(p) { return p.libelle || ('T' + p.numero); });
      var moyClasse = classements.map(function(c) {
        return (c.data && c.data.stats && c.data.stats.moyenne_classe)
          ? parseFloat(c.data.stats.moyenne_classe) : null;
      });

      _drawLineMoy(labels, moyClasse);

      var lastData = null;
      for (var i = classements.length - 1; i >= 0; i--) {
        if (classements[i].data && classements[i].data.classement && classements[i].data.classement.length) {
          lastData = classements[i].data;
          break;
        }
      }
      if (lastData) {
        _drawDonut(lastData.classement);
        _drawTopClasses(lastData.classement, lastData.stats);
      }
    }).catch(function() {});
  }).catch(function() {});
}

function _drawLineMoy(labels, moyennes) {
  var canvas = document.getElementById('c-moy');
  if (!canvas || !window.Chart) return;
  _destroyChart('moy');
  _charts['moy'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Moy. classe',
        data: moyennes,
        borderColor: '#2563eb',
        backgroundColor: 'rgba(37,99,235,0.08)',
        borderWidth: 2,
        pointRadius: 4,
        pointBackgroundColor: '#2563eb',
        tension: 0.3,
        fill: true,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 20, ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { color: 'rgba(0,0,0,0.05)' } },
        x: { ticks: { font: { size: 10 }, color: '#94a3b8' }, grid: { display: false } }
      }
    }
  });
}

function _drawDonut(classement) {
  var counts = [0, 0, 0, 0, 0]; // TB, B, AB, P, I
  var total = 0;
  classement.forEach(function(e) {
    if (e.moyenne_generale == null) return;
    total++;
    var m = parseFloat(e.moyenne_generale);
    if (m >= 16)      counts[0]++;
    else if (m >= 14) counts[1]++;
    else if (m >= 12) counts[2]++;
    else if (m >= 10) counts[3]++;
    else              counts[4]++;
  });

  var legendIds = ['donut-tresbien','donut-bien','donut-assezbien','donut-passable','donut-insuff'];
  legendIds.forEach(function(id, i) {
    var el = document.getElementById(id);
    if (el) el.textContent = (total > 0 ? Math.round(counts[i] / total * 100) : 0) + '%';
  });

  var canvas = document.getElementById('c-donut');
  if (!canvas || !window.Chart) return;
  _destroyChart('donut');
  _charts['donut'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Très bien (≥16)', 'Bien (≥14)', 'Assez bien (≥12)', 'Passable (≥10)', 'Insuffisant (<10)'],
      datasets: [{
        data: counts,
        backgroundColor: ['#22c55e','#84cc16','#f59e0b','#f97316','#ef4444'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) {
          return ctx.label + ' : ' + ctx.parsed + ' élève' + (ctx.parsed !== 1 ? 's' : '');
        }}}
      },
      cutout: '70%'
    }
  });
}

function _drawTopClasses(classement, stats) {
  var el = document.getElementById('top-classes');
  if (!el) return;
  var top = classement.slice(0, 5);
  if (!top.length) return;
  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">'
    + '<tr style="color:var(--g400);font-size:11px"><th style="text-align:left;padding:4px 0">Élève</th>'
    + '<th style="text-align:center">Rg</th><th style="text-align:right">Moy.</th></tr>';
  top.forEach(function(e) {
    var moy = e.moyenne_generale != null ? parseFloat(e.moyenne_generale).toFixed(2) : '—';
    var c = parseFloat(moy) >= 14 ? '#22c55e' : parseFloat(moy) >= 10 ? '#f59e0b' : '#ef4444';
    html += '<tr style="border-top:1px solid var(--g100)">'
      + '<td style="padding:5px 0;font-size:11px">' + e.prenom + ' ' + e.nom + '</td>'
      + '<td style="text-align:center;color:var(--g400);font-size:11px">' + (e.rang || '—') + '</td>'
      + '<td style="text-align:right;font-weight:600;color:' + c + '">' + moy + '</td>'
      + '</tr>';
  });
  html += '</table>';
  if (stats && stats.taux_reussite) {
    html += '<div style="margin-top:6px;font-size:11px;color:var(--g400)">Réussite : <strong style="color:var(--vert)">'
      + stats.taux_reussite + '</strong></div>';
  }
  el.innerHTML = html;
}
