import { Api } from '../api';
import { escapeHtml, cn, init2, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageEleves: any = {
  page: 1,
  limite: 20,
  total: 0,
  classeId: '',
  recherche: '',
  data: [],
  _classes: [],   // cache des classes pour le select du modal

  async charger() {
    try {
      const params: Record<string, any> = { page: this.page, limite: this.limite };
      if (this.classeId) params['classe_id'] = this.classeId;
      if (this.recherche) params['recherche'] = this.recherche;

      const res = await Api.get('/eleves', params);
      this.data = res.data;
      this.total = res.meta.total;
      this.renderTable(res.data);
      this.renderPagination(res.meta);
      return true;
    } catch (e: any) {
      console.error('PageEleves.charger —', e.message);
      return false;
    }
  },

  // Charge les classes et alimente le <select> du modal
  async chargerClasses() {
    if (this._classes.length) return;
    try {
      const res = await Api.get('/classes');
      this._classes = res.data || [];
      const sel = document.getElementById('m-eleve-classe') as HTMLSelectElement | null;
      if (!sel) return;
      sel.innerHTML = '<option value="">— Choisir une classe —</option>' +
        this._classes.map(function(c: any) {
          return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nom_classe || c.nom || c.id) + '</option>';
        }).join('');
    } catch (e: any) {
      console.warn('PageEleves.chargerClasses —', e.message);
    }
  },

  async inscrire() {
    const prenom    = (document.getElementById('m-eleve-prenom') as HTMLInputElement | null)?.value?.trim();
    const nom       = (document.getElementById('m-eleve-nom') as HTMLInputElement | null)?.value?.trim();
    const ddn       = (document.getElementById('m-eleve-ddn') as HTMLInputElement | null)?.value;
    const genre     = (document.getElementById('m-eleve-genre') as HTMLSelectElement | null)?.value;
    const classeId  = (document.getElementById('m-eleve-classe') as HTMLSelectElement | null)?.value;
    const pTel      = (document.getElementById('m-eleve-parent-tel') as HTMLInputElement | null)?.value?.trim();
    const pNom      = (document.getElementById('m-eleve-parent-nom') as HTMLInputElement | null)?.value?.trim();
    const pPrenom   = (document.getElementById('m-eleve-parent-prenom') as HTMLInputElement | null)?.value?.trim();
    const pLien     = (document.getElementById('m-eleve-parent-lien') as HTMLSelectElement | null)?.value;

    if (!prenom || !nom) return toast('Prénom et nom obligatoires', 'w');
    if (!classeId)       return toast('Choisissez une classe', 'w');

    const payload: Record<string, any> = {
      prenom: prenom,
      nom: nom,
      genre: genre || undefined,
      date_naissance: ddn || undefined,
      classe_id: classeId,
    };

    if (pTel) {
      payload['parent'] = {
        nom:    pNom || nom,
        prenom: pPrenom || 'Parent',
        telephone: pTel,
        lien:   pLien || 'tuteur',
      };
    }

    const btn = document.getElementById('btn-inscrire-eleve') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Inscription…'; }

    try {
      await Api.post('/eleves', payload);
      closeModal('m-eleve');
      toast('Élève inscrit' + (pTel ? ' — Parent notifié' : '') + ' ✓', 's');
      this.page = 1;
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Inscription échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Inscrire l'élève"; }
    }
  },

  renderTable: function(eleves: any[]) {
    const tbody = document.getElementById('tb-eleves') as HTMLElement | null;
    if (!tbody) return;

    if (!eleves.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--g400);padding:30px">Aucun élève trouvé</td></tr>';
      return;
    }

    tbody.innerHTML = eleves.map(function(e: any) {
      const nom = escapeHtml((e.prenom || '') + ' ' + (e.nom || ''));
      const moy = e.moyenne != null ? e.moyenne : null;
      const abs = e.nb_absences || 0;
      return '<tr>' +
        '<td class="nc" style="display:flex;align-items:center;gap:9px"><div class="av" style="background:' + cn(moy) + '">' + init2(nom) + '</div>' + nom + '</td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400)">' + escapeHtml(e.matricule || '—') + '</td>' +
        '<td><span class="badge bp">' + escapeHtml(e.classe || e.niveau || '—') + '</span></td>' +
        '<td><span class="badge bs">✓ Inscrit</span></td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bn">—</span>') + '</td>' +
        '<td><span style="font-weight:600;color:' + (abs >= 10 ? 'var(--rouge)' : abs >= 5 ? 'var(--warning)' : 'var(--g700)') + '">' + abs + 'j</span></td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(e.parent_nom || '—') + '</td>' +
        '<td><button class="btn btn-l btn-sm" onclick="PageEleves.voirFiche(\'' + escapeHtml(e.id) + '\')">Voir</button></td>' +
      '</tr>';
    }).join('');
  },

  renderPagination: function(meta: any) {
    const pag = document.getElementById('pag-eleves') as HTMLElement | null;
    if (!pag) return;
    const debut = ((meta.page - 1) * meta.limite) + 1;
    const fin = Math.min(meta.page * meta.limite, meta.total);
    pag.innerHTML =
      '<span style="font-size:12px;color:var(--g500)">Affichage <b>' + debut + '–' + fin + '</b> sur <b>' + meta.total + '</b></span>' +
      '<div style="display:flex;gap:4px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled style="opacity:.4;cursor:default"' : 'onclick="PageEleves.pagePrecedente()"') + '>← Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled style="opacity:.4;cursor:default"' : 'onclick="PageEleves.pageSuivante()"') + '>Suiv. →</button>' +
      '</div>';
  },

  pageSuivante:   function() { this.page++; this.charger(); },
  pagePrecedente: function() { if (this.page > 1) { this.page--; this.charger(); } },

  filtrerRecherche: function(q: string) {
    this.recherche = q; this.page = 1;
    clearTimeout(this._debounce);
    const self = this;
    this._debounce = setTimeout(function() { self.charger(); }, 300);
  },

  filtrerClasse: function(classeId) { this.classeId = classeId; this.page = 1; this.charger(); },
  voirFiche: async function(id: string) {
    try {
      const res = await Api.get('/eleves/' + id);
      const e = res.data;
      // Récupère les infos supplémentaires depuis le cache local (liste)
      const cache = (PageEleves.data || []).find(function(x: any) { return x.id === id; }) || {};

      const set = function(sel: string, val: string) {
        const el = document.getElementById(sel) as HTMLElement | null;
        if (el) el.textContent = val || '—';
      };
      const nomComplet = (e.prenom || '') + ' ' + (e.nom || '');
      const avatarEl = document.getElementById('fiche-avatar') as HTMLElement | null;
      if (avatarEl) { avatarEl.textContent = init2(nomComplet); }
      set('fiche-nom',       nomComplet);
      set('fiche-matricule', e.matricule);
      set('fiche-ddn',       e.date_naissance || '—');
      set('fiche-genre',     e.genre === 'M' ? 'Masculin' : e.genre === 'F' ? 'Féminin' : '—');
      set('fiche-classe',    cache.classe || cache.niveau || '—');
      set('fiche-parent',    cache.parent_nom || '—');
      set('fiche-parent-tel', cache.telephone || '—');

      openModal('m-fiche-eleve');
    } catch (e: any) {
      toast('Impossible de charger la fiche élève', 'e');
    }
  },

  ouvrirModal: function() {
    this.chargerClasses();
    openModal('m-eleve');
  },

  init: function() { this.page = 1; this.charger(); }
};

(window as any).PageEleves = PageEleves;
PAGE_HOOKS['eleves'] = () => PageEleves.init();
