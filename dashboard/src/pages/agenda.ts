import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';

export const TYPES_EVENEMENT: Record<string, string> = {
  sortie_scolaire:         'Sortie scolaire',
  reunion_parents:         'Réunion de parents',
  examen_officiel:         'Examen officiel',
  conseil_classe:          'Conseil de classe',
  conseil_discipline:      'Conseil de discipline',
  journee_sportive:        'Journée sportive',
  journee_portes_ouvertes: 'Portes ouvertes',
  conge:                   'Congé',
  formation_enseignants:   'Formation des enseignants',
  autre:                   'Autre',
};

export interface ChampsEvenement {
  titre: string; type: string; date_debut: string; date_fin: string;
  heure_debut?: string; heure_fin?: string; lieu?: string; description?: string;
  notif_programmee?: boolean;
}

/** Valide le formulaire ; renvoie le corps à envoyer ou le message d'erreur (mêmes règles que l'API). */
export function construireCorps(c: ChampsEvenement): { corps?: Record<string, any>; erreur?: string } {
  const titre = (c.titre || '').trim();
  if (titre.length < 3) return { erreur: 'Le titre doit contenir au moins 3 caractères' };
  if (!TYPES_EVENEMENT[c.type]) return { erreur: 'Choisissez un type d\'événement' };
  if (!c.date_debut) return { erreur: 'La date de début est obligatoire' };
  const fin = c.date_fin || c.date_debut;
  if (fin < c.date_debut) return { erreur: 'La date de fin précède la date de début' };
  if (c.heure_debut && c.heure_fin && fin === c.date_debut && c.heure_fin <= c.heure_debut) {
    return { erreur: 'L\'heure de fin doit suivre l\'heure de début' };
  }
  const corps: Record<string, any> = {
    titre, type: c.type, date_debut: c.date_debut, date_fin: fin,
    concerne_tout_etablissement: true,
    notif_programmee: !!c.notif_programmee,
  };
  if (c.heure_debut) corps.heure_debut = c.heure_debut;
  if (c.heure_fin) corps.heure_fin = c.heure_fin;
  if ((c.lieu || '').trim()) corps.lieu = c.lieu!.trim();
  if ((c.description || '').trim()) corps.description = c.description!.trim();
  return { corps };
}

const jour = (d: any) => String(d || '').slice(0, 10);
const heure = (h: any) => String(h || '').slice(0, 5);

function dateFr(iso: string): string {
  const [a, m, j] = iso.split('-');
  return a && m && j ? j + '/' + m + '/' + a : '—';
}

export const PageAgenda: any = {
  data: [] as any[],
  _filtre: 'a_venir',
  _editionId: '',

  async charger() {
    const corps = document.getElementById('tb-agenda') as HTMLElement | null;
    try {
      const params: Record<string, any> = this._filtre === 'a_venir' ? { a_venir: 'true' } : {};
      const res = await Api.get('/evenements', params);
      this.data = res.data || [];
      this.rendre();
    } catch (e: any) {
      if (corps) corps.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'chargement impossible') + '</td></tr>';
    }
  },

  changerFiltre(valeur: string) {
    this._filtre = valeur;
    return this.charger();
  },

  rendre() {
    const corps = document.getElementById('tb-agenda') as HTMLElement | null;
    if (!corps) return;
    const sous = document.getElementById('ph-sous-agenda') as HTMLElement | null;
    if (sous) sous.textContent = this.data.length + ' événement' + (this.data.length > 1 ? 's' : '');
    if (!this.data.length) {
      corps.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--g400)">' +
        (this._filtre === 'a_venir' ? 'Aucun événement à venir' : 'Aucun événement') + '</td></tr>';
      return;
    }
    corps.innerHTML = this.data.map(function(e: any) {
      const debut = jour(e.date_debut), fin = jour(e.date_fin);
      const quand = dateFr(debut) + (fin && fin !== debut ? ' → ' + dateFr(fin) : '') +
        (e.heure_debut ? ' · ' + heure(e.heure_debut) + (e.heure_fin ? '–' + heure(e.heure_fin) : '') : '');
      return '<tr>' +
        '<td class="nc">' + escapeHtml(e.titre) + '</td>' +
        '<td><span class="badge bi">' + escapeHtml(TYPES_EVENEMENT[e.type] || e.type) + '</span></td>' +
        '<td>' + escapeHtml(quand) + '</td>' +
        '<td>' + escapeHtml(e.lieu || '—') + '</td>' +
        '<td>' + (e.notif_programmee ? (e.notif_envoyee_at ? 'Parents prévenus ✓' : 'Parents prévenus avant') : '—') + '</td>' +
        '<td style="display:flex;gap:5px">' +
          '<button class="btn btn-l btn-sm" onclick="PageAgenda.ouvrir(\'' + escapeHtml(e.id) + '\')">Modifier</button>' +
          '<button class="btn btn-d btn-sm" onclick="PageAgenda.supprimer(\'' + escapeHtml(e.id) + '\')">Supprimer</button>' +
        '</td></tr>';
    }).join('');
  },

  ouvrir(id?: string) {
    this._editionId = id || '';
    const e = id ? this.data.find(function(x: any) { return x.id === id; }) : null;
    const set = function(champ: string, val: any) {
      const el = document.getElementById('agd-' + champ) as HTMLInputElement | null;
      if (el) el.value = val == null ? '' : String(val);
    };
    const aujourdhui = new Date().toISOString().slice(0, 10);
    set('titre', e ? e.titre : '');
    set('type', e ? e.type : 'reunion_parents');
    set('debut', e ? jour(e.date_debut) : aujourdhui);
    set('fin', e ? jour(e.date_fin) : aujourdhui);
    set('heure-debut', e ? heure(e.heure_debut) : '');
    set('heure-fin', e ? heure(e.heure_fin) : '');
    set('lieu', e ? e.lieu : '');
    set('description', e ? e.description : '');
    const notif = document.getElementById('agd-notif') as HTMLInputElement | null;
    if (notif) notif.checked = e ? !!e.notif_programmee : false;
    const titre = document.getElementById('agd-modal-titre');
    if (titre) titre.textContent = e ? 'Modifier l\'événement' : 'Nouvel événement';
    const err = document.getElementById('agd-err');
    if (err) err.classList.remove('show');
    openModal('m-evenement');
  },

  lireFormulaire(): ChampsEvenement {
    const v = function(champ: string) { return ((document.getElementById('agd-' + champ) as HTMLInputElement | null)?.value || '').trim(); };
    return {
      titre: v('titre'), type: v('type'), date_debut: v('debut'), date_fin: v('fin'),
      heure_debut: v('heure-debut'), heure_fin: v('heure-fin'), lieu: v('lieu'), description: v('description'),
      notif_programmee: !!(document.getElementById('agd-notif') as HTMLInputElement | null)?.checked,
    };
  },

  async enregistrer() {
    const err = document.getElementById('agd-err') as HTMLElement | null;
    const { corps, erreur } = construireCorps(this.lireFormulaire());
    if (erreur || !corps) {
      if (err) { err.textContent = erreur || ''; err.classList.add('show'); }
      return;
    }
    if (err) err.classList.remove('show');
    const btn = document.getElementById('btn-evenement-save') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try {
      if (this._editionId) {
        // En modification, un champ vidé doit être effacé : l'API distingue « absent » (inchangé) de null
        const complet: Record<string, any> = { ...corps };
        for (const c of ['heure_debut', 'heure_fin', 'lieu']) if (!(c in complet)) complet[c] = null;
        if (!('description' in complet)) complet.description = '';       // l'API n'accepte pas null pour la description
        await Api.put('/evenements/' + this._editionId, complet);
      } else {
        await Api.post('/evenements', corps);
      }
      closeModal('m-evenement');
      toast(this._editionId ? 'Événement modifié ✓' : 'Événement créé ✓', 's');
      await this.charger();
    } catch (e: any) {
      if (err) { err.textContent = e.message || 'Enregistrement impossible'; err.classList.add('show'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  async supprimer(id: string) {
    const e = this.data.find(function(x: any) { return x.id === id; });
    if (!confirm('Supprimer l\'événement « ' + (e ? e.titre : '') + ' » ?')) return;
    try {
      await Api.del('/evenements/' + id);
      toast('Événement supprimé', 's');
      await this.charger();
    } catch (err: any) {
      toast(err.message || 'Suppression impossible', 'e');
    }
  },

  init() { this.charger(); },
};

(window as any).PageAgenda = PageAgenda;
PAGE_HOOKS['agenda'] = () => PageAgenda.init();
