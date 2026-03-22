'use strict';

/**
 * Page Mon Emploi du temps (enseignant) — charge depuis l'API.
 * Affiche un état vide si le backend est indisponible.
 */
var PageEnsEdt = {
  data: null,

  async charger() {
    try {
      var res = await Api.get('/enseignants/moi/edt');
      this.data = res.data;
      this.renderGrid(res.data);
      return true;
    } catch (e) {
      console.warn('PageEnsEdt: impossible de charger l\'EDT —', e.message);
      var grid = document.getElementById('ens-edt-grid');
      if (grid) grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Emploi du temps indisponible</div>';
      return false;
    }
  },

  renderGrid: function(data) {
    if (!data || !data.emploi_du_temps) return;

    var grid = document.getElementById('ens-edt-grid');
    if (!grid) return;
    grid.className = 'edt-grid';

    // Mettre à jour l'année scolaire
    var anneeEl = document.getElementById('ens-edt-annee');
    if (anneeEl && data.annee) {
      anneeEl.textContent = data.annee;
    }

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
      'Mathématiques': '#1A5276', 'Physique': '#7D3C98', 'SVT': '#1E8449',
      'Français': '#B7950B', 'Anglais': '#1B4F72', 'Philo': '#6C3483',
      'Histoire-Géo': '#935116', 'EPS': '#1A6B3A'
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
            '<div class="edt-si" style="color:' + col + '">' + (creneau.classe || '') + (creneau.salle ? ' · ' + creneau.salle : '') + '</div>' +
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

PAGE_HOOKS['ens-edt'] = function() { PageEnsEdt.init(); };
