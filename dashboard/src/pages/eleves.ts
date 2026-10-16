import { Api } from '../api';
import { escapeHtml, jsArg, cn, init2, toast, openModal, closeModal, exporterCsv } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageEleves: any = {
  page: 1,
  limite: 20,
  total: 0,
  classeId: '',
  recherche: '',
  statut: '',          // '' = inscrits, 'retires' = transferts, abandons, exclusions
  _editId: '',
  _editClasseInitiale: '',
  _retraitId: '',
  data: [],
  _classes: [],   // cache des classes pour le select du modal

  async charger() {
    try {
      const params: Record<string, any> = { page: this.page, limite: this.limite };
      if (this.classeId) params['classe_id'] = this.classeId;
      if (this.recherche) params['recherche'] = this.recherche;
      if (this.statut) params['statut'] = this.statut;

      const res = await Api.get('/eleves', params);
      this.data = res.data;
      this.total = res.meta?.total ?? 0;
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
      const options = this._classes.map(function(c: any) {
        return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nom_classe || c.nom || c.id) + '</option>';
      }).join('');
      const sel = document.getElementById('m-eleve-classe') as HTMLSelectElement | null;
      if (sel) sel.innerHTML = '<option value="">— Choisir une classe —</option>' + options;
      const selModif = document.getElementById('emod-classe') as HTMLSelectElement | null;
      if (selModif) selModif.innerHTML = options;
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

  badgeStatut: function(statut: string) {
    const libelles: Record<string, string> = { transfere: 'Transféré', abandonne: 'Abandon', exclu: 'Exclu' };
    return statut && statut !== 'actif'
      ? '<span class="badge bd">' + escapeHtml(libelles[statut] || statut) + '</span>'
      : '<span class="badge bs">✓ Inscrit</span>';
  },

  actions: function(e: any) {
    const id  = escapeHtml(e.id);
    const nom = jsArg(((e.prenom || '') + ' ' + (e.nom || '')).trim());
    const fiche = '<button class="btn btn-l btn-sm" onclick="PageEleves.voirFiche(\'' + id + '\')">Fiche</button> ';
    if (e.statut && e.statut !== 'actif') {
      return fiche + '<button class="btn btn-p btn-sm" onclick="PageEleves.reintegrer(\'' + id + '\',' + nom + ')">Réintégrer</button>';
    }
    return fiche +
      '<button class="btn btn-l btn-sm" onclick="PageEleves.modifier(\'' + id + '\')">Modifier</button> ' +
      '<button class="btn btn-l btn-sm" onclick="PageEleves.retirer(\'' + id + '\',' + nom + ')">Retirer</button>';
  },

  /** Exporte la liste affichée (classe et inscrits/retirés choisis) */
  exporter: function() { return exporterCsv('/exports/eleves.csv', { statut: this.statut || 'actif', classe_id: this.classeId || undefined }); },
  filtrerStatut: function(statut: string) { this.statut = statut; this.page = 1; this.charger(); },

  // ── Modifier ──
  async modifier(id: string) {
    this._classes = [];          // liste fraîche : une classe a pu être créée ou archivée depuis
    await this.chargerClasses();
    try {
      const res = await Api.get('/eleves/' + id);
      const e = res.data || {};
      const champ = (cible: string, valeur: any) => { const el = document.getElementById(cible) as HTMLInputElement | null; if (el) el.value = valeur == null ? '' : String(valeur); };
      champ('emod-prenom', e.prenom); champ('emod-nom', e.nom);
      champ('emod-ddn', e.date_naissance ? String(e.date_naissance).slice(0, 10) : '');
      champ('emod-genre', e.genre); champ('emod-tel', e.telephone); champ('emod-matricule', e.matricule);
      champ('emod-classe', e.classe_id);
      this._editId = id;
      this._editClasseInitiale = e.classe_id || '';
      openModal('m-eleve-modif');
    } catch (err: any) {
      toast('Erreur : ' + (err.message || 'Fiche introuvable'), 'd');
    }
  },

  async enregistrerModif() {
    const val = (cible: string) => ((document.getElementById(cible) as HTMLInputElement | null)?.value || '').trim();
    const prenom = val('emod-prenom'), nom = val('emod-nom'), matricule = val('emod-matricule');
    if (prenom.length < 2 || nom.length < 2) return toast('Prénom et nom obligatoires', 'w');
    if (!matricule) return toast('Le matricule est obligatoire', 'w');

    const payload: Record<string, any> = {
      prenom, nom, matricule,
      date_naissance: val('emod-ddn') || null,
      genre: val('emod-genre') || null,
      telephone: val('emod-tel') || null,
    };
    const classe = val('emod-classe');
    if (classe && classe !== this._editClasseInitiale) payload['classe_id'] = classe;

    const btn = document.getElementById('btn-eleve-modif') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await Api.put('/eleves/' + this._editId, payload);
      closeModal('m-eleve-modif');
      toast('Élève modifié ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Modification échouée'), 'd');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  // ── Retirer / réintégrer ──
  retirer: function(id: string, nom: string) {
    this._retraitId = id;
    const titre = document.getElementById('ret-titre') as HTMLElement | null;
    if (titre) titre.textContent = 'Retirer ' + nom;
    const motif = document.getElementById('ret-motif') as HTMLInputElement | null;
    if (motif) motif.value = '';
    openModal('m-eleve-retrait');
  },

  async confirmerRetrait() {
    const statut = (document.getElementById('ret-statut') as HTMLSelectElement | null)?.value || 'transfere';
    const motif = ((document.getElementById('ret-motif') as HTMLInputElement | null)?.value || '').trim();
    if (motif.length < 3) return toast('Indiquez le motif (3 caractères minimum)', 'w');
    const btn = document.getElementById('btn-eleve-retrait') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      await Api.put('/eleves/' + this._retraitId + '/statut', { statut, motif });
      closeModal('m-eleve-retrait');
      toast('Élève retiré ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Retrait échoué'), 'd');
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  async reintegrer(id: string, nom: string) {
    if (!confirm('Réintégrer ' + nom + ' dans sa classe ?')) return;
    try {
      await Api.put('/eleves/' + id + '/statut', { statut: 'actif' });
      toast(nom + ' : réintégré ✓', 's');
      await this.charger();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Réintégration échouée'), 'd');
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
        '<td>' + PageEleves.badgeStatut(e.statut) + '</td>' +
        '<td>' + (moy != null ? '<span style="font-weight:700;color:' + cn(moy) + '">' + moy + '/20</span>' : '<span class="badge bn">—</span>') + '</td>' +
        '<td><span style="font-weight:600;color:' + (abs >= 10 ? 'var(--rouge)' : abs >= 5 ? 'var(--warning)' : 'var(--g700)') + '">' + abs + 'j</span></td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml(e.parent_nom || '—') + '</td>' +
        '<td style="white-space:nowrap">' + PageEleves.actions(e) + '</td>' +
      '</tr>';
    }).join('');
  },

  renderPagination: function(meta: any) {
    // meta est optionnel dans ApiResponse (voir types.ts) — sans lui, rien
    // à afficher (revue code-reviewer, lot H, cohérent avec le fallback
    // `res.meta?.total ?? 0` dans charger() ci-dessus).
    if (!meta) return;
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

  filtrerClasse: function(classeId: string) { this.classeId = classeId; this.page = 1; this.charger(); },
  // Fiche complète (identité, parents, résultats, absences, discipline) : page dédiée, voir fiche-eleve.ts
  voirFiche: function(id: string) { (window as any).PageFicheEleve.ouvrir(id); },

  ouvrirModal: function() {
    this.chargerClasses();
    openModal('m-eleve');
  },

  init: function() { this.page = 1; this.charger(); }
};

(window as any).PageEleves = PageEleves;
PAGE_HOOKS['eleves'] = () => PageEleves.init();
