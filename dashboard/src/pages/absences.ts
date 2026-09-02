// @ts-nocheck
import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageAbsences: any = {
  data: [],
  _presenceId: null,  // ID de la présence en cours de justification

  async charger() {
    try {
      var res = await Api.get('/presences/absences');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e) {
      console.error('PageAbsences.charger —', e.message);
      return false;
    }
  },

  renderKpis: function(absences) {
    function set(id, val) { var el = document.getElementById(id); if (el) el.textContent = val; }
    var nb_absences = absences.filter(function(a) { return a.statut === 'absent'; }).length;
    var nb_retards = absences.filter(function(a) { return a.statut === 'retard'; }).length;
    var nb_justifiees = absences.filter(function(a) { return a.est_justifie; }).length;
    set('abs-kpi-absences', nb_absences);
    set('abs-kpi-retards', nb_retards);
    set('abs-kpi-justifiees', nb_justifiees);
    set('abs-kpi-notifies', absences.length ? Math.round((nb_justifiees / absences.length) * 100) + '%' : '—');
  },

  renderTable: function(absences) {
    this.renderKpis(absences);
    var tbody = document.getElementById('tb-abs');
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucune absence enregistrée</td></tr>';
      return;
    }

    tbody.innerHTML = absences.map(function(a) {
      var type     = a.statut || a.type || 'absent';
      var justifie = a.est_justifie;
      var nom      = escapeHtml((a.eleve || ((a.prenom || '') + ' ' + (a.nom || ''))).trim() || '—');
      var classe   = escapeHtml(a.classe || '—');
      var date     = escapeHtml(a.date_cours || a.date || '—');
      var matiere  = escapeHtml(a.matiere || '—');
      var typeEsc  = escapeHtml(type);
      var justif   = escapeHtml(a.justification || '—');
      var presId   = escapeHtml(String(a.presence_id || ''));

      return '<tr>' +
        '<td class="nc">' + nom + '</td>' +
        '<td><span class="badge bp">' + classe + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + date + '</td>' +
        '<td>' + matiere + '</td>' +
        '<td><span class="badge ' + (type === 'absent' ? 'bd' : 'bw') + '">' + typeEsc + '</span></td>' +
        '<td style="text-align:center">' + (a.notifie || (justifie != null ? (justifie ? '✅' : '❌') : '—')) + '</td>' +
        '<td style="font-size:11.5px;color:var(--g500)">' + justif + '</td>' +
        '<td>' + (!justifie ? '<button class="btn btn-l btn-sm" onclick="PageAbsences.ouvrirJustification(\'' + presId + '\')">Justifier</button>' : '<span style="font-size:12px;color:var(--success)">Justifiée</span>') + '</td>' +
      '</tr>';
    }).join('');
  },

  ouvrirJustification: function(presenceId) {
    if (!presenceId) return toast('Identifiant de présence manquant', 'w');
    PageAbsences._presenceId = presenceId;
    var motif = document.getElementById('just-motif');
    if (motif) motif.value = '';
    openModal('m-justifier-absence');
  },

  confirmerJustification: async function() {
    var motif = document.getElementById('just-motif')?.value?.trim();
    if (!motif) return toast('Saisissez un motif de justification', 'w');
    if (!PageAbsences._presenceId) return toast('Erreur : absence introuvable', 'e');

    var btn = document.getElementById('btn-justifier-abs');
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/presences/' + PageAbsences._presenceId + '/justifier', { justification: motif });
      closeModal('m-justifier-absence');
      toast('Absence justifiée ✓', 's');
      PageAbsences._presenceId = null;
      await PageAbsences.charger();
    } catch (e) {
      toast(e.message || 'Erreur lors de la justification', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  init: function() {
    this.charger();
  }
};

(window as any).PageAbsences = PageAbsences;
PAGE_HOOKS['absences'] = () => PageAbsences.init();
