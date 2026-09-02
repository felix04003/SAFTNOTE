import { Api } from '../api';
import { escapeHtml } from '../ui';
import { PAR_HOOKS } from '../par-router';

declare const ParApp: any;

export const PageParAbsences: any = {

  init: async function() {
    const enfant = ParApp.enfantLien();
    if (enfant.peut_voir_absences === false) {
      PageParAbsences._accesRefuse();
      return;
    }
    await PageParAbsences.charger();
  },

  charger: async function() {
    const id = ParApp.enfantId();
    if (!id) return;
    const tbody = document.getElementById('tb-par-absences') as HTMLElement | null;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Chargement…</td></tr>';

    try {
      // Détail des absences
      const res = await Api.get('/parents/moi/enfants/' + id + '/absences');
      const absences = res.data || [];

      // Totaux depuis le tableau de bord (justifiées / injustifiées / retards)
      const tdbRes = await Api.get('/parents/moi/tableau-de-bord');
      const tdb = (tdbRes.data || []).find(function(e: any) { return e.enfant && e.enfant.id === id; });
      const abs = (tdb && tdb.absences) || {};
      PageParAbsences._renderRecap(abs);
      PageParAbsences._renderDetail(absences);

    } catch (e: any) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur') + '</td></tr>';
    }
  },

  _renderRecap: function(abs: any) {
    const el = document.getElementById('par-recap-abs-table') as HTMLElement | null;
    if (!el) return;
    const just   = abs.justifiees   || 0;
    const injust = abs.injustifiees || 0;
    const retard = abs.retards      || 0;
    el.innerHTML =
      '<div class="carte"><div class="ch"><span>📊</span><span class="ct">Récapitulatif total</span></div>' +
      '<div style="display:flex;gap:12px;padding:12px 16px">' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--orange)">' + injust + '</div><div style="font-size:11px;color:var(--g400)">Injustifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--g500)">'  + just  + '</div><div style="font-size:11px;color:var(--g400)">Justifiées</div></div>' +
        '<div style="flex:1;text-align:center"><div style="font-size:22px;font-weight:800;color:var(--bleu)">'  + retard + '</div><div style="font-size:11px;color:var(--g400)">Retards</div></div>' +
      '</div></div>';
  },

  _renderDetail: function(absences: any[]) {
    const tbody = document.getElementById('tb-par-absences') as HTMLElement | null;
    if (!tbody) return;

    if (!absences.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Aucune absence enregistrée ✓</td></tr>';
      return;
    }

    const JOURS = ['', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    tbody.innerHTML = absences.map(function(a: any) {
      const jour    = JOURS[a.jour_semaine] || '';
      const statut  = escapeHtml(({ absent: 'Absent', retard: 'Retard', sorti_avant: 'Sorti tôt' } as Record<string, string>)[a.statut] || a.statut || '—');
      const couleur = a.statut === 'absent' ? 'var(--rouge)' : a.statut === 'retard' ? 'var(--orange)' : 'var(--g500)';
      const motif   = a.motif_justification ? ' — ' + escapeHtml(a.motif_justification) : '';
      const justif  = a.est_justifie
        ? '<span class="badge bs">✓ Justifié' + motif + '</span>'
        : '<span class="badge bd">Non justifié</span>';

      return '<tr>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + escapeHtml(a.date_cours || '—') + '</td>' +
        '<td class="nc">' + escapeHtml(a.matiere || '—') + '</td>' +
        '<td style="font-size:12px;color:var(--g500)">' + escapeHtml((jour ? jour + ' ' : '') + (a.heure_debut || '') + '–' + (a.heure_fin || '')) + '</td>' +
        '<td><span style="font-weight:600;color:' + couleur + '">' + statut + (a.minutes_retard ? ' (' + a.minutes_retard + 'min)' : '') + '</span></td>' +
        '<td>' + justif + '</td>' +
      '</tr>';
    }).join('');
  },

  _accesRefuse: function() {
    const tbody = document.getElementById('tb-par-absences') as HTMLElement | null;
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:28px;color:var(--g400)">Accès aux absences non autorisé pour cet enfant.</td></tr>';
    const recap = document.getElementById('par-recap-abs-table') as HTMLElement | null;
    if (recap) recap.innerHTML = '';
  },

};

(window as any).PageParAbsences = PageParAbsences;
PAR_HOOKS['par-absences'] = () => PageParAbsences.init();
