'use strict';

/**
 * Page Emploi du temps — sélecteur de classe pour admin/directeur.
 * 1. Charge la liste des classes via GET /classes
 * 2. Affiche un <select> pour choisir une classe
 * 3. Sur changement, charge l'EDT via GET /edt/classe/:classeId
 */
var PageEDT = {
  data: null,

  chargerClasses: async function() {
    var grid = document.getElementById('edt-grid');
    if (!grid) return;

    try {
      var res = await Api.get('/classes');
      var classes = res.donnees || [];

      if (!classes.length) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Aucune classe disponible</div>';
        return;
      }

      var selectHtml = '<div style="padding:16px 0 24px">' +
        '<label for="edt-classe-select" style="display:block;margin-bottom:8px;font-size:13px;color:var(--g600);font-weight:600">Sélectionner une classe</label>' +
        '<select id="edt-classe-select" style="padding:8px 12px;border:1px solid var(--g200);border-radius:6px;font-size:14px;background:var(--surface);color:var(--text);cursor:pointer">' +
          '<option value="">— Choisir une classe —</option>' +
          classes.map(function(c) {
            return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nom || c.n || c.libelle || c.id) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div id="edt-grid-inner"></div>';

      grid.innerHTML = selectHtml;

      document.getElementById('edt-classe-select').addEventListener('change', function(e) {
        var classeId = e.target.value;
        if (classeId) {
          PageEDT.chargerEDTClasse(classeId);
        } else {
          var inner = document.getElementById('edt-grid-inner');
          if (inner) inner.innerHTML = '';
        }
      });
    } catch (e) {
      console.warn('PageEDT: impossible de charger les classes —', e.message);
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Classes indisponibles</div>';
    }
  },

  chargerEDTClasse: async function(classeId) {
    var inner = document.getElementById('edt-grid-inner');
    if (!inner) return;

    inner.innerHTML = '<div style="text-align:center;padding:24px;color:var(--g400);font-size:13px">Chargement…</div>';

    try {
      var res = await Api.get('/edt/classe/' + encodeURIComponent(classeId));
      this.data = res.donnees;
      this.renderGrid(res.donnees);
    } catch (e) {
      console.warn('PageEDT: impossible de charger l\'EDT —', e.message);
      inner.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  renderGrid: function(data) {
    if (!data || !data.emploi_du_temps) return;

    var inner = document.getElementById('edt-grid-inner');
    if (!inner) return;
    inner.className = 'edt-grid';

    var jours = [''].concat(data.emploi_du_temps.map(function(j) { return j.nom; }));
    inner.innerHTML = jours.map(function(j) {
      return '<div class="edt-h">' + escapeHtml(j) + '</div>';
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
      inner.innerHTML += '<div class="edt-t">' + escapeHtml(plage.debut) + '</div>';
      data.emploi_du_temps.forEach(function(jour) {
        var creneau = (jour.creneaux || []).find(function(c) {
          return c.heure_debut === plage.debut;
        });
        if (creneau && !creneau.est_pause) {
          var mat = creneau.matiere || '';
          var col = cmat[mat] || '#1A4731';
          inner.innerHTML += '<div class="edt-slot" style="background:' + col + '14;border-left:3px solid ' + col + '">' +
            '<div class="edt-sm" style="color:' + col + '">' + escapeHtml(mat) + '</div>' +
            '<div class="edt-si" style="color:' + col + '">' + escapeHtml(creneau.classe || '') + (creneau.salle ? ' \u00B7 ' + escapeHtml(creneau.salle) : '') + '</div>' +
          '</div>';
        } else {
          inner.innerHTML += '<div class="edt-slot vide"></div>';
        }
      });
    });
  },

  init: function() {
    this.chargerClasses();
  }
};

PAGE_HOOKS.edt = function() { PageEDT.init(); };
