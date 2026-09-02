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
      const res = await Api.get('/enseignants/moi/classes');
      // Dédupliquer par classe_id
      const vues: Record<string, boolean> = {};
      this._classes = (res.data || []).filter(function(c: any) {
        if (vues[c.classe_id]) return false;
        vues[c.classe_id] = true;
        return true;
      });
    } catch { this._classes = []; }
  },

  _peuplerFiltres() {
    const sel = document.getElementById('ens-disc-fil-classe') as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML = '<option value="">Toutes mes classes</option>' +
        this._classes.map(function(c: any) {
          return '<option value="' + c.classe_id + '">' + _esc(c.classe) + '</option>';
        }).join('');
    }
  },

  filtrerClasse: function(classeId) { this._filtreClasseId = classeId; this._page = 1; this.charger(); },
  filtrerType:   function(type)     { this._filtreType = type;         this._page = 1; this.charger(); },

  async charger() {
    const tbody = document.getElementById('tb-ens-sanctions') as HTMLElement | null;
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      const params: Record<string, any> = { page: this._page, limite: this._limite };
      if (this._filtreClasseId) params['classe_id'] = this._filtreClasseId;
      if (this._filtreType)     params['type'] = this._filtreType;

      const res = await Api.get('/discipline/sanctions', params);
      const sanctions = res.data || [];

      if (!sanctions.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--g400)">Aucune sanction enregistrée</td></tr>';
        this._renderPagination(null);
        return;
      }

      tbody.innerHTML = sanctions.map(function(s: any) {
        const typeLabels: Record<string, string> = {
          avertissement_oral:   'Avert. oral',
          avertissement_ecrit:  'Avert. écrit',
          retenue:              'Retenue',
          renvoi_temporaire:    'Renvoi temp.',
          conseil_discipline:   'Conseil disc.',
          exclusion_definitive: 'Exclusion déf.',
        };
        const typeLabel = typeLabels[s.type] || escapeHtml(s.type || '—');

        const badgeType = (s.type === 'renvoi_temporaire' || s.type === 'exclusion_definitive') ? 'bd' : 'bw';
        const nomE   = escapeHtml(((s.eleve_prenom || '') + ' ' + (s.eleve_nom || '')).trim() || '—');
        const classe = escapeHtml(s.classe || '—');
        const dateP  = escapeHtml(s.date_prononcee || '—');
        const motif  = escapeHtml(s.motif || '—');

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

    } catch (e: any) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderPagination: function(meta: any) {
    const pag = document.getElementById('pag-ens-disc') as HTMLElement | null;
    if (!pag) return;
    if (!meta || meta.total <= this._limite) { pag.innerHTML = ''; return; }
    const debut = ((meta.page - 1) * meta.limite) + 1;
    const fin   = Math.min(meta.page * meta.limite, meta.total);
    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)"><b>' + debut + '–' + fin + '</b> / <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled' : 'onclick="PageEnsDiscipline._page--;PageEnsDiscipline.charger()"') + '>← Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled' : 'onclick="PageEnsDiscipline._page++;PageEnsDiscipline.charger()"') + '>Suiv. →</button>' +
      '</div>';
  },

  // ── Modal création sanction ─────────────────────────────────────
  async ouvrirModal() {
    const sel = document.getElementById('disc-classe') as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c: any) {
          return '<option value="' + c.classe_id + '">' + _esc(c.classe) + '</option>';
        }).join('');
    }
    const selEl = document.getElementById('disc-eleve') as HTMLSelectElement | null;
    if (selEl) {
      selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      selEl.disabled = true;
    }
    const motifEl = document.getElementById('disc-motif') as HTMLInputElement | null;
    const typeEl  = document.getElementById('disc-type')  as HTMLSelectElement | null;
    const dateEl  = document.getElementById('disc-date')  as HTMLInputElement | null;
    if (motifEl) motifEl.value = '';
    if (typeEl)  typeEl.value  = '';
    if (dateEl)  dateEl.value  = '';

    openModal('m-ens-discipline');
  },

  async chargerElevesClasse(classeId: string) {
    const selEl = document.getElementById('disc-eleve') as HTMLSelectElement | null;
    if (!selEl) return;
    if (!classeId) {
      selEl.disabled = true;
      selEl.innerHTML = '<option value="">— Sélectionnez d\'abord une classe —</option>';
      return;
    }

    selEl.innerHTML = '<option value="">Chargement…</option>';
    selEl.disabled = true;

    try {
      const res = await Api.get('/classes/' + classeId + '/eleves');
      const eleves = res.data || [];
      if (!eleves.length) {
        selEl.innerHTML = '<option value="">Aucun élève dans cette classe</option>';
        return;
      }
      selEl.innerHTML = '<option value="">— Choisir un élève —</option>' +
        eleves.map(function(el: any) {
          const val = el.inscription_id || el.id || '';
          return '<option value="' + val + '">' + _esc(el.nom) + ' ' + _esc(el.prenom) + '</option>';
        }).join('');
      selEl.disabled = false;
    } catch {
      selEl.innerHTML = '<option value="">Erreur de chargement</option>';
    }
  },

  async creerSanction() {
    const inscriptionIdEl = document.getElementById('disc-eleve')  as HTMLSelectElement | null;
    const typeEl          = document.getElementById('disc-type')   as HTMLSelectElement | null;
    const motifEl         = document.getElementById('disc-motif')  as HTMLInputElement  | null;
    const dateEl          = document.getElementById('disc-date')   as HTMLInputElement  | null;

    const inscriptionId = inscriptionIdEl ? inscriptionIdEl.value : '';
    const type          = typeEl  ? typeEl.value  : '';
    const motif         = motifEl ? motifEl.value.trim() : '';
    const date          = dateEl  ? dateEl.value  : '';

    if (!inscriptionId)             return toast('Sélectionnez un élève', 'w');
    if (!type)                      return toast('Sélectionnez un type de sanction', 'w');
    if (!motif || motif.length < 5) return toast('Le motif doit faire au moins 5 caractères', 'w');

    const btn = document.getElementById('btn-disc-creer') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      const payload: Record<string, any> = { inscription_id: inscriptionId, type, motif };
      if (date) payload['date_prononcee'] = date;

      await Api.post('/discipline/sanctions', payload);
      closeModal('m-ens-discipline');
      toast('Sanction enregistrée ✓ — parent notifié', 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Erreur lors de l\'enregistrement', 'e');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer la sanction'; }
    }
  },
};

// Alias vers escapeHtml() de ui.js (couvre &, <, >, ", ')
function _esc(s: string): string { return escapeHtml(s); }

(window as any).PageEnsDiscipline = PageEnsDiscipline;
PAGE_HOOKS['ens-discipline'] = () => PageEnsDiscipline.init();
