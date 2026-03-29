'use strict';

var PageParDashboard = {

  init: async function() {
    var user = Auth.getUser();
    var greet = document.getElementById('par-greeting');
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : '') + ' 👋';

    var enfant = ParApp.enfantLien();
    var nomEnfant = (enfant.prenom || '') + ' ' + (enfant.nom || '');

    try {
      var res = await Api.get('/parents/moi/tableau-de-bord');
      var tdb = (res.data || []).find(function(e) {
        return e.enfant && e.enfant.id === ParApp.enfantId();
      });

      if (!tdb) {
        PageParDashboard._vide();
        return;
      }

      // KPI
      var moy = tdb.moyenne_generale;
      _parSet('par-kpi-moy',     moy ? moy.moyenne_generale : '—');
      _parSet('par-kpi-mention', moy ? (moy.mention || '—')  : '—');

      var abs = tdb.absences || {};
      var totalAbs = (abs.justifiees || 0) + (abs.injustifiees || 0);
      _parSet('par-kpi-abs', totalAbs);

      // Dernières notes
      PageParDashboard._renderDernieresNotes(tdb.dernieres_notes || [], nomEnfant, enfant.peut_voir_notes);

      // Recap absences
      PageParDashboard._renderRecapAbsences(abs, enfant.peut_voir_absences);

    } catch (e) {
      _parSet('par-kpi-moy', '—');
      _parSet('par-kpi-abs', '—');
      _parSet('par-kpi-mention', '—');
    }
  },

  _vide: function() {
    _parSet('par-kpi-moy', '—');
    _parSet('par-kpi-abs', '—');
    _parSet('par-kpi-mention', '—');
    var el = document.getElementById('par-dernieres-notes');
    if (el) el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune donnée disponible</div>';
  },

  _renderDernieresNotes: function(notes, nomEnfant, peutVoir) {
    var el = document.getElementById('par-dernieres-notes');
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux notes non autorisé</div>';
      return;
    }
    if (!notes.length) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune note publiée</div>';
      return;
    }

    el.innerHTML = notes.map(function(n) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
        '<div>' +
          '<div style="font-weight:600;font-size:13px">' + (n.matiere || '—') + '</div>' +
          '<div style="font-size:11.5px;color:var(--g400)">' + (n.type || '') + ' · ' + (n.date_evaluation || '') + '</div>' +
        '</div>' +
        '<span style="font-weight:800;font-size:15px;color:' + _parCn(n.valeur) + '">' + (n.valeur != null ? n.valeur : '—') + '/20</span>' +
      '</div>';
    }).join('');
  },

  _renderRecapAbsences: function(abs, peutVoir) {
    var el = document.getElementById('par-recap-absences');
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux absences non autorisé</div>';
      return;
    }

    var just   = abs.justifiees    || 0;
    var injust = abs.injustifiees  || 0;
    var retard = abs.retards       || 0;

    el.innerHTML =
      '<div style="display:flex;gap:12px;padding:12px 0">' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Injustifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--g500)">' + just + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Justifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--bleu)">' + retard + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Retards</div>' +
        '</div>' +
      '</div>';
  },
};

function _parSet(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = (val != null) ? val : '—';
}

function _parCn(val) {
  if (val == null) return 'var(--g500)';
  if (val >= 14)  return 'var(--vert)';
  if (val >= 10)  return 'var(--orange)';
  return 'var(--rouge)';
}

PAR_HOOKS['par-dashboard'] = function() { PageParDashboard.init(); };
