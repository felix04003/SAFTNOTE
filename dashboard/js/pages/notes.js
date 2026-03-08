'use strict';

/**
 * Page Notes & Évaluations — charge depuis l'API,
 * fallback sur mock si backend indisponible.
 */
var PageNotes = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/evaluations');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.warn('PageNotes: fallback mock —', e.message);
      return false;
    }
  },

  renderTable: function(evals) {
    var tbody = document.getElementById('tb-eval');
    if (!tbody) return;

    if (!evals.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--g400);padding:30px">Aucune \u00E9valuation trouv\u00E9e</td></tr>';
      return;
    }

    tbody.innerHTML = evals.map(function(ev) {
      var moy = ev.moyenne_classe != null ? ev.moyenne_classe : null;
      var st = ev.statut || 'brouillon';

      return '<tr>' +
        '<td class="nc">' + (ev.matiere || '\u2014') + '</td>' +
        '<td><span class="badge bp">' + (ev.classe || '\u2014') + '</span></td>' +
        '<td><span class="badge bo">' + (ev.type || '\u2014') + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (ev.date || '\u2014') + '</td>' +
        '<td>' + (ev.enseignant || '\u2014') + '</td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bd">Non saisi</span>') + '</td>' +
        '<td style="color:var(--g400)">' + (ev.note_min != null ? ev.note_min : '\u2014') + '</td>' +
        '<td style="color:var(--g400)">' + (ev.note_max != null ? ev.note_max : '\u2014') + '</td>' +
        '<td><span class="badge ' + (st === 'publi\u00E9e' ? 'bs' : st === 'brouillon' ? 'bw' : 'bd') + '">' + st + '</span></td>' +
      '</tr>';
    }).join('');
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.notes = function() { PageNotes.init(); };
