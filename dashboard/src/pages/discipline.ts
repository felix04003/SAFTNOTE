import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal, exporterCsv } from '../ui';
import { PAGE_HOOKS } from '../router';

export const TYPES_SANCTION: Record<string, string> = {
  avertissement_oral:   'Avertissement oral',
  avertissement_ecrit:  'Avertissement écrit',
  retenue:              'Retenue',
  renvoi_temporaire:    'Renvoi temporaire',
  conseil_discipline:   'Conseil de discipline',
  exclusion_definitive: 'Exclusion définitive',
};

export interface ChampsSanction {
  inscription_id?: string; type?: string; motif: string; date_prononcee?: string; nb_jours?: string;
}

/** Valide le formulaire ; renvoie le corps à envoyer ou le message d'erreur (mêmes règles que l'API). */
export function construireCorps(c: ChampsSanction, creation: boolean): { corps?: Record<string, any>; erreur?: string } {
  const motif = (c.motif || '').trim();
  if (motif.length < 5) return { erreur: 'Le motif doit contenir au moins 5 caractères' };
  const corps: Record<string, any> = { motif };
  if (c.nb_jours) {
    const n = Number(c.nb_jours);
    if (!Number.isInteger(n) || n < 1 || n > 30) return { erreur: 'Le nombre de jours doit être entre 1 et 30' };
    corps.nb_jours = n;
  }
  if (creation) {
    if (!c.inscription_id) return { erreur: 'Choisissez un élève' };
    if (!c.type || !TYPES_SANCTION[c.type]) return { erreur: 'Choisissez un type de sanction' };
    corps.inscription_id = c.inscription_id;
    corps.type = c.type;
    if (c.date_prononcee) corps.date_prononcee = c.date_prononcee;
  }
  return { corps };
}

const jour = (d: any) => String(d || '').slice(0, 10);
function dateFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return a && m && j ? j + '/' + m + '/' + a : '—';
}
const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value || '').trim();

export const PageDiscipline: any = {
  data: [] as any[],
  classes: [] as any[],
  _page: 1,
  _limite: 20,
  _classeId: '',
  _type: '',
  _editionId: '',

  async init() {
    await this._chargerClasses();
    await this.charger();
  },

  async _chargerClasses() {
    try {
      const res = await Api.get('/classes');
      this.classes = res.data || [];
    } catch { this.classes = []; }
    const options = this.classes.map(function(c: any) {
      return '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.nom_classe || c.nom) + '</option>';
    }).join('');
    const filtre = document.getElementById('dsc-fil-classe');
    if (filtre) filtre.innerHTML = '<option value="">Toutes les classes</option>' + options;
    const modal = document.getElementById('dsc-classe');
    if (modal) modal.innerHTML = '<option value="">— Choisir une classe —</option>' + options;
  },

  filtrerClasse(id: string) { this._classeId = id; this._page = 1; return this.charger(); },
  filtrerType(type: string) { this._type = type; this._page = 1; return this.charger(); },
  page(delta: number) { this._page += delta; return this.charger(); },

  async charger() {
    const corps = document.getElementById('tb-discipline') as HTMLElement | null;
    if (!corps) return;
    corps.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';
    try {
      const params: Record<string, any> = { page: this._page, limite: this._limite };
      if (this._classeId) params.classe_id = this._classeId;
      if (this._type) params.type = this._type;
      const res = await Api.get('/discipline/sanctions', params);
      this.data = res.data || [];
      this.rendre(res.meta);
    } catch (e: any) {
      corps.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'chargement impossible') + '</td></tr>';
    }
  },

  rendre(meta?: any) {
    const corps = document.getElementById('tb-discipline') as HTMLElement | null;
    if (!corps) return;
    const sous = document.getElementById('ph-sous-discipline');
    const total = meta && meta.total != null ? meta.total : this.data.length;
    if (sous) sous.textContent = total + ' sanction' + (total > 1 ? 's' : '') + ' cette année';
    if (!this.data.length) {
      corps.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--g400)">Aucune sanction enregistrée</td></tr>';
    } else {
      corps.innerHTML = this.data.map(function(s: any) {
        const grave = s.type === 'renvoi_temporaire' || s.type === 'exclusion_definitive' || s.type === 'conseil_discipline';
        return '<tr>' +
          '<td class="nc">' + escapeHtml(((s.eleve_prenom || '') + ' ' + (s.eleve_nom || '')).trim() || '—') + '</td>' +
          '<td><span class="badge bp">' + escapeHtml(s.classe || '—') + '</span></td>' +
          '<td><span class="badge ' + (grave ? 'bd' : 'bw') + '">' + escapeHtml(TYPES_SANCTION[s.type] || s.type || '—') + '</span></td>' +
          '<td>' + escapeHtml(dateFr(jour(s.date_prononcee))) + '</td>' +
          '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(s.motif || '') + '">' + escapeHtml(s.motif || '—') + '</td>' +
          '<td>' + escapeHtml(s.prononcee_par || '—') + '</td>' +
          '<td style="display:flex;gap:5px">' +
            '<button class="btn btn-l btn-sm" onclick="PageDiscipline.ouvrir(\'' + escapeHtml(s.id) + '\')">Modifier</button>' +
            (s.eleve_id ? '<button class="btn btn-l btn-sm" onclick="PageFicheEleve.ouvrir(\'' + escapeHtml(s.eleve_id) + '\')">Dossier</button>' : '') +
          '</td></tr>';
      }).join('');
    }
    const pag = document.getElementById('pag-discipline');
    if (pag) {
      pag.innerHTML = !meta || meta.total <= this._limite ? '' :
        '<span style="font-size:12px;color:var(--g500)">Page <b>' + meta.page + '</b> / <b>' + meta.pages + '</b></span>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-l btn-sm" ' + (meta.page <= 1 ? 'disabled' : 'onclick="PageDiscipline.page(-1)"') + '>← Préc.</button>' +
        '<button class="btn btn-p btn-sm" ' + (meta.page >= meta.pages ? 'disabled' : 'onclick="PageDiscipline.page(1)"') + '>Suiv. →</button></div>';
    }
  },

  exporter() {
    return exporterCsv('/exports/sanctions.csv', { classe_id: this._classeId || undefined, type: this._type || undefined });
  },

  async chargerEleves(classeId: string) {
    const sel = document.getElementById('dsc-eleve') as HTMLSelectElement | null;
    if (!sel) return;
    if (!classeId) { sel.disabled = true; sel.innerHTML = '<option value="">— Choisir d\'abord une classe —</option>'; return; }
    sel.disabled = true;
    sel.innerHTML = '<option value="">Chargement…</option>';
    try {
      const res = await Api.get('/classes/' + classeId + '/eleves');
      const eleves = res.data || [];
      sel.innerHTML = eleves.length
        ? '<option value="">— Choisir un élève —</option>' + eleves.map(function(e: any) {
            return '<option value="' + escapeHtml(e.inscription_id) + '">' + escapeHtml(e.nom + ' ' + e.prenom) + '</option>';
          }).join('')
        : '<option value="">Aucun élève dans cette classe</option>';
      sel.disabled = !eleves.length;
    } catch { sel.innerHTML = '<option value="">Erreur de chargement</option>'; }
  },

  ouvrir(id?: string) {
    this._editionId = id || '';
    const s = id ? this.data.find(function(x: any) { return x.id === id; }) : null;
    const set = function(champ: string, v: any) {
      const el = document.getElementById('dsc-' + champ) as HTMLInputElement | null;
      if (el) el.value = v == null ? '' : String(v);
    };
    set('classe', ''); set('type', ''); set('motif', s ? s.motif : '');
    set('date', new Date().toISOString().slice(0, 10)); set('jours', s && s.nb_jours ? s.nb_jours : '');
    const sel = document.getElementById('dsc-eleve') as HTMLSelectElement | null;
    if (sel) { sel.disabled = true; sel.innerHTML = '<option value="">— Choisir d\'abord une classe —</option>'; }
    // En modification, seuls le motif et la durée changent : l'élève et le type restent fixés
    const creation = document.getElementById('dsc-bloc-creation');
    if (creation) creation.style.display = s ? 'none' : '';
    const titre = document.getElementById('dsc-modal-titre');
    if (titre) titre.textContent = s ? 'Modifier la sanction de ' + ((s.eleve_prenom || '') + ' ' + (s.eleve_nom || '')).trim() : 'Prononcer une sanction';
    const err = document.getElementById('dsc-err');
    if (err) err.classList.remove('show');
    openModal('m-sanction');
  },

  async enregistrer() {
    const err = document.getElementById('dsc-err') as HTMLElement | null;
    const creation = !this._editionId;
    const { corps, erreur } = construireCorps({
      inscription_id: val('dsc-eleve'), type: val('dsc-type'), motif: val('dsc-motif'),
      date_prononcee: val('dsc-date'), nb_jours: val('dsc-jours'),
    }, creation);
    if (erreur || !corps) {
      if (err) { err.textContent = erreur || ''; err.classList.add('show'); }
      return;
    }
    if (err) err.classList.remove('show');
    const btn = document.getElementById('btn-sanction-save') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try {
      if (creation) await Api.post('/discipline/sanctions', corps);
      else await Api.put('/discipline/sanctions/' + this._editionId, corps);
      closeModal('m-sanction');
      toast(creation ? 'Sanction enregistrée ✓ — parents prévenus' : 'Sanction modifiée ✓', 's');
      await this.charger();
    } catch (e: any) {
      if (err) { err.textContent = e.message || 'Enregistrement impossible'; err.classList.add('show'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },
};

(window as any).PageDiscipline = PageDiscipline;
PAGE_HOOKS['discipline'] = () => PageDiscipline.init();
