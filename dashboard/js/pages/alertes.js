'use strict';

/**
 * Page Alertes — charge depuis l'API,
 * fallback sur mock si backend indisponible.
 */
var PageAlertes = {
  data: [],

  async charger() {
    try {
      var res = await Api.get('/evenements');
      this.data = res.data;
      this.renderNotifs(res.data);
      return true;
    } catch (e) {
      console.warn('PageAlertes: fallback mock —', e.message);
      return false;
    }
  },

  renderAlertes: function(evenements) {
    var listeEl = document.getElementById('alertes-list');
    var sousTitre = document.getElementById('ph-sous-alertes');

    if (listeEl) {
      if (!evenements.length) {
        listeEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Aucune alerte — tout est en ordre ✅</div>';
      } else {
        listeEl.innerHTML = evenements.map(function(ev) {
          var titre = ev.titre || ev.nom || 'Événement';
          var desc = ev.description || '';
          return '<div class="al al-i"><span class="al-ico">📋</span>' +
            '<div style="flex:1"><div class="al-t">' + titre + '</div>' +
            '<div class="al-s">' + desc + '</div></div></div>';
        }).join('');
      }
    }

    if (sousTitre) {
      sousTitre.textContent = evenements.length ? evenements.length + ' alerte' + (evenements.length > 1 ? 's' : '') : 'Aucune alerte';
    }
  },

  renderNotifs: function(evenements) {
    this.renderAlertes(evenements);

    var tbody = document.getElementById('tb-notif');
    if (!tbody) return;

    if (!evenements.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--g400);padding:30px">Aucune notification</td></tr>';
      return;
    }

    tbody.innerHTML = evenements.map(function(ev) {
      var canal = ev.canal || 'SMS';
      return '<tr>' +
        '<td class="nc">' + (ev.destinataire || '\u2014') + '</td>' +
        '<td style="font-size:12px;color:var(--g600);max-width:260px">' + (ev.message || ev.description || '\u2014') + '</td>' +
        '<td><span class="badge ' + (canal === 'WhatsApp' ? 'bs' : 'bp') + '">' + canal + '</span></td>' +
        '<td style="font-family:\'Space Mono\',monospace;font-size:11.5px;color:var(--g400)">' + (ev.date || '\u2014') + '</td>' +
        '<td>' + (ev.statut || '\u2014') + '</td>' +
      '</tr>';
    }).join('');
  },

  init: function() {
    // Empty state par défaut
    var listeEl = document.getElementById('alertes-list');
    if (listeEl) listeEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Chargement…</div>';
    this.charger();
  }
};

PAGE_HOOKS.alertes = function() { PageAlertes.init(); };
