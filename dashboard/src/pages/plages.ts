import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ChampsPlage { numero: string; libelle: string; heure_debut: string; heure_fin: string; est_pause: boolean }

/** Valide le formulaire ; renvoie le corps à envoyer ou le message d'erreur (mêmes règles que l'API). */
export function construireCorpsPlage(c: ChampsPlage): { corps?: Record<string, any>; erreur?: string } {
  const numero = Number(c.numero);
  if (!Number.isInteger(numero) || numero < 1 || numero > 20) return { erreur: 'Le numéro doit être un entier entre 1 et 20' };
  if (!HEURE.test(c.heure_debut) || !HEURE.test(c.heure_fin)) return { erreur: 'Les heures sont au format HH:MM' };
  if (c.heure_fin <= c.heure_debut) return { erreur: 'L\'heure de fin doit suivre l\'heure de début' };
  const corps: Record<string, any> = { numero, heure_debut: c.heure_debut, heure_fin: c.heure_fin, est_pause: !!c.est_pause };
  if ((c.libelle || '').trim()) corps.libelle = c.libelle.trim().slice(0, 30);
  return { corps };
}

const hhmm = (h: any) => String(h || '').slice(0, 5);

export const PagePlages: any = {
  data: [] as any[],
  _editionId: '',

  async charger() {
    const zone = document.getElementById('param-plages-liste') as HTMLElement | null;
    if (!zone) return;
    try {
      const res = await Api.get('/plages-horaires');
      this.data = res.data || [];
      this.rendre();
    } catch (e: any) {
      zone.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">' + escapeHtml(e.message || 'Plages indisponibles') + '</div>';
    }
  },

  rendre() {
    const zone = document.getElementById('param-plages-liste') as HTMLElement | null;
    if (!zone) return;
    if (!this.data.length) {
      zone.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucune plage horaire. L\'emploi du temps en a besoin.</div>';
      return;
    }
    zone.innerHTML = '<div class="tw"><table><thead><tr><th>N°</th><th>Libellé</th><th>Horaire</th><th></th><th></th></tr></thead><tbody>' +
      this.data.map(function(p: any) {
        return '<tr>' +
          '<td>' + p.numero + '</td>' +
          '<td class="nc">' + escapeHtml(p.libelle || '—') + '</td>' +
          '<td>' + hhmm(p.heure_debut) + ' – ' + hhmm(p.heure_fin) + '</td>' +
          '<td>' + (p.est_pause ? '<span class="badge bw">Pause</span>' : '') + '</td>' +
          '<td style="display:flex;gap:5px">' +
            '<button class="btn btn-l btn-sm" onclick="PagePlages.ouvrir(\'' + escapeHtml(p.id) + '\')">Modifier</button>' +
            '<button class="btn btn-d btn-sm" onclick="PagePlages.supprimer(\'' + escapeHtml(p.id) + '\')">Supprimer</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';
  },

  ouvrir(id?: string) {
    this._editionId = id || '';
    const p = id ? this.data.find(function(x: any) { return x.id === id; }) : null;
    const prochain = this.data.reduce(function(m: number, x: any) { return Math.max(m, x.numero); }, 0) + 1;
    const set = function(champ: string, val: any) {
      const el = document.getElementById('plage-' + champ) as HTMLInputElement | null;
      if (el) el.value = val == null ? '' : String(val);
    };
    set('numero', p ? p.numero : prochain);
    set('libelle', p ? p.libelle : '');
    set('debut', p ? hhmm(p.heure_debut) : '');
    set('fin', p ? hhmm(p.heure_fin) : '');
    const pause = document.getElementById('plage-pause') as HTMLInputElement | null;
    if (pause) pause.checked = p ? !!p.est_pause : false;
    const titre = document.getElementById('plage-modal-titre');
    if (titre) titre.textContent = p ? 'Modifier la plage horaire' : 'Nouvelle plage horaire';
    const err = document.getElementById('plage-err');
    if (err) err.classList.remove('show');
    openModal('m-plage');
  },

  lireFormulaire(): ChampsPlage {
    const v = function(champ: string) { return ((document.getElementById('plage-' + champ) as HTMLInputElement | null)?.value || '').trim(); };
    return {
      numero: v('numero'), libelle: v('libelle'), heure_debut: v('debut'), heure_fin: v('fin'),
      est_pause: !!(document.getElementById('plage-pause') as HTMLInputElement | null)?.checked,
    };
  },

  async enregistrer() {
    const err = document.getElementById('plage-err') as HTMLElement | null;
    const { corps, erreur } = construireCorpsPlage(this.lireFormulaire());
    if (erreur || !corps) {
      if (err) { err.textContent = erreur || ''; err.classList.add('show'); }
      return;
    }
    try {
      if (this._editionId) await Api.put('/plages-horaires/' + this._editionId, corps);
      else await Api.post('/plages-horaires', corps);
      closeModal('m-plage');
      toast(this._editionId ? 'Plage modifiée ✓' : 'Plage ajoutée ✓', 's');
      await this.charger();
    } catch (e: any) {
      if (err) { err.textContent = e.message || 'Enregistrement impossible'; err.classList.add('show'); }
    }
  },

  async supprimer(id: string) {
    const p = this.data.find(function(x: any) { return x.id === id; });
    if (!confirm('Supprimer la plage n°' + (p ? p.numero : '') + ' ?')) return;
    try {
      await Api.del('/plages-horaires/' + id);
      toast('Plage supprimée', 's');
      await this.charger();
    } catch (e: any) {
      // Plage utilisée par l'emploi du temps : le serveur explique quoi faire
      toast(e.message || 'Suppression impossible', 'e');
    }
  },
};

(window as any).PagePlages = PagePlages;
