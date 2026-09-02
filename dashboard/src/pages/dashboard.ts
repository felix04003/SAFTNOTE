// @ts-nocheck
import { Api } from '../api';
import { Auth } from '../auth';
import { PAGE_HOOKS } from '../router';

function set(id: string, val: any) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

export const PageDashboard: any = {
  async charger() {
    // En-tête : salutation + date
    const user = Auth.getUser();
    const greet = document.getElementById('greeting-name');
    if (greet && user) {
      greet.textContent = 'Bonjour, ' + (user.prenom || user.nom_complet?.split(' ')[0] || 'Directeur') + ' 👋';
    }
    const dateEl = document.getElementById('ph-sous-date');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('fr-FR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      });
    }

    try {
      const res = await Api.get('/dashboard');
      const s = res.data || res;

      // Année scolaire dans la topbar
      const anneeEl = document.getElementById('tb-annee');
      if (anneeEl && s.annee_courante) anneeEl.textContent = '📅 ' + s.annee_courante;

      // KPI cards
      set('kpi-eleves',      s.nb_eleves_actifs   ?? 0);
      set('kpi-enseignants', s.nb_enseignants      ?? 0);
      set('kpi-moy',         s.moyenne_generale != null ? s.moyenne_generale + '/20' : '—');
      set('kpi-absences',    s.absences_aujourd_hui ?? 0);

      // Activité récente
      const actEl = document.getElementById('activite-recente');
      if (actEl) {
        const items: string[] = [];
        if (s.absences_aujourd_hui > 0) {
          items.push(
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--g100)">' +
            '<span style="font-size:18px">⚠️</span>' +
            '<div><div style="font-size:13px;font-weight:600;color:var(--g900)">' +
            s.absences_aujourd_hui + ' absence(s) non justifiée(s)</div>' +
            '<div style="font-size:11px;color:var(--g400)">Aujourd\'hui</div></div></div>'
          );
        }
        if (s.incidents_ouverts > 0) {
          items.push(
            '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--g100)">' +
            '<span style="font-size:18px">🔴</span>' +
            '<div><div style="font-size:13px;font-weight:600;color:var(--g900)">' +
            s.incidents_ouverts + ' incident(s) disciplinaire(s) ouvert(s)</div>' +
            '<div style="font-size:11px;color:var(--g400)">À traiter</div></div></div>'
          );
        }
        if (!items.length) {
          items.push(
            '<div style="color:var(--g400);font-size:13px;padding:16px 0;text-align:center">✅ Aucune alerte aujourd\'hui</div>'
          );
        }
        actEl.innerHTML = items.join('');
      }
    } catch (e: any) {
      console.error('PageDashboard.charger —', e?.message);
      const actEl = document.getElementById('activite-recente');
      if (actEl) {
        actEl.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:12px">Impossible de charger les données.</div>';
      }
    }
  },

  init() { this.charger(); },
};

(window as any).PageDashboard = PageDashboard;
PAGE_HOOKS['dashboard'] = () => PageDashboard.init();
