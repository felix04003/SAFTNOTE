'use strict';

/**
 * Page Bulletins — charge depuis l'API,
 * fallback sur mock si backend indisponible.
 */
var PageBulletins = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/bulletins/classes');
      this.data = res.data;
      this.renderTable(res.data);
      this.updateKpis(res.data);
      return true;
    } catch (e) {
      console.warn('PageBulletins: fallback mock —', e.message);
      return false;
    }
  },

  updateKpis: function(classes) {
    function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
    var totalEleves = classes.reduce(function(s, c) { return s + parseInt(c.effectif || 0); }, 0);
    var totalGeneres = classes.reduce(function(s, c) { return s + parseInt(c.generes || 0); }, 0);
    var totalValides = classes.reduce(function(s, c) { return s + parseInt(c.valides || 0); }, 0);
    set('bull-kpi-generes',  totalGeneres);
    set('bull-kpi-attente',  totalEleves - totalGeneres);
    set('bull-kpi-valides',  totalValides);
    set('bull-kpi-telecharg', '—');
    // Sous-titre page bulletins
    var sousTitre = document.getElementById('ph-sous-bulletins');
    if (sousTitre && totalEleves) sousTitre.textContent = totalEleves + ' \u00E9l\u00E8ves \u00B7 ' + classes.length + ' classe' + (classes.length > 1 ? 's' : '');
  },

  renderTable: function(bulletins) {
    var tbody = document.getElementById('tb-bull');
    if (!tbody) return;

    if (!bulletins.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun bulletin trouv\u00E9</td></tr>';
      return;
    }

    tbody.innerHTML = bulletins.map(function(b) {
      var moy = b.moyenne_classe != null ? b.moyenne_classe : null;
      var effectif = b.effectif || 0;
      var generes = b.generes || 0;
      var valides = b.valides || 0;
      var taux = b.taux_reussite || '\u2014';

      return '<tr>' +
        '<td class="nc">' + (b.classe || '\u2014') + '</td>' +
        '<td style="font-weight:600">' + effectif + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:7px"><div class="pb" style="width:70px;height:7px"><div class="pf" style="width:' + (effectif ? generes / effectif * 100 : 0) + '%;--c:var(--success)"></div></div><span style="font-weight:600;font-size:11.5px">' + generes + '/' + effectif + '</span></div></td>' +
        '<td><span style="font-weight:600;color:' + (valides === effectif && effectif > 0 ? 'var(--success)' : 'var(--g500)') + '">' + valides + '</span></td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '</span>' : '\u2014') + '</td>' +
        '<td style="font-size:12px">' + (b.premier_classe || '\u2014') + '</td>' +
        '<td><span class="badge ' + (parseFloat(taux) >= 80 ? 'bs' : parseFloat(taux) >= 70 ? 'bw' : 'bd') + '">' + taux + '</span></td>' +
        '<td style="display:flex;gap:5px">' +
          '<button class="btn btn-l btn-sm" onclick="toast(\'Bulletins ' + (b.classe || '') + '\')">Voir</button>' +
          (valides === 0 && generes > 0 ? '<button class="btn btn-p btn-sm" onclick="toast(\'Validation en cours\u2026\',\'s\')">Valider</button>' : '') +
          '<button class="btn btn-l btn-sm">📥</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.bulletins = function() { PageBulletins.init(); };
