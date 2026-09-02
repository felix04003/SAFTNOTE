// @ts-nocheck
import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../ens-router';

export const PageEnsDiscipline: any = {
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
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      var params = { page: this._page, limite: this._limite };
      if (this._filtreClasseId) params.classe_id = this._filtreClasseId;
      if (this._filtreType)     params.type = this._filtreType;

      var res = await Api.get('/discipline/sanctions', params);
      var sanctions = res.data || [];

      if (!sanctions.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--g400)">Aucune sanction enregistrée</td></tr>';
        this._renderPagination(null);
        return;
      }

      tbody.innerHTML = sanctions.map(function(s) {
        var typeLabel = {
          avertissement_oral:   'Avert. oral',
          avertissement_ecrit:  'Avert. écrit',
          retenue:              'Retenue',
          renvoi_temporaire:    'Renvoi temp.',
          conseil_discipline:   'Conseil disc.',
          exclusion_definitive: 'Exclusion déf.',
        }[s.type] || escapeHtml(s.type || '—');

        var badgeType = (s.type === 'renvoi_temporaire' || s.type === 'exclusion_definitive') ? 'bd' : 'bw';
        var nomE   = escapeHtml(((s.eleve_prenom || '') + ' ' + (s.eleve_nom || '')).trim() || '—');
        var classe = escapeHtml(s.classe || '—');
        var dateP  = escapeHtml(s.date_prononcee || '—');
        var motif  = escapeHtml(s.motif || '—');

        return '<tr>' +
          '<td class="nc">' + nomE + '</td>' +
          '<td><span class="badge bp">' + classe + '</span></td>' +
          '<td><span class="badge ' + badgeType + '">' + typeLabel + '</span></td>' +
          '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + dateP + '</td>' +
          '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--g500)" title="' + motif + '">' + motif + '</td>' +
          '<td style="text-align:center">' + (s.notif_parent_envoyee ? '<span class="badge bs">������ Oui</span>' : '<span class="badge bd">Non</span>') + '</td>' +
        '</tr>';
      }).join('');

      this._renderPagination(res.meta);

    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderPagination: function(meta) {
    var pag = document.getElementById('pag-ens-disc');
    if (!pag) return;
    if (!meta || meta.total <= this._limite) { pag.innerHTML = ''; return; }
    var debut = ((meta.page - 1) * meta.limite) + 1;
    var fin   = Math.min(meta.page * meta.limite, meta.total);
    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)"><b>' + debut + '–' + fin + '</b> / <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled' : 'onclick="PageEnsDiscipline._page--;PageEnsDiscipline.charger()"') + '>← Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled' : 'onclick="PageEnsDiscipline._page++;PageEnsDiscipline.charger()"') + '>Suiv. →</button>' +
      '</div>';
  },

  // ── Modal création sanction ─────────────────────────────────────
  async ouvrirModal() {
    // Peupler le select classe dans le modal
    var sel = document.getElementById('disc-classe');
    if (sel) {
      sel.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c) {
          return '<option value="' + c.classe_id + '">' + _esc(c.classe) + '</option>';
        }).join('');
    }
    // Reset élève
    var selEl = document.getElementById('disc-eleve');
    if (selEl) {
      selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
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
      selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      return;
    }

    selEl.innerHTML = '<option value="">Chargement…</option>';
    selEl.disabled = true;

    try {
      var res = await Api.get('/classes/' + classeId + '/eleves');
      var eleves = res.data || [];
      if (!eleves.length) {
        selEl.innerHTML = '<option value="">Aucun élève dans cette classe</option>';
        return;
      }
      selEl.innerHTML = '<option value="">— Choisir un élève —</option>' +
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

    if (!inscriptionId)          return toast('Sélectionnez un élève', 'w');
    if (!type)                   return toast('Sélectionnez un type de sanction', 'w');
    if (!motif || motif.length < 5) return toast('Le motif doit faire au moins 5 caractères', 'w');

    var btn = document.getElementById('btn-disc-creer');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      var payload = { inscription_id: inscriptionId, type: type, motif: motif };
      if (date) payload.date_prononcee = date;

      await Api.post('/discipline/sanctions', payload);
      closeModal('m-ens-discipline');
      toast('Sanction enregistrée ✓ — parent notifié ������', 's');
      await this.charger();
    } catch (e) {
      toast(e.message || 'Erreur lors de l\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer la sanction'; }
    }
  },
};

// Alias vers escapeHtml() de ui.js (couvre &, <, >, ", ')
function _esc(s) { return escapeHtml(s); }

(window as any).PageEnsDiscipline = PageEnsDiscipline;
PAGE_HOOKS['ens-discipline'] = () => PageEnsDiscipline.init();
