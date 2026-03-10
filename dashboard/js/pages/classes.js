'use strict';

/**
 * Page Classes — charge les données depuis l'API,
 * fallback sur les données mock si le backend est indisponible.
 */
var PageClasses = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/classes');
      this.data = res.data;
      this.renderGrid(res.data);
      this.peuplerDropdowns(res.data);
      return true;
    } catch (e) {
      console.warn('PageClasses: fallback mock —', e.message);
      return false;
    }
  },

  peuplerDropdowns: function(classes) {
    // Peupler tous les selects de filtre par classe dans l'application
    var selects = [
      document.getElementById('sel-classe-eleves'),
      document.getElementById('sel-classe-edt'),
      document.getElementById('modal-eleve-classe'),
    ];
    selects.forEach(function(sel) {
      if (!sel) return;
      var valActuelle = sel.value;
      // Conserver uniquement la 1re option (Toutes classes / Choisir...)
      while (sel.options.length > 1) sel.remove(1);
      classes.forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.nom_classe || c.nom || c.id;
        sel.appendChild(opt);
      });
      if (valActuelle) sel.value = valActuelle;
    });
  },

  renderGrid: function(classes) {
    var grid = document.getElementById('cls-grid');
    if (!grid) return;

    if (!classes.length) {
      grid.innerHTML = '<div style="text-align:center;color:var(--g400);padding:40px;grid-column:1/-1">Aucune classe trouvée</div>';
      return;
    }

    grid.innerHTML = classes.map(function(c) {
      var nom = c.nom_classe || c.nom || '—';
      var effectif = c.effectif || c.effectif_max || 0;
      var moy = c.moyenne != null ? c.moyenne : null;
      var pres = c.taux_presence != null ? c.taux_presence : null;
      var serie = c.serie || c.salle_principale || '';

      return '<div class="carte" style="cursor:pointer;transition:transform .15s" onmouseenter="this.style.transform=\'translateY(-3px)\'" onmouseleave="this.style.transform=\'\'">' +
        '<div style="padding:16px 18px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px">' +
            '<div><div style="font-size:17px;font-weight:800">' + nom + '</div><div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + serie + (effectif ? ' \u00B7 ' + effectif + ' \u00E9l\u00E8ves' : '') + '</div></div>' +
            (moy != null ? '<div class="nb" style="color:' + cn(moy) + ';font-size:12px;width:38px;height:38px">' + moy + '</div>' : '') +
          '</div>' +
          (pres != null ?
            '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">' +
              '<span style="color:var(--g500)">Pr\u00E9sence</span>' +
              '<span style="font-weight:700;color:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '">' + pres + '%</span>' +
            '</div>' +
            '<div class="pb"><div class="pf" style="width:' + pres + '%;--c:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '"></div></div>' : '') +
          '<div style="display:flex;gap:6px;margin-top:12px">' +
            '<button class="btn btn-l btn-sm" style="flex:1" onclick="PageClasses.voirClasse(\'' + c.id + '\')">Voir</button>' +
            '<button class="btn btn-l btn-sm" onclick="goto(\'edt\')">📅</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  voirClasse: function(id) {
    toast('D\u00E9tail classe \u2014 fonctionnalit\u00E9 \u00E0 venir');
  },

  init: function() {
    this.charger();
  }
};

// Hook dans le routeur
PAGE_HOOKS.classes = function() { PageClasses.init(); };
