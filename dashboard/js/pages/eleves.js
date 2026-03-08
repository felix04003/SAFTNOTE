'use strict';

/**
 * Page Élèves — charge les données depuis l'API,
 * fallback sur les données mock si le backend est indisponible.
 */
var PageEleves = {
  page: 1,
  limite: 20,
  total: 0,
  classeId: '',
  recherche: '',
  data: [],

  async charger() {
    try {
      var params = { page: this.page, limite: this.limite };
      if (this.classeId) params.classe_id = this.classeId;
      if (this.recherche) params.recherche = this.recherche;

      var res = await Api.get('/eleves', params);
      this.data = res.data;
      this.total = res.meta.total;
      this.renderTable(res.data);
      this.renderPagination(res.meta);
      return true;
    } catch (e) {
      // Fallback sur mock
      console.warn('PageEleves: fallback mock —', e.message);
      return false;
    }
  },

  renderTable: function(eleves) {
    var tbody = document.getElementById('tb-eleves');
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun élève trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(e) {
      var nom = (e.prenom || '') + ' ' + (e.nom || '');
      var moy = e.moyenne != null ? e.moyenne : null;
      var abs = e.nb_absences || 0;
      return '<tr>' +
        '<td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:' + cn(moy) + '">' + init2(nom) + '</div>' + nom + '</td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400)">' + (e.matricule || '—') + '</td>' +
        '<td><span class="badge bp">' + (e.classe || e.niveau || '—') + '</span></td>' +
        '<td><span class="badge bs">\u2713 Inscrit</span></td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bn">\u2014</span>') + '</td>' +
        '<td><span style="font-weight:600;color:' + (abs >= 10 ? 'var(--rouge)' : abs >= 5 ? 'var(--warning)' : 'var(--g700)') + '">' + abs + 'j</span></td>' +
        '<td style="font-size:12px;color:var(--g500)">' + (e.parent_nom || '—') + '</td>' +
        '<td style="display:flex;gap:5px"><button class="btn btn-l btn-sm" onclick="PageEleves.voirFiche(\'' + e.id + '\')">Voir</button><button class="btn btn-l btn-sm" style="color:var(--orange);border-color:var(--orange-lt)" onclick="PageEleves.notifierParent(\'' + e.id + '\')">📱</button></td>' +
      '</tr>';
    }).join('');
  },

  renderPagination: function(meta) {
    var pag = document.getElementById('pag-eleves');
    if (!pag) return;

    var debut = ((meta.page - 1) * meta.limite) + 1;
    var fin = Math.min(meta.page * meta.limite, meta.total);

    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)">Affichage <b>' + debut + '–' + fin + '</b> sur <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled style="opacity:.4;cursor:default"' : 'onclick="PageEleves.pagePrecedente()"') + '>\u2190 Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled style="opacity:.4;cursor:default"' : 'onclick="PageEleves.pageSuivante()"') + '>Suiv. \u2192</button>' +
      '</div>';
  },

  pageSuivante: function() {
    this.page++;
    this.charger();
  },

  pagePrecedente: function() {
    if (this.page > 1) { this.page--; this.charger(); }
  },

  filtrerRecherche: function(q) {
    this.recherche = q;
    this.page = 1;
    // Debounce — ne charger qu'après 300ms sans frappe
    clearTimeout(this._debounce);
    var self = this;
    this._debounce = setTimeout(function() { self.charger(); }, 300);
  },

  filtrerClasse: function(classeId) {
    this.classeId = classeId;
    this.page = 1;
    this.charger();
  },

  voirFiche: function(id) {
    toast('Fiche élève — fonctionnalité à venir');
  },

  notifierParent: function(id) {
    toast('Notification parent envoyée', 's');
  },

  init: function() {
    this.page = 1;
    this.charger();
  }
};

// Hook dans le routeur
PAGE_HOOKS.eleves = function() { PageEleves.init(); };
