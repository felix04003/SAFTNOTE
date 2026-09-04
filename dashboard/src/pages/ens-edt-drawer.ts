import { Api } from '../api';
import { escapeHtml } from '../ui';
import { PageEnsEdt } from './ens-edt-page';

export const EdtDrawer: any = {
  _creneau:  null as any,
  _dateISO:  null as string | null,
  _eleves:   [] as any[],
  _appel_id: null as string | null,
  _statut:   null as string | null,
  _onglet:   'appel' as string,

  ouvrir: async function(creneauId: string, dateISO: string) {
    const creneau = PageEnsEdt._creneauxMap[creneauId];
    if (!creneau) return;

    EdtDrawer._creneau  = creneau;
    EdtDrawer._dateISO  = dateISO;
    EdtDrawer._appel_id = null;
    EdtDrawer._statut   = null;
    EdtDrawer._eleves   = [];
    EdtDrawer._onglet   = 'appel';

    const couleur = creneau.couleur_affichage || '#1a4731';
    const header = document.getElementById('edt-drawer-header') as HTMLElement | null;
    if (header) header.style.background = couleur;

    const matEl = document.getElementById('edt-drawer-matiere') as HTMLElement | null;
    if (matEl) matEl.textContent = creneau.matiere || '';

    const infoEl = document.getElementById('edt-drawer-info') as HTMLElement | null;
    if (infoEl) {
      infoEl.textContent = (creneau.classe || '') +
        ' \u00b7 ' + (creneau.heure_debut || '') + '\u2013' + (creneau.heure_fin || '') +
        (creneau.salle ? ' \u00b7 ' + creneau.salle : '');
    }

    const overlay = document.getElementById('edt-overlay') as HTMLElement | null;
    const drawer  = document.getElementById('edt-drawer') as HTMLElement | null;
    if (overlay) overlay.classList.add('show');
    if (drawer)  drawer.classList.add('open');

    const ok = await EdtDrawer._chargerDonnees();
    if (ok) EdtDrawer.onglet(EdtDrawer._onglet);
  },

  fermer: function() {
    const overlay = document.getElementById('edt-overlay') as HTMLElement | null;
    const drawer  = document.getElementById('edt-drawer') as HTMLElement | null;
    if (overlay) overlay.classList.remove('show');
    if (drawer)  drawer.classList.remove('open');
  },

  _chargerDonnees: async function() {
    const body = document.getElementById('edt-drawer-body') as HTMLElement | null;
    if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--gris)">Chargement\u2026</div>';

    try {
      const res = await Api.get('/appels/cours', {
        emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
        date_cours:         EdtDrawer._dateISO,
      });
      EdtDrawer._appel_id = res.data.appel_id;
      EdtDrawer._statut   = res.data.statut;
      EdtDrawer._eleves   = res.data.eleves || [];
      return true;
    } catch (e: any) {
      const body2 = document.getElementById('edt-drawer-body') as HTMLElement | null;
      if (body2) {
        body2.innerHTML = '<div style="color:var(--rouge);padding:16px">Erreur : ' + escapeHtml(e.message || 'Chargement \u00e9chou\u00e9') + '</div>';
      }
      return false;
    }
  },

  onglet: function(nom: string) {
    EdtDrawer._onglet = nom;

    const tabs = ['appel', 'historique', 'notes', 'salle'];
    tabs.forEach(function(t: string) {
      const btn = document.getElementById('edt-tab-' + t) as HTMLElement | null;
      if (btn) btn.className = 'edt-tab' + (t === nom ? ' active' : '');
    });

    const body = document.getElementById('edt-drawer-body') as HTMLElement | null;
    if (!body) return;

    // EdtAppel accessed via window to avoid circular import with ens-edt-appel.ts
    if (nom === 'appel')           (window as any).EdtAppel.render(body);
    else if (nom === 'historique') EdtDrawer._renderHistorique(body);
    else if (nom === 'notes')      EdtDrawer._renderNotes(body);
    else if (nom === 'salle')      EdtDrawer._renderSalle(body);
  },

  _renderHistorique: function(body: HTMLElement) {
    const parts: string[] = [];

    if (EdtDrawer._statut === 'ouvert') {
      parts.push('<div style="background:#fef3e2;color:#b7670a;padding:10px 12px;border-radius:var(--rs);margin-bottom:12px;font-size:13px">Appel en cours \u2014 donn\u00e9es partielles</div>');
    }

    if (EdtDrawer._eleves.length === 0) {
      body.innerHTML = '<div style="color:var(--gris);padding:16px">Aucun \u00e9l\u00e8ve</div>';
      return;
    }

    function badge(el: any): string {
      const s = el.statut;
      if (s === 'present')     return '<span class="badge-present">\u2713 Pr\u00e9sent</span>';
      if (s === 'absent')      return '<span class="badge-absent">\u2717 Absent</span>';
      if (s === 'retard')      return '<span class="badge-retard">\u23f1 Retard' + (el.minutes_retard ? ' (' + el.minutes_retard + 'min)' : '') + '</span>';
      if (s === 'sorti_avant') return '<span class="badge-sorti">Sorti t\u00f4t</span>';
      if (s === 'dispense')    return '<span class="badge-dispense">Dispens\u00e9</span>';
      return '<span class="badge-nonsaisi">\u2014</span>';
    }

    EdtDrawer._eleves.forEach(function(el: any) {
      parts.push(
        '<div class="edt-eleve-row">' +
          '<span class="edt-eleve-nom">' + escapeHtml((el.nom || '') + ' ' + (el.prenom || '')) + '</span>' +
          badge(el) +
        '</div>'
      );
    });

    body.innerHTML = parts.join('');
  },

  _renderNotes: function(body: HTMLElement) {
    const c = EdtDrawer._creneau;
    body.innerHTML =
      '<div style="padding:8px 0">' +
        '<button class="btn btn-p" onclick="' +
          'if(window.PageEnsNotes&&PageEnsNotes.prefiltrer){' +
            'PageEnsNotes.prefiltrer(\'' + (c.classe_id || '') + '\',\'' + (c.affectation_id || '') + '\');' +
          '}goto(\'ens-notes\');EdtDrawer.fermer()">' +
          '\u2192 Ajouter une \u00e9valuation' +
        '</button>' +
      '</div>';
  },

  _renderSalle: function(body: HTMLElement) {
    const salle = (EdtDrawer._creneau && EdtDrawer._creneau.salle) || '';
    body.innerHTML =
      '<div style="margin-bottom:12px;font-size:13px;color:var(--gris)">Salle actuelle : <strong>' + (salle || '\u2014') + '</strong></div>' +
      '<input id="edt-salle-input" class="fi" type="text" maxlength="50" placeholder="Ex: Salle 12, Amphi A\u2026" value="' + escapeHtml(salle) + '" style="width:100%;box-sizing:border-box;margin-bottom:12px">' +
      '<button class="btn btn-p" style="width:100%" onclick="EdtDrawer._saveSalle()">Enregistrer</button>' +
      '<div id="edt-salle-msg" style="margin-top:10px;font-size:13px"></div>';
  },

  _saveSalle: async function() {
    const input = document.getElementById('edt-salle-input') as HTMLInputElement | null;
    const msg   = document.getElementById('edt-salle-msg') as HTMLElement | null;
    if (!input || !EdtDrawer._creneau) return;

    const salle = input.value.trim();
    try {
      await Api.put('/enseignants/moi/edt/' + EdtDrawer._creneau.creneau_id + '/salle', { salle: salle || null });
      EdtDrawer._creneau.salle = salle;

      if (msg) { msg.style.color = 'var(--vert)'; msg.textContent = '\u2713 Salle mise \u00e0 jour'; }

      const infoEl = document.getElementById('edt-drawer-info') as HTMLElement | null;
      if (infoEl) {
        infoEl.textContent = (EdtDrawer._creneau.classe || '') +
          ' \u00b7 ' + (EdtDrawer._creneau.heure_debut || '') + '\u2013' + (EdtDrawer._creneau.heure_fin || '') +
          (salle ? ' \u00b7 ' + salle : '');
      }

      if (PageEnsEdt._data) PageEnsEdt._renderGrid(PageEnsEdt._data);
    } catch (e: any) {
      if (msg) { msg.style.color = 'var(--rouge)'; msg.textContent = 'Erreur : ' + (e.message || 'Mise \u00e0 jour \u00e9chou\u00e9e'); }
    }
  },
};
