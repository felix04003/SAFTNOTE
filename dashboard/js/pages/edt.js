'use strict';

/**
 * Page Emploi du temps — charge depuis l'API,
 * fallback sur mock (initEDT) si backend indisponible.
 */
var PageEDT = {
  data: null,

  async charger() {
    try {
      var res = await Api.get('/enseignants/moi/edt');
      this.data = res.data;
      this.renderGrid(res.data);
      return true;
    } catch (e) {
      console.warn('PageEDT: fallback mock —', e.message);
      // Le mock initEDT() est déjà appelé au chargement initial
      return false;
    }
  },

  renderGrid: function(data) {
    if (!data || !data.emploi_du_temps) return;

    var grid = document.getElementById('edt-grid');
    if (!grid) return;
    grid.className = 'edt-grid';

    var jours = [''].concat(data.emploi_du_temps.map(function(j) { return j.nom; }));
    grid.innerHTML = jours.map(function(j) {
      return '<div class="edt-h">' + j + '</div>';
    }).join('');

    // Collecter toutes les plages horaires uniques
    var plages = {};
    data.emploi_du_temps.forEach(function(jour) {
      (jour.creneaux || []).forEach(function(c) {
        var key = c.heure_debut + '-' + c.heure_fin;
        plages[key] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
      });
    });

    var plagesArr = Object.values(plages).sort(function(a, b) { return a.numero - b.numero; });
    var cmat = {
      'Math\u00E9matiques': '#1A5276', 'Physique': '#7D3C98', 'SVT': '#1E8449',
      'Fran\u00E7ais': '#B7950B', 'Anglais': '#1B4F72', 'Philo': '#6C3483',
      'Histoire-G\u00E9o': '#935116', 'EPS': '#1A6B3A'
    };

    plagesArr.forEach(function(plage) {
      grid.innerHTML += '<div class="edt-t">' + plage.debut + '</div>';
      data.emploi_du_temps.forEach(function(jour) {
        var creneau = (jour.creneaux || []).find(function(c) {
          return c.heure_debut === plage.debut;
        });
        if (creneau && !creneau.est_pause) {
          var mat = creneau.matiere || '';
          var col = cmat[mat] || '#1A4731';
          grid.innerHTML += '<div class="edt-slot" style="background:' + col + '14;border-left:3px solid ' + col + '">' +
            '<div class="edt-sm" style="color:' + col + '">' + mat + '</div>' +
            '<div class="edt-si" style="color:' + col + '">' + (creneau.classe || '') + (creneau.salle ? ' \u00B7 ' + creneau.salle : '') + '</div>' +
          '</div>';
        } else {
          grid.innerHTML += '<div class="edt-slot vide"></div>';
        }
      });
    });
  },

  init: function() {
    this.charger();
  }
};

PAGE_HOOKS.edt = function() { PageEDT.init(); };
