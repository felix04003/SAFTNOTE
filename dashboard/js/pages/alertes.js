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

  renderNotifs: function(evenements) {
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
    this.charger();
  }
};

PAGE_HOOKS.alertes = function() { PageAlertes.init(); };
