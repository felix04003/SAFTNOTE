import { Api } from '../api';
import { Auth } from '../auth';
import { escapeHtml } from '../ui';
import { PAGE_HOOKS } from '../ens-router';

declare const PageEnsAppel: any;
declare const PageEnsNotes: any;

export const PageEnsDashboard: any = {
  _classes:  [] as any[],
  _creneaux: [] as any[],

  async init() {
    const user  = Auth.getUser();
    const greet = document.getElementById('ens-greeting') as HTMLElement | null;
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : 'Enseignant') + ' 👋';

    await Promise.all([
      this._chargerKPI(),
      this._chargerAppelsJour(),
      this._chargerNotesAttente(),
    ]);
  },

  async _chargerKPI() {
    try {
      const res      = await Api.get('/enseignants/moi/classes');
      this._classes  = res.data || [];
      const nbClasses = this._classes.length;
      const nbEleves  = this._classes.reduce(function(sum: number, c: any) { return sum + (c.effectif || 0); }, 0);
      _ensSet('ens-kpi-classes', nbClasses);
      _ensSet('ens-kpi-eleves', nbEleves);
      const anneeEl = document.getElementById('tb-annee') as HTMLElement | null;
      if (anneeEl && res.meta && res.meta.annee) anneeEl.textContent = '📅 ' + res.meta.annee;
    } catch {
      _ensSet('ens-kpi-classes', '—');
      _ensSet('ens-kpi-eleves', '—');
    }
    try {
      const r2 = await Api.get('/evaluations', { statut: 'non_saisie' });
      _ensSet('ens-kpi-saisir', (r2.data || []).length);
    } catch {
      _ensSet('ens-kpi-saisir', '—');
    }
  },

  async _chargerAppelsJour() {
    const el = document.getElementById('ens-appels-jour') as HTMLElement | null;
    if (!el) return;
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--g400);font-size:13px">Chargement…</div>';
    try {
      const res = await Api.get('/enseignants/moi/edt');
      const edt = (res.data && res.data.emploi_du_temps) || [];
      // JS getDay(): 0=Dim, 1=Lun, ..., 6=Sam — Backend jour: 1=Lun, ..., 6=Sam
      // Values match directly for Mon-Sat; Sunday (0) returns no match (correct — no classes)
      const jourJS  = new Date().getDay();
      const jourAuj = edt.find(function(j: any) { return j.jour === jourJS; });
      let creneaux  = (jourAuj && jourAuj.creneaux) || [];
      creneaux = creneaux.filter(function(c: any) { return !c.est_pause; });

      if (!creneaux.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucun cours aujourd\'hui 🎉</div>';
        return;
      }
      PageEnsDashboard._creneaux = creneaux;
      el.innerHTML = creneaux.map(function(c: any) {
        const creneauId = escapeHtml(String(c.creneau_id || ''));
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + escapeHtml(c.matiere || '—') + ' � <span style="color:var(--g500)">' + escapeHtml(c.classe || '') + '</span></div>' +
            '<div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + escapeHtml((c.heure_debut || '') + ' – ' + (c.heure_fin || '')) + (c.salle ? ' � ' + escapeHtml(c.salle) : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-p btn-sm" onclick="PageEnsDashboard._lancerAppel(\'' + creneauId + '\')">Faire l\'appel</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Impossible de charger les créneaux</div>';
    }
  },

  async _chargerNotesAttente() {
    const el = document.getElementById('ens-notes-attente') as HTMLElement | null;
    if (!el) return;
    el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--g400);font-size:13px">Chargement…</div>';
    try {
      const res   = await Api.get('/evaluations', { statut: 'non_saisie' });
      const evals = (res.data || []).slice(0, 5);
      if (!evals.length) {
        el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Aucune note en attente ✓</div>';
        return;
      }
      el.innerHTML = evals.map(function(ev: any) {
        const evalId = escapeHtml(String(ev.id || ''));
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
          '<div>' +
            '<div style="font-weight:600;font-size:13px">' + escapeHtml(ev.matiere || '—') + '</div>' +
            '<div style="font-size:11.5px;color:var(--g400)">' + escapeHtml(ev.classe || '') + ' � ' + escapeHtml(ev.type || '') + ' � ' + escapeHtml(ev.date_evaluation || '—') + '</div>' +
          '</div>' +
          '<button class="btn btn-l btn-sm" onclick="PageEnsNotes.ouvrirSaisie(\'' + evalId + '\');goto(\'ens-notes\')">' + 'Saisir →</button>' +
        '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--g400);font-size:13px">Indisponible</div>';
    }
  },

  _lancerAppel: function(creneauId) {
    var c = (PageEnsDashboard._creneaux || []).find(function(x) { return String(x.creneau_id) === String(creneauId); });
    if (c) PageEnsAppel.lancerDepuisCreneau(c.creneau_id, c.matiere, c.classe, c.classe_id);
  },
};

function _ensSet(id: string, val: any) {
  const el = document.getElementById(id) as HTMLElement | null;
  if (el) el.textContent = (val != null) ? String(val) : '—';
}

(window as any).PageEnsDashboard = PageEnsDashboard;
PAGE_HOOKS['ens-dashboard'] = () => PageEnsDashboard.init();
