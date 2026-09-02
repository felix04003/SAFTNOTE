// @ts-nocheck
import { Api } from '../api';
import { escapeHtml } from '../ui';
import { PAGE_HOOKS } from '../ens-router';

declare const PageEnsNotes: any;
declare const PageEnsAppel: any;

export const PageEnsClasses: any = {
  _data: [],

  async charger() {
    var grid = document.getElementById('ens-classes-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Chargement‚Ä¶</div>';

    try {
      var res = await Api.get('/enseignants/moi/classes');
      this._data = res.data || [];

      var sous = document.getElementById('ens-classes-sous');
      if (sous && res.meta) {
        // Count unique classes
        var classeIds = {};
        this._data.forEach(function(c) { classeIds[c.classe_id] = true; });
        var nbClasses = Object.keys(classeIds).length;
        sous.textContent = (res.meta.annee || '') + ' ¬∑ ' + nbClasses + ' classe(s)';
      }

      if (!this._data.length) {
        grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400)">Aucune classe affect√©e cette ann√©e</div>';
        return;
      }

      // Group by classe_id to handle multi-subject teachers
      var groupes = {};
      this._data.forEach(function(c) {
        if (!groupes[c.classe_id]) {
          // NOTE: effectif, salle_principale, est_titulaire pris du premier enregistrement
          // Suppose que ces champs sont au niveau classe (pas par affectation)
          groupes[c.classe_id] = { classe_id: c.classe_id, classe: c.classe, niveau: c.niveau, cycle: c.cycle, salle_principale: c.salle_principale, effectif: c.effectif, est_titulaire: c.est_titulaire, matieres: [] };
        }
        groupes[c.classe_id].matieres.push(c.matiere);
      });

      grid.innerHTML = Object.values(groupes).map(function(g) {
        var matieresStr = escapeHtml(g.matieres.join(', '));
        var classeEsc   = escapeHtml(g.classe || '‚Äî');
        var salleEsc    = g.salle_principale ? '<span>Ì†ΩÌ≥ç ' + escapeHtml(g.salle_principale) + '</span>' : '';
        var cycleEsc    = g.cycle ? '<span style="font-size:10px;background:var(--g100);padding:2px 8px;border-radius:10px">' + escapeHtml(g.cycle) + '</span>' : '';

        return '<div class="carte" style="padding:18px">' +
          '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px">' +
            '<div>' +
              '<div style="font-size:17px;font-weight:800;color:var(--g900)">' + classeEsc + '</div>' +
              '<div style="font-size:12px;color:var(--vert-lt);font-weight:600;margin-top:2px">' + matieresStr + '</div>' +
            '</div>' +
            '<span class="badge ' + (g.est_titulaire ? 'bs' : 'bw') + '">' + (g.est_titulaire ? 'Titulaire' : 'Vacataire') + '</span>' +
          '</div>' +
          '<div style="display:flex;gap:16px;font-size:12px;color:var(--g500);flex-wrap:wrap">' +
            '<span>Ì†ºÌæì <b style="color:var(--g900)">' + (g.effectif || 0) + '</b> √©l√®ves</span>' +
            salleEsc + cycleEsc +
          '</div>' +
          '<div style="margin-top:14px;display:flex;gap:8px">' +
            '<button class="btn btn-l btn-sm" onclick="PageEnsNotes.filtrerParClasse(\'' + g.classe_id + '\');goto(\'ens-notes\')">üìù Notes</button>' +
            '<button class="btn btn-l btn-sm" onclick="PageEnsAppel.filtrerParClasse(\'' + g.classe_id + '\');goto(\'ens-appel\')">‚úÖ Appel</button>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--rouge)">Erreur : ' + escapeHtml(e.message || 'impossible de charger les classes') + '</div>';
    }
  },

  init: function() { this.charger(); },
};

(window as any).PageEnsClasses = PageEnsClasses;
PAGE_HOOKS['ens-classes'] = () => PageEnsClasses.init();
