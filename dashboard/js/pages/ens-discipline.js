'use strict';

var PageEnsDiscipline = {
  _classes: [],
  _page: 1,
  _limite: 20,
  _filtreClasseId: '',
  _filtreType: '',

  async init() {
    await this._chargerClasses();
    this._peuplerFiltres();
    await this.charger();
  },

  async _chargerClasses() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      // Dédupliquer par classe_id
      var vues = {};
      this._classes = (res.data || []).filter(function(c) {
        if (vues[c.classe_id]) return false;
        vues[c.classe_id] = true;
        return true;
      });
    } catch (e) { this._classes = []; }
  },

  _peuplerFiltres() {
    var sel = document.getElementById('ens-disc-fil-classe');
    if (sel) {
      sel.innerHTML = '<option value="">Toutes mes classes</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + _esc(c.classe) + '</option>';
        }).join('');
    }
  },

  filtrerClasse: function(classeId) { this._filtreClasseId = classeId; this._page = 1; this.charger(); },
  filtrerType:   function(type)     { this._filtreType = type;         this._page = 1; this.charger(); },

  async charger() {
    var tbody = document.getElementById('tb-ens-sanctions');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--g400)">Chargement\u2026</td></tr>';

    try {
      var params = { page: this._page, limite: this._limite };
      if (this._filtreClasseId) params.classe_id = this._filtreClasseId;
      if (this._filtreType)     params.type = this._filtreType;

      var res = await Api.get('/discipline/sanctions', params);
      var sanctions = res.data || [];

      if (!sanctions.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--g400)">Aucune sanction enregistr\u00e9e</td></tr>';
        this._renderPagination(null);
        return;
      }

      tbody.innerHTML = sanctions.map(function(s) {
        var typeLabel = {
          avertissement_oral:   'Avert. oral',
          avertissement_ecrit:  'Avert. \u00e9crit',
          retenue:              'Retenue',
          renvoi_temporaire:    'Renvoi temp.',
          conseil_discipline:   'Conseil disc.',
          exclusion_definitive: 'Exclusion d\u00e9f.',
        }[s.type] || (s.type || '\u2014');

        var badgeType = (s.type === 'renvoi_temporaire' || s.type === 'exclusion_definitive') ? 'bd' : 'bw';

        return '<tr>' +
          '<td class="nc">' + (s.eleve_prenom || '') + ' ' + (s.eleve_nom || '') + '</td>' +
          '<td><span class="badge bp">' + (s.classe || '\u2014') + '</span></td>' +
          '<td><span class="badge ' + badgeType + '">' + typeLabel + '</span></td>' +
          '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + (s.date_prononcee || '\u2014') + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--g500)" title="' + (s.motif || '').replace(/"/g, '&quot;') + '">' + (s.motif || '\u2014') + '</td>' +
          '<td style="text-align:center">' + (s.notif_parent_envoyee ? '<span class="badge bs">\uD83D\uDCF1 Oui</span>' : '<span class="badge bd">Non</span>') + '</td>' +
        '</tr>';
      }).join('');

      this._renderPagination(res.meta);

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--rouge)">' + (e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderPagination: function(meta) {
    var pag = document.getElementById('pag-ens-disc');
    if (!pag) return;
    if (!meta || meta.total <= this._limite) { pag.innerHTML = ''; return; }
    var debut = ((meta.page - 1) * meta.limite) + 1;
    var fin   = Math.min(meta.page * meta.limite, meta.total);
    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)"><b>' + debut + '\u2013' + fin + '</b> / <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled' : 'onclick="PageEnsDiscipline._page--;PageEnsDiscipline.charger()"') + '>\u2190 Pr\u00e9c.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled' : 'onclick="PageEnsDiscipline._page++;PageEnsDiscipline.charger()"') + '>Suiv. \u2192</button>' +
      '</div>';
  },

  // ── Modal création sanction ─────────────────────────────────────
  async ouvrirModal() {
    // Peupler le select classe dans le modal
    var sel = document.getElementById('disc-classe');
    if (sel) {
      sel.innerHTML = '<option value="">\u2014 Choisir une classe \u2014</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + _esc(c.classe) + '</option>';
        }).join('');
    }
    // Reset élève
    var selEl = document.getElementById('disc-eleve');
    if (selEl) {
      selEl.innerHTML = '<option value="">\u2014 S\u00e9lectionnez d\'abord une classe \u2014</option>';
      selEl.disabled = true;
    }
    // Reset autres champs
    var motifEl = document.getElementById('disc-motif');
    var typeEl  = document.getElementById('disc-type');
    var dateEl  = document.getElementById('disc-date');
    if (motifEl) motifEl.value = '';
    if (typeEl)  typeEl.value  = '';
    if (dateEl)  dateEl.value  = '';

    openModal('m-ens-discipline');
  },

  async chargerElevesClasse(classeId) {
    var selEl = document.getElementById('disc-eleve');
    if (!selEl) return;
    if (!classeId) {
      selEl.disabled = true;
      selEl.innerHTML = '<option value="">\u2014 S\u00e9lectionnez d\'abord une classe \u2014</option>';
      return;
    }

    selEl.innerHTML = '<option value="">Chargement\u2026</option>';
    selEl.disabled = true;

    try {
      var res = await Api.get('/classes/' + classeId + '/eleves');
      var eleves = res.data || [];
      if (!eleves.length) {
        selEl.innerHTML = '<option value="">Aucun \u00e9l\u00e8ve dans cette classe</option>';
        return;
      }
      selEl.innerHTML = '<option value="">\u2014 Choisir un \u00e9l\u00e8ve \u2014</option>' +
        eleves.map(function(el) {
          // inscription_id est requis par POST /discipline/sanctions
          var val = el.inscription_id || el.id || '';
          return '<option value="' + val + '">' + _esc(el.nom) + ' ' + _esc(el.prenom) + '</option>';
        }).join('');
      selEl.disabled = false;
    } catch (e) {
      selEl.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  },

  async creerSanction() {
    var inscriptionIdEl = document.getElementById('disc-eleve');
    var typeEl          = document.getElementById('disc-type');
    var motifEl         = document.getElementById('disc-motif');
    var dateEl          = document.getElementById('disc-date');

    var inscriptionId = inscriptionIdEl ? inscriptionIdEl.value : '';
    var type          = typeEl  ? typeEl.value  : '';
    var motif         = motifEl ? motifEl.value.trim() : '';
    var date          = dateEl  ? dateEl.value  : '';

    if (!inscriptionId)          return toast('S\u00e9lectionnez un \u00e9l\u00e8ve', 'w');
    if (!type)                   return toast('S\u00e9lectionnez un type de sanction', 'w');
    if (!motif || motif.length < 5) return toast('Le motif doit faire au moins 5 caract\u00e8res', 'w');

    var btn = document.getElementById('btn-disc-creer');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement\u2026'; }

    try {
      var payload = { inscription_id: inscriptionId, type: type, motif: motif };
      if (date) payload.date_prononcee = date;

      await Api.post('/discipline/sanctions', payload);
      closeModal('m-ens-discipline');
      toast('Sanction enregistr\u00e9e \u2713 \u2014 parent notifi\u00e9 \uD83D\uDCF1', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur lors de l\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer la sanction'; }
    }
  },
};

function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

PAGE_HOOKS['ens-discipline'] = function() { PageEnsDiscipline.init(); };
