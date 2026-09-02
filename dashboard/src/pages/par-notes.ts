import { Api } from '../api';
import { escapeHtml, parCn } from '../ui';
import { PAR_HOOKS } from '../par-router';

declare const ParApp: any;
const _parCn = parCn;

export const PageParNotes: any = {
  _periodes:    [] as any[],
  _filtrePerid: '',

  init: async function() {
    const enfant = ParApp.enfantLien();
    if (enfant.peut_voir_notes === false) {
      PageParNotes._accesRefuse();
      return;
    }
    await PageParNotes._chargerPeriodes();
    await PageParNotes.charger();
  },

  _chargerPeriodes: async function() {
    try {
      const r = await Api.get('/annees-scolaires/courante');
      PageParNotes._periodes = (r.data && r.data.periodes) || [];
      const sel = document.getElementById('par-fil-periode') as HTMLSelectElement | null;
      if (sel) {
        sel.innerHTML = '<option value="">Toutes les périodes</option>' +
          PageParNotes._periodes.map(function(p: any) {
            return '<option value="' + escapeHtml(String(p.id || '')) + '">' + escapeHtml(p.libelle || '') + '</option>';
          }).join('');
        if (PageParNotes._filtrePerid) sel.value = PageParNotes._filtrePerid;
      }
    } catch { PageParNotes._periodes = []; }
  },

  filtrerPeriode: function(periodeId) {
    PageParNotes._filtrePerid = periodeId;
    PageParNotes.charger();
  },

  charger: async function() {
    const id = ParApp.enfantId();
    if (!id) return;
    const container = document.getElementById('par-notes-container') as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement…</div>';

    try {
      const params: Record<string, string> = {};
      if (PageParNotes._filtrePerid) params['periode_id'] = PageParNotes._filtrePerid;

      const res       = await Api.get('/parents/moi/enfants/' + id + '/notes', params);
      const data      = res.data || {};
      const parMatiere = data.par_matiere || [];

      const enfant = ParApp.enfantLien();
      const sous = document.getElementById('par-notes-sous') as HTMLElement | null;
      if (sous) sous.textContent = (enfant.classe || '') + ' · ' + (data.nb_notes || 0) + ' note(s)';

      if (!parMatiere.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucune note publiée</div>';
        return;
      }

      container.innerHTML = parMatiere.map(function(m: any) {
        // Valider couleur CSS pour éviter l'injection de style
        const couleur = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|var\(--[\w-]+\))$/.test(m.couleur) ? m.couleur : '#1a4731';
        const matiere = escapeHtml(m.matiere || '—');
        return '<div class="carte" style="margin-bottom:16px">' +
          '<div class="ch" style="border-left:3px solid ' + couleur + '">' +
            '<span style="color:' + couleur + ';font-weight:800">' + matiere + '</span>' +
          '</div>' +
          '<div class="tw">' +
            '<table>' +
              '<thead><tr>' +
                '<th>Type</th><th>Date</th><th>Note</th><th>Moy. classe</th><th>Appréciation</th>' +
              '</tr></thead>' +
              '<tbody>' +
                m.notes.map(function(n: any) {
                  const valAff = n.est_absent ? '<span class="badge bd">Absent</span>' :
                    (n.valeur != null ? '<span style="font-weight:800;color:' + _parCn(n.valeur) + '">' + n.valeur + '/' + (n.note_max || 20) + '</span>' : '—');
                  return '<tr>' +
                    '<td><span class="badge bo">' + escapeHtml(n.type || '—') + '</span></td>' +
                    '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px">' + escapeHtml(n.date_evaluation || '—') + '</td>' +
                    '<td>' + valAff + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + (n.moyenne_classe != null ? n.moyenne_classe + '/20' : '—') + '</td>' +
                    '<td style="color:var(--g500);font-size:12px">' + escapeHtml(n.appreciation || '') + '</td>' +
                  '</tr>';
                }).join('') +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e: any) {
      if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">' + escapeHtml(e.message || 'Erreur de chargement') + '</div>';
    }
  },

  _accesRefuse: function() {
    const container = document.getElementById('par-notes-container') as HTMLElement | null;
    if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Accès aux notes non autorisé pour cet enfant.</div>';
  },

};

(window as any).PageParNotes = PageParNotes;
PAR_HOOKS['par-notes'] = () => PageParNotes.init();
