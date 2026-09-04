import { Api } from '../api';
import { escapeHtml } from '../ui';
import { _lundiDeSemaine, _dateISO, _addDays, _labelSemaine } from './ens-edt-utils';

export const PageEnsEdt: any = {
  _semaine:     null as Date | null,
  _data:        null as any,
  _creneauxMap: {} as Record<string, any>,

  init: function() {
    PageEnsEdt._semaine = _lundiDeSemaine(new Date());
    PageEnsEdt._charger();
  },

  semainePrec: function() {
    PageEnsEdt._semaine = _addDays(PageEnsEdt._semaine, -7);
    PageEnsEdt._charger();
  },

  semaineSuiv: function() {
    PageEnsEdt._semaine = _addDays(PageEnsEdt._semaine, 7);
    PageEnsEdt._charger();
  },

  semaineAuj: function() {
    PageEnsEdt._semaine = _lundiDeSemaine(new Date());
    PageEnsEdt._charger();
  },

  _charger: async function() {
    const label = document.getElementById('edt-label-semaine') as HTMLElement | null;
    if (label) label.textContent = _labelSemaine(PageEnsEdt._semaine);

    try {
      const res = await Api.get('/enseignants/moi/edt', { semaine: _dateISO(PageEnsEdt._semaine) });
      PageEnsEdt._data = res.data;

      const anneeEl = document.getElementById('ens-edt-annee') as HTMLElement | null;
      if (anneeEl && res.data.annee) anneeEl.textContent = res.data.annee;

      PageEnsEdt._renderGrid(res.data);
    } catch (e: any) {
      console.warn('PageEnsEdt: chargement \u00e9chou\u00e9 \u2014', e.message);
      const grid = document.getElementById('ens-edt-grid') as HTMLElement | null;
      if (grid) grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gris);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  _renderGrid: function(data: any) {
    const grid = document.getElementById('ens-edt-grid') as HTMLElement | null;
    if (!grid || !data || !data.emploi_du_temps) return;

    PageEnsEdt._creneauxMap = {};
    const jours: any[] = data.emploi_du_temps;

    if (jours.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gris);font-size:13px">Aucun cr\u00e9neau cette semaine</div>';
      return;
    }

    const plagesMap: Record<string, any> = {};
    jours.forEach(function(j: any) {
      (j.creneaux || []).forEach(function(c: any) {
        if (!plagesMap[c.heure_debut]) {
          plagesMap[c.heure_debut] = { debut: c.heure_debut, fin: c.heure_fin, numero: c.plage_numero };
        }
        if (c.creneau_id) PageEnsEdt._creneauxMap[c.creneau_id] = c;
      });
    });

    const plages: any[] = Object.values(plagesMap).sort(function(a: any, b: any) { return a.numero - b.numero; });

    const creneauxIdx: Record<string, Record<string, any>> = {};
    jours.forEach(function(j: any) {
      creneauxIdx[j.jour] = {};
      (j.creneaux || []).forEach(function(c: any) { creneauxIdx[j.jour][c.heure_debut] = c; });
    });

    const parts: string[] = [];
    parts.push('<div class="edt-grid" style="grid-template-columns:60px repeat(' + jours.length + ',1fr)">');
    parts.push('<div class="edt-h"></div>');
    jours.forEach(function(j: any) { parts.push('<div class="edt-h">' + j.nom + '</div>'); });

    plages.forEach(function(plage: any) {
      parts.push('<div class="edt-t">' + plage.debut + '</div>');
      jours.forEach(function(j: any) {
        const c = creneauxIdx[j.jour] && creneauxIdx[j.jour][plage.debut];
        if (!c) { parts.push('<div class="edt-slot vide"></div>'); return; }
        if (c.est_pause) { parts.push('<div class="edt-slot vide"><span class="edt-creneau-pause">\u2014</span></div>'); return; }

        const couleurRaw = c.couleur_affichage || '';
        const couleur = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|var\(--[\w-]+\))$/.test(couleurRaw) ? couleurRaw : '#1a4731';
        const dateISO = _dateISO(_addDays(PageEnsEdt._semaine, j.jour - 1));

        parts.push(
          '<div class="edt-creneau" style="background:' + couleur + '" ' +
          'onclick="EdtDrawer.ouvrir(\'' + c.creneau_id + '\',\'' + dateISO + '\')">' +
          '<div class="edt-creneau-mat">' + escapeHtml(c.matiere || '') + '</div>' +
          '<div class="edt-creneau-info">' + escapeHtml(c.classe || '') + (c.salle ? ' \u00b7 ' + escapeHtml(c.salle) : '') + '</div>' +
          '</div>'
        );
      });
    });

    parts.push('</div>');
    grid.innerHTML = parts.join('');
  },
};
