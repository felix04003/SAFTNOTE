import { Api } from '../api';
import { escapeHtml } from '../ui';
import { PAGE_HOOKS } from '../router';

export const PageAlertes: any = {
  data: null as any,

  async charger() {
    try {
      const res: any = await Api.get('/notifications');
      this.data = res.donnees;
      this.renderNotifs(res.donnees);
      return true;
    } catch (e: any) {
      console.warn('PageAlertes: impossible de charger les notifications —', e.message);
      const listeEl = document.getElementById('alertes-list') as HTMLElement | null;
      if (listeEl) listeEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Notifications indisponibles</div>';
      return false;
    }
  },

  renderAlertes: function(donnees: any) {
    const sousTitre = document.getElementById('ph-sous-alertes') as HTMLElement | null;
    if (sousTitre) {
      const total = (donnees && donnees.total) ? donnees.total : 0;
      sousTitre.innerHTML = total
        ? '<span class="badge bp">' + total + '</span> alerte' + (total > 1 ? 's' : '') + ' en attente'
        : 'Aucune alerte';
    }
  },

  renderNotifs: function(donnees: any) {
    this.renderAlertes(donnees);

    const listeEl = document.getElementById('alertes-list') as HTMLElement | null;
    if (!listeEl) return;

    if (!donnees || donnees.total === 0) {
      listeEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Aucune alerte — tout est en ordre ✅</div>';
      return;
    }

    const lignes: string[] = [];

    (donnees.appelsManques || []).forEach(function(item: any) {
      lignes.push(
        '<div class="al al-i">' +
          '<span class="al-ico">📋</span>' +
          '<div style="flex:1">' +
            '<div class="al-t">Appel manqué — ' + escapeHtml(item.classe) + ' · ' + escapeHtml(item.matiere) + '</div>' +
            '<div class="al-s">le ' + escapeHtml(item.date) + '</div>' +
          '</div>' +
        '</div>'
      );
    });

    (donnees.absences || []).forEach(function(item: any) {
      lignes.push(
        '<div class="al al-i">' +
          '<span class="al-ico">⚠️</span>' +
          '<div style="flex:1">' +
            '<div class="al-t">' + escapeHtml(item.eleve) + ' (' + escapeHtml(item.classe) + ') absent</div>' +
            '<div class="al-s">le ' + escapeHtml(item.date) + '</div>' +
          '</div>' +
        '</div>'
      );
    });

    (donnees.notes || []).forEach(function(item: any) {
      lignes.push(
        '<div class="al al-i">' +
          '<span class="al-ico">📝</span>' +
          '<div style="flex:1">' +
            '<div class="al-t">Notes ' + escapeHtml(item.matiere) + ' publiées pour ' + escapeHtml(item.classe) + '</div>' +
            '<div class="al-s">le ' + escapeHtml(item.date) + '</div>' +
          '</div>' +
        '</div>'
      );
    });

    (donnees.bulletins || []).forEach(function(item: any) {
      lignes.push(
        '<div class="al al-i">' +
          '<span class="al-ico">📄</span>' +
          '<div style="flex:1">' +
            '<div class="al-t">Bulletin ' + escapeHtml(item.periode) + ' — ' + escapeHtml(item.eleve) + ' (' + escapeHtml(item.classe) + ')</div>' +
          '</div>' +
        '</div>'
      );
    });

    (donnees.incidents || []).forEach(function(item: any) {
      lignes.push(
        '<div class="al al-i">' +
          '<span class="al-ico">🚨</span>' +
          '<div style="flex:1">' +
            '<div class="al-t">Incident ' + escapeHtml(item.gravite) + ' — ' + escapeHtml(item.eleve) + ' (' + escapeHtml(item.classe) + ')</div>' +
            '<div class="al-s">le ' + escapeHtml(item.date) + '</div>' +
          '</div>' +
        '</div>'
      );
    });

    listeEl.innerHTML = lignes.join('');
  },

  init: function() {
    var listeEl = document.getElementById('alertes-list');
    if (listeEl) listeEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--g400);font-size:13px">Chargement…</div>';
    this.charger();
  }
};

(window as any).PageAlertes = PageAlertes;
PAGE_HOOKS['alertes'] = () => PageAlertes.init();
