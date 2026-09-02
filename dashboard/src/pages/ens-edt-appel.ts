import { Api } from '../api';
import { escapeHtml } from '../ui';
import { EdtDrawer } from './ens-edt-drawer';

interface StatutLocal {
  statut: string | null;
  minutes_retard: number;
}

export const EdtAppel: any = {
  _statutsLocaux: {} as Record<string, StatutLocal>,

  render: function(body: HTMLElement) {
    EdtAppel._statutsLocaux = {};

    if (EdtDrawer._statut === 'effectue') {
      EdtAppel._renderCloture(body);
      return;
    }

    EdtDrawer._eleves.forEach(function(el: any) {
      EdtAppel._statutsLocaux[el.inscription_id] = {
        statut:         el.statut !== 'non_saisi' ? el.statut : null,
        minutes_retard: el.minutes_retard || 0,
      };
    });

    EdtAppel._renderSaisie(body);
  },

  _renderCloture: function(body: HTMLElement) {
    const nb_p = EdtDrawer._eleves.filter(function(e: any) { return e.statut === 'present'; }).length;
    const nb_a = EdtDrawer._eleves.filter(function(e: any) { return e.statut === 'absent'; }).length;
    const nb_r = EdtDrawer._eleves.filter(function(e: any) { return e.statut === 'retard'; }).length;

    body.innerHTML =
      '<div style="background:var(--bg);border-radius:var(--rs);padding:16px;margin-bottom:16px">' +
        '<div style="font-weight:700;margin-bottom:8px">Appel cl\u00f4tur\u00e9</div>' +
        '<div style="font-size:13px;color:var(--gris)">' +
          nb_p + ' pr\u00e9sents \u00b7 ' + nb_a + ' absents \u00b7 ' + nb_r + ' retards' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-s" onclick="EdtDrawer.onglet(\'historique\')">Voir le d\u00e9tail</button>';
  },

  _renderSaisie: function(body: HTMLElement) {
    const nb_saisis = (Object.values(EdtAppel._statutsLocaux) as StatutLocal[])
      .filter(function(s) { return s.statut !== null; }).length;
    const total  = EdtDrawer._eleves.length;
    const tousOk = (nb_saisis === total && total > 0);

    const parts: string[] = [];
    parts.push('<div class="edt-badge-saisis">' + nb_saisis + '/' + total + ' saisis</div>');

    EdtDrawer._eleves.forEach(function(el: any) {
      const id = el.inscription_id;
      const s  = EdtAppel._statutsLocaux[id] || { statut: null, minutes_retard: 0 };

      parts.push(
        '<div class="edt-eleve-row" id="row-' + id + '">' +
          '<span class="edt-eleve-nom">' + escapeHtml((el.nom || '') + ' ' + (el.prenom || '')) + '</span>' +
          '<div class="edt-eleve-btns">' +
            '<button class="btn btn-xs edt-btn-present' + (s.statut === 'present' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'present\')">\u2713</button>' +
            '<button class="btn btn-xs edt-btn-absent' + (s.statut === 'absent' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'absent\')">\u2717</button>' +
            '<button class="btn btn-xs edt-btn-retard' + (s.statut === 'retard' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'retard\')">\u23f1</button>' +
          '</div>' +
        '</div>' +
        '<div id="retard-' + id + '" style="display:' + (s.statut === 'retard' ? 'block' : 'none') + ';padding:4px 0 8px 0">' +
          '<input class="edt-retard-input" type="number" min="1" max="120" placeholder="min" value="' + (s.minutes_retard || '') + '" ' +
            'oninput="EdtAppel.setRetard(\'' + id + '\',this.value)">' +
        '</div>'
      );
    });

    parts.push(
      '<button class="btn btn-p edt-cloture-btn" id="edt-btn-cloture"' +
        (tousOk ? '' : ' disabled') +
        ' onclick="EdtAppel.soumettre()">Cl\u00f4turer l\'appel</button>'
    );

    body.innerHTML = parts.join('');
  },

  setStatut: function(inscriptionId: string, statut: string) {
    if (!EdtAppel._statutsLocaux[inscriptionId]) {
      EdtAppel._statutsLocaux[inscriptionId] = { statut: null, minutes_retard: 0 };
    }
    EdtAppel._statutsLocaux[inscriptionId].statut = statut;

    const row = document.getElementById('row-' + inscriptionId) as HTMLElement | null;
    if (row) {
      ['present', 'absent', 'retard'].forEach(function(s: string) {
        const btn = row.querySelector('.edt-btn-' + s);
        if (!btn) return;
        const cls = btn.className.replace(' actif', '');
        btn.className = cls + (s === statut ? ' actif' : '');
      });
    }

    const retardDiv = document.getElementById('retard-' + inscriptionId) as HTMLElement | null;
    if (retardDiv) retardDiv.style.display = (statut === 'retard') ? 'block' : 'none';

    EdtAppel._majBadge();
  },

  setRetard: function(inscriptionId: string, val: string) {
    if (EdtAppel._statutsLocaux[inscriptionId]) {
      EdtAppel._statutsLocaux[inscriptionId].minutes_retard = parseInt(val) || 0;
    }
  },

  _majBadge: function() {
    const nb_saisis = (Object.values(EdtAppel._statutsLocaux) as StatutLocal[])
      .filter(function(s) { return s.statut !== null; }).length;
    const total = EdtDrawer._eleves.length;

    const badge = document.querySelector('.edt-badge-saisis') as HTMLElement | null;
    if (badge) badge.textContent = nb_saisis + '/' + total + ' saisis';

    const btnCloture = document.getElementById('edt-btn-cloture') as HTMLButtonElement | null;
    if (btnCloture) btnCloture.disabled = (nb_saisis < total || total === 0);
  },

  soumettre: async function() {
    const btnCloture = document.getElementById('edt-btn-cloture') as HTMLButtonElement | null;
    if (btnCloture) { btnCloture.disabled = true; btnCloture.textContent = 'Envoi\u2026'; }

    try {
      if (!EdtDrawer._appel_id) {
        const postRes = await Api.post('/appels', {
          emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
          date_cours:         EdtDrawer._dateISO,
        });
        EdtDrawer._appel_id = postRes.data.appel_id;
      }

      const presences = EdtDrawer._eleves.map(function(el: any) {
        const s = EdtAppel._statutsLocaux[el.inscription_id] || { statut: 'present', minutes_retard: 0 };
        const item: any = {
          inscription_id: el.inscription_id,
          statut:         s.statut || 'present',
        };
        if (s.statut === 'retard' && s.minutes_retard > 0) {
          item.minutes_retard = s.minutes_retard;
        }
        return item;
      });

      await Api.put('/appels/' + EdtDrawer._appel_id + '/presences', {
        presences: presences,
        cloturer:  true,
      });

      EdtDrawer._statut = 'effectue';
      EdtDrawer._eleves.forEach(function(el: any) {
        const s = EdtAppel._statutsLocaux[el.inscription_id];
        if (s) {
          el.statut         = s.statut || 'present';
          el.minutes_retard = s.minutes_retard || 0;
        }
      });

      const body = document.getElementById('edt-drawer-body') as HTMLElement | null;
      if (body) EdtAppel._renderCloture(body);

    } catch (e: any) {
      if (btnCloture) {
        btnCloture.disabled    = false;
        btnCloture.textContent = 'Cl\u00f4turer l\'appel';
      }

      let msgEl = document.getElementById('edt-appel-err') as HTMLElement | null;
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'edt-appel-err';
        msgEl.style.cssText = 'color:var(--rouge);font-size:13px;margin-top:8px';
        const body2 = document.getElementById('edt-drawer-body') as HTMLElement | null;
        if (body2) body2.appendChild(msgEl);
      }
      msgEl.textContent = 'Erreur\u00a0: ' + (e.message || 'Soumission \u00e9chou\u00e9e');

      if (e.status === 404 || e.status === 409) {
        const ok = await EdtDrawer._chargerDonnees();
        if (ok) {
          const body3 = document.getElementById('edt-drawer-body') as HTMLElement | null;
          if (body3) EdtAppel.render(body3);
        }
      }
    }
  },
};
