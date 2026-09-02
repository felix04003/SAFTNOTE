import { Api } from '../api';
import { Auth } from '../auth';
import { escapeHtml } from '../ui';
import { PAR_HOOKS } from '../par-router';

declare const ParApp: any;

export const PageParDashboard: any = {

  init: async function() {
    const user  = Auth.getUser();
    const greet = document.getElementById('par-greeting') as HTMLElement | null;
    if (greet) greet.textContent = 'Bonjour, ' + (user && user.prenom ? user.prenom : '') + ' 👋';

    const enfant    = ParApp.enfantLien();
    const nomEnfant = (enfant.prenom || '') + ' ' + (enfant.nom || '');

    try {
      const res = await Api.get('/parents/moi/tableau-de-bord');
      const tdb = (res.data || []).find(function(e: any) {
        return e.enfant && e.enfant.id === ParApp.enfantId();
      });

      if (!tdb) {
        PageParDashboard._vide();
        return;
      }

      // KPI
      const moy = tdb.moyenne_generale;
      _parSet('par-kpi-moy',     moy ? moy.moyenne_generale : '—');
      _parSet('par-kpi-mention', moy ? (moy.mention || '—')  : '—');

      const abs      = tdb.absences || {};
      const totalAbs = (abs.justifiees || 0) + (abs.injustifiees || 0);
      _parSet('par-kpi-abs', totalAbs);

      // Dernières notes
      PageParDashboard._renderDernieresNotes(tdb.dernieres_notes || [], nomEnfant, enfant.peut_voir_notes);

      // Recap absences
      PageParDashboard._renderRecapAbsences(abs, enfant.peut_voir_absences);

    } catch (e) {
      _parSet('par-kpi-moy', '—');
      _parSet('par-kpi-abs', '—');
      _parSet('par-kpi-mention', '—');
    }
  },

  _vide: function() {
    _parSet('par-kpi-moy', '—');
    _parSet('par-kpi-abs', '—');
    _parSet('par-kpi-mention', '—');
    const el = document.getElementById('par-dernieres-notes') as HTMLElement | null;
    if (el) el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune donnée disponible</div>';
  },

  _renderDernieresNotes: function(notes: any[], nomEnfant: string, peutVoir: boolean | undefined) {
    const el = document.getElementById('par-dernieres-notes') as HTMLElement | null;
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux notes non autorisé</div>';
      return;
    }
    if (!notes.length) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Aucune note publiée</div>';
      return;
    }

    el.innerHTML = notes.map(function(n: any) {
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--g100)">' +
        '<div>' +
          '<div style="font-weight:600;font-size:13px">' + escapeHtml(n.matiere || '—') + '</div>' +
          '<div style="font-size:11.5px;color:var(--g400)">' + escapeHtml(n.type || '') + ' � ' + escapeHtml(n.date_evaluation || '') + '</div>' +
        '</div>' +
        '<span style="font-weight:800;font-size:15px;color:' + _parCn(n.valeur) + '">' + (n.valeur != null ? n.valeur : '—') + '/20</span>' +
      '</div>';
    }).join('');
  },

  _renderRecapAbsences: function(abs: any, peutVoir: boolean | undefined) {
    const el = document.getElementById('par-recap-absences') as HTMLElement | null;
    if (!el) return;

    if (peutVoir === false) {
      el.innerHTML = '<div style="padding:16px;color:var(--g400);font-size:13px;text-align:center">Accès aux absences non autorisé</div>';
      return;
    }

    const just   = abs.justifiees    || 0;
    const injust = abs.injustifiees  || 0;
    const retard = abs.retards       || 0;

    el.innerHTML =
      '<div style="display:flex;gap:12px;padding:12px 0">' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Injustifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--g500)">' + just + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Justifiées</div>' +
        '</div>' +
        '<div style="flex:1;text-align:center">' +
          '<div style="font-size:22px;font-weight:800;color:var(--bleu)">' + retard + '</div>' +
          '<div style="font-size:11px;color:var(--g400)">Retards</div>' +
        '</div>' +
      '</div>';
  },
};

function _parSet(id: string, val: any) {
  const el = document.getElementById(id) as HTMLElement | null;
  if (el) el.textContent = (val != null) ? val : '—';
}

function _parCn(val: number | null): string {
  if (val == null) return 'var(--g500)';
  if (val >= 14)  return 'var(--vert)';
  if (val >= 10)  return 'var(--orange)';
  return 'var(--rouge)';
}

(window as any).PageParDashboard = PageParDashboard;
PAR_HOOKS['par-dashboard'] = () => PageParDashboard.init();
