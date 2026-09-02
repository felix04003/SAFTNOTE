import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageAbsences: any = {
  data: [] as any[],
  _presenceId: null as string | null,

  async charger() {
    try {
      const res = await Api.get('/presences/absences');
      this.data = res.data;
      this.renderTable(res.data);
      return true;
    } catch (e: any) {
      console.error('PageAbsences.charger —', e.message);
      return false;
    }
  },

  renderKpis: function(absences: any[]) {
    function set(id: string, val: any) { const el = document.getElementById(id) as HTMLElement | null; if (el) el.textContent = val; }
    const nb_absences   = absences.filter(function(a: any) { return a.statut === 'absent'; }).length;
    const nb_retards    = absences.filter(function(a: any) { return a.statut === 'retard'; }).length;
    const nb_justifiees = absences.filter(function(a: any) { return a.est_justifie; }).length;
    set('abs-kpi-absences', nb_absences);
    set('abs-kpi-retards', nb_retards);
    set('abs-kpi-justifiees', nb_justifiees);
    set('abs-kpi-notifies', absences.length ? Math.round((nb_justifiees / absences.length) * 100) + '%' : '—');
  },

  renderTable: function(absences: any[]) {
    this.renderKpis(absences);
    const tbody = document.getElementById('tb-abs') as HTMLElement | null;
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucune absence enregistrée</td></tr>';
      return;
    }

    tbody.innerHTML = absences.map(function(a: any) {
      const type     = a.statut || a.type || 'absent';
      const justifie = a.est_justifie;
      const nom      = escapeHtml((a.eleve || ((a.prenom || '') + ' ' + (a.nom || ''))).trim() || '—');
      const classe   = escapeHtml(a.classe || '—');
      const date     = escapeHtml(a.date_cours || a.date || '—');
      const matiere  = escapeHtml(a.matiere || '—');
      const typeEsc  = escapeHtml(type);
      const justif   = escapeHtml(a.justification || '—');
      const presId   = escapeHtml(String(a.presence_id || ''));

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

  ouvrirJustification: function(presenceId: string) {
    if (!presenceId) return toast('Identifiant de présence manquant', 'w');
    PageAbsences._presenceId = presenceId;
    const motif = document.getElementById('just-motif') as HTMLInputElement | null;
    if (motif) motif.value = '';
    openModal('m-justifier-absence');
  },

  confirmerJustification: async function() {
    const motif = (document.getElementById('just-motif') as HTMLInputElement | null)?.value?.trim();
    if (!motif) return toast('Saisissez un motif de justification', 'w');
    if (!PageAbsences._presenceId) return toast('Erreur : absence introuvable', 'e');

    const btn = document.getElementById('btn-justifier-abs') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/presences/' + PageAbsences._presenceId + '/justifier', { justification: motif });
      closeModal('m-justifier-absence');
      toast('Absence justifiée ✓', 's');
      PageAbsences._presenceId = null;
      await PageAbsences.charger();
    } catch (e: any) {
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
