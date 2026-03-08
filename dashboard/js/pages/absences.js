'use strict';

/**
 * Page Absences — charge depuis l'API,
 * fallback sur mock si backend indisponible.
 */
var PageAbsences = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/presences/absences');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.warn('PageAbsences: fallback mock —', e.message);
      return false;
    }
  },

  renderTable: function(absences) {
    var tbody = document.getElementById('tb-abs');
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucune absence enregistr\u00E9e</td></tr>';
      return;
    }

    tbody.innerHTML = absences.map(function(a) {
      var type = a.statut || a.type || 'absent';
      var justifie = a.est_justifie;

      return '<tr>' +
        '<td class="nc">' + (a.eleve || (a.prenom || '') + ' ' + (a.nom || '')) + '</td>' +
        '<td><span class="badge bp">' + (a.classe || '\u2014') + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (a.date_cours || a.date || '\u2014') + '</td>' +
        '<td>' + (a.matiere || '\u2014') + '</td>' +
        '<td><span class="badge ' + (type === 'absent' ? 'bd' : 'bw') + '">' + type + '</span></td>' +
        '<td style="text-align:center">' + (a.notifie || (justifie != null ? (justifie ? '\u2705' : '\u274C') : '\u2014')) + '</td>' +
        '<td style="font-size:11.5px;color:var(--g500)">' + (a.justification || '\u2014') + '</td>' +
        '<td><button class="btn btn-l btn-sm" onclick="toast(\'Justification enregistr\u00E9e\',\'s\')">Justifier</button></td>' +
      '</tr>';
    }).join('');
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.absences = function() { PageAbsences.init(); };
